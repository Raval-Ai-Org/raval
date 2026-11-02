import { describe, expect, it } from "vitest";
import { groundClassification, MIN_RELEVANCE } from "./classify";
import {
  buildCommunityQueries,
  cleanTerm,
  MAX_QUERIES,
  subredditOf,
  type QueryContext,
} from "./queries";
import { figuresKnown, finishReply, hasDisclosure, keepOwnLinks } from "./reply";
import { communitySignals, mentions } from "./signals";
import {
  mergeThreads,
  threadFromWebResult,
  threadIdentity,
  threadsFromHn,
  threadsFromStackExchange,
  type RawThread,
} from "./threads";

const ctx: QueryContext = {
  brandName: "Northside Roasters",
  domain: "northside.coffee",
  category: "coffee subscription for cafés",
  keywords: ["specialty coffee", "wholesale beans"],
  products: ["Café Box"],
  problems: ["reduce coffee waste in a café"],
  competitors: ["BeanCo", "Roastly"],
  goalFocus: "leads",
  watchKeywords: [],
  watchCommunities: ["r/espresso"],
};

describe("community queries", () => {
  it("are built only from stored brand facts, most useful first", () => {
    const qs = buildCommunityQueries(ctx);
    expect(qs.length).toBeGreaterThan(0);
    expect(qs.length).toBeLessThanOrEqual(MAX_QUERIES);
    expect(qs[0]).toMatchObject({ matchedOn: "alternative", competitorName: "BeanCo" });
    expect(qs.some((q) => q.matchedOn === "problem" && q.source === "quora")).toBe(true);
    expect(qs.some((q) => q.source === "hackernews")).toBe(true);
    expect(qs.some((q) => q.source === "stackexchange")).toBe(true);
    for (const q of qs.filter((q) => q.source === "reddit")) {
      expect(q.includeDomains).toEqual(["reddit.com"]);
    }
    // The brand's own name is never the search.
    expect(qs.some((q) => q.text.toLowerCase().includes("northside"))).toBe(false);
    expect(qs.find((q) => q.matchedOn === "category" && q.source === "reddit")?.text).toContain(
      "r/espresso",
    );
  });

  it("is empty when nothing is known", () => {
    expect(
      buildCommunityQueries({
        ...ctx,
        category: "",
        keywords: [],
        products: [],
        problems: [],
        competitors: [],
      }),
    ).toEqual([]);
  });

  it("strips search operators and quotes from terms", () => {
    expect(cleanTerm('site:evil.com "best beans"')).toBe("best beans");
    expect(subredditOf("https://reddit.com/r/Coffee/")).toBe("Coffee");
    expect(subredditOf("coffee")).toBeNull();
  });
});

describe("thread identity", () => {
  it("keeps real discussions and drops everything else", () => {
    expect(
      threadIdentity("https://www.reddit.com/r/espresso/comments/abc123/best_beans/?utm_source=x"),
    ).toMatchObject({ source: "reddit", community: "r/espresso", fingerprint: "reddit:abc123" });
    expect(threadIdentity("https://www.reddit.com/r/espresso/")).toBeNull();
    expect(threadIdentity("https://www.reddit.com/user/someone")).toBeNull();
    expect(threadIdentity("https://www.quora.com/How-do-cafes-reduce-coffee-waste")).toMatchObject({
      source: "quora",
    });
    expect(threadIdentity("https://www.quora.com/profile/Jane-Doe")).toBeNull();
    expect(threadIdentity("https://news.ycombinator.com/item?id=4242")).toMatchObject({
      fingerprint: "hn:4242",
    });
    expect(threadIdentity("https://coffee.stackexchange.com/questions/123/grind")).toMatchObject({
      source: "stackexchange",
      community: "coffee",
      fingerprint: "se:coffee:123",
    });
    expect(threadIdentity("https://evil.example/r/x/comments/abc123")).toBeNull();
  });

  it("only accepts a web result from the network the query asked for", () => {
    const origin = {
      source: "reddit" as const,
      matchedOn: "problem" as const,
      term: "waste",
      competitorName: null,
    };
    expect(
      threadFromWebResult(
        { url: "https://www.quora.com/How-do-cafes-reduce-waste", title: "How?", snippet: "" },
        origin,
      ),
    ).toBeNull();
    const t = threadFromWebResult(
      {
        url: "https://old.reddit.com/r/barista/comments/zz9/how_do_you_cut_waste/",
        title: "How do you cut bean waste? : r/barista",
        snippet: "<b>We</b> throw out a kilo a week",
      },
      origin,
    );
    expect(t).toMatchObject({
      url: "https://www.reddit.com/r/barista/comments/zz9/",
      snippet: "We throw out a kilo a week",
    });
  });

  it("reads Hacker News and Stack Exchange answers", () => {
    const origin = { matchedOn: "category" as const, term: "coffee", competitorName: null };
    const hn = threadsFromHn(
      {
        hits: [
          { objectID: "99", title: "Ask HN: Best coffee setup?", created_at_i: 1_700_000_000 },
          { objectID: "x" },
        ],
      },
      origin,
    );
    expect(hn).toHaveLength(1);
    expect(hn[0]).toMatchObject({
      source: "hackernews",
      url: "https://news.ycombinator.com/item?id=99",
    });
    const se = threadsFromStackExchange(
      {
        items: [
          {
            link: "https://coffee.stackexchange.com/questions/7/why",
            title: "Why is my espresso sour?",
            tags: ["espresso"],
            creation_date: 1_700_000_000,
          },
          { link: "https://example.com/questions/7", title: "Not a thread at all" },
        ],
      },
      origin,
    );
    expect(se).toHaveLength(1);
    expect(se[0].snippet).toBe("Tagged espresso");
  });

  it("merges duplicates and prefers the more specific reason", () => {
    const base: RawThread = {
      url: "https://news.ycombinator.com/item?id=1",
      source: "hackernews",
      community: "Hacker News",
      title: "Leaving BeanCo",
      snippet: "",
      postedAt: null,
      matchedOn: "category",
      matchedTerm: "coffee",
      competitorName: null,
      fingerprint: "hn:1",
    };
    const merged = mergeThreads([
      base,
      { ...base, matchedOn: "alternative", competitorName: "BeanCo", snippet: "why" },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].matchedOn).toBe("alternative");
    expect(mergeThreads([base], new Set(["hn:1"]))).toEqual([]);
  });
});

