import { describe, expect, it } from "vitest";
import {
  buildDiscoveryQueries,
  candidatesFromSources,
  type DiscoveryContext,
} from "./discovery.server";
import type { WebSource } from "@/lib/research/sources";

function context(overrides: Partial<DiscoveryContext> = {}): DiscoveryContext {
  return {
    brandName: "Acme Coffee",
    domain: "acmecoffee.com",
    industry: "speciality coffee subscription",
    oneLiner: "Fresh beans, posted monthly",
    products: "Subscriptions, gift boxes",
    audience: "Home brewers in the UK",
    keywords: ["coffee subscription", "speciality beans"],
    knownDomains: [],
    ...overrides,
  };
}

function source(url: string, title = url, snippet = "snippet"): WebSource {
  return { url, title, snippet, provider: "tavily" };
}

describe("buildDiscoveryQueries", () => {
  it("searches around the brand and its category", () => {
    const queries = buildDiscoveryQueries(context());
    expect(queries.some((query) => query.includes("Acme Coffee competitors"))).toBe(true);
    expect(queries.some((query) => query.includes("speciality coffee subscription"))).toBe(true);
  });

  it("includes the audience when there is one, so results are for the right buyer", () => {
    const queries = buildDiscoveryQueries(context());
    expect(queries.some((query) => query.includes("Home brewers in the UK"))).toBe(true);
  });

  it("falls back to the keywords when no industry is recorded", () => {
    const queries = buildDiscoveryQueries(context({ industry: "" }));
    expect(queries.some((query) => query.includes("coffee subscription"))).toBe(true);
  });

  it("still searches from the domain alone when nothing else is known", () => {
    const queries = buildDiscoveryQueries(
      context({ brandName: "", industry: "", keywords: [], products: "" }),
    );
    expect(queries).toEqual(["sites like acmecoffee.com"]);
  });

  it("returns nothing to search when there is no business context at all", () => {
    const queries = buildDiscoveryQueries(
      context({ brandName: "", domain: null, industry: "", keywords: [], products: "" }),
    );
    expect(queries).toEqual([]);
  });

  it("never runs more than four searches", () => {
    expect(buildDiscoveryQueries(context()).length).toBeLessThanOrEqual(4);
  });
});

describe("candidatesFromSources", () => {
  it("keeps a company's own site as a candidate", () => {
    const candidates = candidatesFromSources([source("https://rivalbeans.com/about")], context());
    expect(candidates.map((candidate) => candidate.domain)).toEqual(["rivalbeans.com"]);
  });

  it("never proposes the business itself", () => {
    const candidates = candidatesFromSources(
      [source("https://www.acmecoffee.com/blog"), source("https://rivalbeans.com")],
      context(),
    );
    expect(candidates.map((candidate) => candidate.domain)).toEqual(["rivalbeans.com"]);
  });

  it("never re-proposes a competitor the workspace already knows about", () => {
    const candidates = candidatesFromSources(
      [source("https://known.com"), source("https://fresh.com")],
      context({ knownDomains: ["known.com"] }),
    );
    expect(candidates.map((candidate) => candidate.domain)).toEqual(["fresh.com"]);
  });

  it("drops review sites and listicles, which write about companies rather than being one", () => {
    const candidates = candidatesFromSources(
      [
        source("https://www.g2.com/categories/coffee"),
        source("https://en.wikipedia.org/wiki/Coffee"),
        source("https://www.reddit.com/r/coffee/comments/x"),
        source("https://realrival.com"),
      ],
      context(),
    );
    expect(candidates.map((candidate) => candidate.domain)).toEqual(["realrival.com"]);
  });

  it("drops file hosts and throwaway domains", () => {
    const candidates = candidatesFromSources(
      [source("https://bit.ly/abc"), source("https://spam.xyz"), source("https://real.com")],
      context(),
    );
    expect(candidates.map((candidate) => candidate.domain)).toEqual(["real.com"]);
  });

  it("merges several results for one company into one candidate with its evidence", () => {
    const candidates = candidatesFromSources(
      [
        source("https://rival.com/a", "Rival home", "they roast beans"),
        source("https://rival.com/b", "Rival pricing", "from £12 a month"),
      ],
      context(),
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].snippets).toEqual(["they roast beans", "from £12 a month"]);
  });

  it("caps the evidence it keeps per candidate", () => {
    const candidates = candidatesFromSources(
      Array.from({ length: 8 }, (_, index) => source(`https://rival.com/${index}`)),
      context(),
    );
    expect(candidates[0].snippets.length).toBeLessThanOrEqual(3);
  });
});
