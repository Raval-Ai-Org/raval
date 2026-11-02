// queries.ts — what Community Intelligence searches for. Pure.
//
// Every query is built here from what the workspace already stores: Brand DNA
// (category, keywords, the problems it solves), its products, its audience
// groups' pains, its tracked competitors, its goal and the person's own
// watches. A model never writes a query, so a search can only ever be about
// the brand's own world.
import type { CommunitySource, MatchKind } from "./contracts";

export type QueryContext = {
  brandName: string;
  /** The brand's own site host, never searched for (we want other people's words). */
  domain: string | null;
  category: string;
  keywords: string[];
  products: string[];
  /** Problems the brand solves, in its customers' words where known. */
  problems: string[];
  /** Tracked competitors only. */
  competitors: string[];
  /** The goal's focus, when one is set. */
  goalFocus: string | null;
  watchKeywords: string[];
  /** Subreddits / Stack Exchange sites a person keeps ("r/espresso", "coffee"). */
  watchCommunities: string[];
};

export type CommunityQuery = {
  /** Which discovery path runs it. Reddit and Quora go through web search. */
  source: CommunitySource;
  text: string;
  matchedOn: MatchKind;
  /** The brand fact the query came from, shown as "found for …". */
  term: string;
  competitorName: string | null;
  /** Web search only: restrict results to these hosts. */
  includeDomains?: string[];
};

export const MAX_QUERIES = 14;
const MAX_TERM = 60;

/** Tidy one term: words only, no quotes or operators a person didn't mean. */
export function cleanTerm(raw: string): string {
  return raw
    .replace(/["“”'`]/g, "")
    .replace(/\b(site|inurl|intitle):\S*/gi, "")
    .replace(/[^\p{L}\p{N}\s&+.#/-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TERM)
    .trim();
}

function uniq(list: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const term = cleanTerm(raw);
    const key = term.toLowerCase();
    if (term.length < 3 || seen.has(key)) continue;
    seen.add(key);
    out.push(term);
    if (out.length >= max) break;
  }
  return out;
}

/** A subreddit name from "r/espresso", "/r/espresso" or a reddit link. Null otherwise. */
export function subredditOf(raw: string): string | null {
  const m = raw.trim().match(/(?:^|reddit\.com)\/?r\/([A-Za-z0-9_]{2,21})\b/i);
  return m ? m[1] : null;
}

/** A Stack Exchange site slug ("superuser", "cooking") — never a subreddit. */
export function stackSiteOf(raw: string): string | null {
  const t = raw.trim().toLowerCase();
  if (subredditOf(t)) return null;
  const host = t.match(/^(?:https?:\/\/)?([a-z0-9-]+)\.stackexchange\.com/);
  if (host) return host[1];
  const known = ["stackoverflow", "superuser", "serverfault", "askubuntu"];
  if (known.includes(t)) return t;
  return null;
}

const REDDIT = ["reddit.com"];
const QUORA = ["quora.com"];

/**
 * The queries for one refresh, most valuable first, at most MAX_QUERIES.
 * "Alternative to X" and problem questions come before category talk because
 * they are where a helpful reply is most welcome.
 */
export function buildCommunityQueries(ctx: QueryContext): CommunityQuery[] {
  const category = cleanTerm(ctx.category);
  const competitors = uniq(ctx.competitors, 4);
  const problems = uniq([...ctx.watchKeywords, ...ctx.problems], 4);
  const topics = uniq([category, ...ctx.keywords, ...ctx.products], 4).filter(
    (t) => t.toLowerCase() !== cleanTerm(ctx.brandName).toLowerCase(),
  );
  const subreddits = ctx.watchCommunities.map(subredditOf).filter((s): s is string => !!s);
  const sellingGoal = ctx.goalFocus === "leads" || ctx.goalFocus === "sales";

  const out: CommunityQuery[] = [];
  const push = (q: CommunityQuery) => {
    if (!q.text.trim()) return;
    const key = `${q.source}|${q.text.toLowerCase()}`;
    if (out.some((o) => `${o.source}|${o.text.toLowerCase()}` === key)) return;
    out.push(q);
  };

  // 1. People leaving a competitor.
  for (const name of competitors.slice(0, sellingGoal ? 3 : 2)) {
    push({
      source: "reddit",
      text: `alternative to ${name}`,
      matchedOn: "alternative",
      term: name,
      competitorName: name,
      includeDomains: REDDIT,
    });
  }
  // 2. The problem the brand solves, asked as a question.
  for (const problem of problems.slice(0, 3)) {
    push({
      source: "reddit",
      text: `how to ${problem}`.replace(/^how to how to /i, "how to "),
      matchedOn: "problem",
      term: problem,
      competitorName: null,
      includeDomains: REDDIT,
    });
    push({
      source: "quora",
      text: problem,
      matchedOn: "problem",
      term: problem,
      competitorName: null,
      includeDomains: QUORA,
    });
  }
  // 3. Competitors talked about by name.
  for (const name of competitors.slice(0, 2)) {
    push({
      source: "reddit",
      text: `${name} review`,
      matchedOn: "competitor",
      term: name,
      competitorName: name,
      includeDomains: REDDIT,
    });
    push({
      source: "hackernews",
      text: name,
      matchedOn: "competitor",
      term: name,
      competitorName: name,
    });
  }
  // 4. The field itself: "best X", in the communities a person keeps.
  for (const topic of topics.slice(0, 2)) {
    const where = subreddits.length ? ` ${subreddits.map((s) => `r/${s}`).join(" ")}` : "";
    push({
      source: "reddit",
      text: `best ${topic}${where}`.slice(0, 120),
      matchedOn: "category",
      term: topic,
      competitorName: null,
      includeDomains: REDDIT,
    });
    push({
      source: "stackexchange",
      text: topic,
      matchedOn: "category",
      term: topic,
      competitorName: null,
    });
    push({
      source: "hackernews",
      text: topic,
      matchedOn: "category",
      term: topic,
      competitorName: null,
    });
    push({
      source: "quora",
      text: `best ${topic}`,
      matchedOn: "category",
      term: topic,
      competitorName: null,
      includeDomains: QUORA,
    });
  }
  return out.slice(0, MAX_QUERIES);
}

/** True when there is enough to search for at all. */
export function hasSomethingToSearch(ctx: QueryContext): boolean {
  return buildCommunityQueries(ctx).length > 0;
}

/** Stack Exchange has no search across sites: the sites a person keeps, else Stack Overflow. */
export function stackSitesFor(ctx: Pick<QueryContext, "watchCommunities">): string[] {
  const kept = ctx.watchCommunities.map(stackSiteOf).filter((s): s is string => !!s);
  return kept.length ? [...new Set(kept)].slice(0, 2) : ["stackoverflow"];
}