describe("classification grounding", () => {
  const thread: RawThread = {
    url: "https://news.ycombinator.com/item?id=1",
    source: "hackernews",
    community: "Hacker News",
    title: "Coffee waste",
    snippet: "",
    postedAt: null,
    matchedOn: "category",
    matchedTerm: "coffee",
    competitorName: null,
    fingerprint: "hn:1",
  };

  it("drops invented indexes, off-topic threads and untracked competitors", () => {
    const out = groundClassification(
      [thread, { ...thread, fingerprint: "hn:2" }, { ...thread, fingerprint: "hn:3" }],
      {
        threads: [
          {
            index: 0,
            kind: "competitor",
            relevance: 90,
            summary: "See https://x.y now",
            competitor: "MadeUpCo",
          },
          { index: 1, kind: "problem", relevance: MIN_RELEVANCE - 1, summary: "", competitor: "" },
          { index: 7, kind: "problem", relevance: 99, summary: "invented", competitor: "" },
        ],
      },
      ["BeanCo"],
    );
    expect(out.map((t) => t.fingerprint)).toEqual(["hn:1", "hn:3"]);
    // No tracked competitor → keeps the query's own reason.
    expect(out[0]).toMatchObject({ matchedOn: "category", competitorName: null, relevance: 90 });
    expect(out[0].summary).not.toContain("http");
    // Not judged → neutral.
    expect(out[1]).toMatchObject({ relevance: 50, summary: "" });
  });
});

describe("signals", () => {
  it("counts only what exists and needs two threads for a pattern", () => {
    const t = (id: string, title: string, community = "r/espresso") => ({
      id,
      source: "reddit" as const,
      community,
      title,
      snippet: "",
      competitorName: null,
      status: "new",
    });
    const s = communitySignals(
      [
        t("1", "Best alternative to BeanCo for a small café?"),
        t("2", "Alternative to BeanCo for a small café"),
        t("3", "How do I dial in a grinder", "r/barista"),
        { ...t("4", "BeanCo is great"), status: "hidden" },
      ],
      ["BeanCo", "Roastly"],
    );
    expect(s.competitorMentions).toEqual([{ name: "BeanCo", count: 2 }]);
    expect(s.recurringQuestions).toHaveLength(1);
    expect(s.recurringQuestions[0].count).toBe(2);
    expect(s.activeCommunities).toEqual([{ source: "reddit", community: "r/espresso", count: 2 }]);
    expect(mentions("I use beanco daily", "BeanCo")).toBe(true);
    expect(mentions("beancounter", "BeanCo")).toBe(false);
  });
});

describe("reply rules", () => {
  const opts = {
    brandName: "Northside Roasters",
    brandDomain: "northside.coffee",
    source: "reddit" as const,
    facts: "Café Box: 12 kg a month, pause any week.",
  };

  it("drops sentences with figures the brand never gave", () => {
    const out = finishReply(
      "Weigh your waste for a week. We cut waste by 40% for most cafés. The Café Box ships 12 kg a month.",
      opts,
    );
    expect(out.text).not.toContain("40%");
    expect(out.text).toContain("12 kg");
    expect(out.removed).toBe(1);
    expect(figuresKnown("It costs $9", opts.facts)).toBe(false);
  });

  it("says who wrote it when it names the brand", () => {
    const out = finishReply("Northside Roasters lets you pause any week.", opts);
    expect(out.disclosed).toBe(true);
    expect(out.text).toMatch(/Full disclosure: I work at Northside Roasters\.$/);
    const already = finishReply("I work at Northside Roasters, so take this with salt.", opts);
    expect(already.text.match(/disclosure/gi)).toBeNull();
    expect(hasDisclosure(already.text)).toBe(true);
    const plain = finishReply("Weigh your waste for a week.", opts);
    expect(plain.disclosed).toBe(false);
  });

  it("keeps only the brand's own links and fits the community", () => {
    expect(
      keepOwnLinks("see https://northside.coffee/box and https://spam.io/x", ["northside.coffee"]),
    ).toBe("see https://northside.coffee/box and ");
    const long = finishReply(
      `${"Weigh your waste. ".repeat(200)}Northside Roasters can help.`,
      opts,
    );
    expect(long.text.length).toBeLessThanOrEqual(1_400);
  });
});
