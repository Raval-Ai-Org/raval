// discover.server.ts — running the community queries.
//
//   * Reddit and Quora: the one web-search path (webSearchMany's sibling
//     webSearch) with includeDomains. Reddit's own API is not used: Reddit
//     requires written approval for commercial use, which Mellox doesn't have.
//   * Hacker News: the open Algolia search API, through safeFetch.
//   * Stack Exchange: the official API, through safeFetch. `STACKEXCHANGE_KEY`
//     raises the daily quota; without it the API still answers at a low quota.
//
// Never throws: a source that fails returns nothing, and the refresh keeps
// whatever the others found.
import "server-only";
import { safeFetch } from "@/server/safe-fetch";
import { webResearchAvailable, webSearch } from "@/server/research/web-search.server";
import { stackSitesFor, type CommunityQuery, type QueryContext } from "@/lib/community/queries";
import {
  threadFromWebResult,
  threadsFromHn,
  threadsFromStackExchange,
  type RawThread,
} from "@/lib/community/threads";

const HN_SEARCH = "https://hn.algolia.com/api/v1/search";
const SE_SEARCH = "https://api.stackexchange.com/2.3/search/advanced";
const PER_QUERY = 8;
/** Only discussions from the last ~six months are worth replying to. */
const RECENT_DAYS = 180;

const hostIs = (allowed: string) => (url: URL) => url.hostname === allowed;

async function getJson(url: URL, host: string): Promise<unknown> {
  try {
    const res = await safeFetch(url, {
      validateUrl: hostIs(host),
      headers: { accept: "application/json", "user-agent": "MelloxCommunityBot/1.0" },
      timeoutMs: 8_000,
      maxBytes: 2 * 1024 * 1024,
      onOverflow: "error",
    });
    if (!res.ok) {
      console.warn(`[community] ${host} answered ${res.status}`);
      return null;
    }
    return JSON.parse(res.text());
  } catch (error) {
    console.warn(`[community] ${host} failed`, error instanceof Error ? error.message : error);
    return null;
  }
}

async function runWeb(query: CommunityQuery): Promise<RawThread[]> {
  const results = await webSearch(query.text, {
    limit: PER_QUERY,
    includeDomains: query.includeDomains,
    // Every result is on the same host here; the default per-host cap would keep two.
    perHost: PER_QUERY,
    route: "community.refresh",
    cacheTtlSeconds: 6 * 3600,
  });
  return results.map((r) => threadFromWebResult(r, query)).filter((t): t is RawThread => !!t);
}

async function runHn(query: CommunityQuery, now: number): Promise<RawThread[]> {
  const url = new URL(HN_SEARCH);
  url.searchParams.set("query", query.text);
  url.searchParams.set("tags", "story");
  url.searchParams.set("hitsPerPage", String(PER_QUERY));
  url.searchParams.set(
    "numericFilters",
    `created_at_i>${Math.floor((now - RECENT_DAYS * 86_400_000) / 1000)}`,
  );
  return threadsFromHn(await getJson(url, "hn.algolia.com"), query);
}

async function runStackExchange(
  query: CommunityQuery,
  site: string,
  now: number,
): Promise<RawThread[]> {
  const url = new URL(SE_SEARCH);
  url.searchParams.set("order", "desc");
  url.searchParams.set("sort", "relevance");
  url.searchParams.set("q", query.text);
  url.searchParams.set("site", site);
  url.searchParams.set("pagesize", String(PER_QUERY));
  url.searchParams.set("fromdate", String(Math.floor((now - RECENT_DAYS * 86_400_000) / 1000)));
  url.searchParams.set("filter", "withbody");
  // Stack Exchange takes its app key as a query parameter (it is a quota key,
  // not a secret); the URL is never logged.
  const key = process.env.STACKEXCHANGE_KEY?.trim();
  if (key) url.searchParams.set("key", key);
  return threadsFromStackExchange(await getJson(url, "api.stackexchange.com"), query);
}

export async function runCommunityQueries(
  queries: readonly CommunityQuery[],
  ctx: Pick<QueryContext, "watchCommunities">,
  now = Date.now(),
): Promise<{ threads: RawThread[]; searched: number }> {
  const web = webResearchAvailable();
  const sites = stackSitesFor(ctx);
  const jobs: Array<Promise<RawThread[]>> = [];
  for (const q of queries) {
    if (q.source === "reddit" || q.source === "quora") {
      // The DuckDuckGo floor ignores includeDomains; without a real provider
      // these would mostly be other sites, so they are skipped.
      if (web) jobs.push(runWeb(q));
    } else if (q.source === "hackernews") {
      jobs.push(runHn(q, now));
    } else {
      for (const site of sites) jobs.push(runStackExchange(q, site, now));
    }
  }
  const settled = await Promise.allSettled(jobs);
  const threads = settled.flatMap((s) => (s.status === "fulfilled" ? s.value : []));
  return { threads, searched: jobs.length };
}
