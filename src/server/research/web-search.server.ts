// web-search.server.ts — the one way anything in Mellox searches the open web.
//
// Before this module there were two byte-for-byte copies of a DuckDuckGo HTML
// scrape (brand-extract.server.ts and fns/coach.ts), each with its own
// Firecrawl preamble. That meant Brand DNA onboarding and the Marketing Coach
// could silently disagree about what the web says, and any improvement had to
// be made twice. Everything now calls webSearch().
//
// The provider chain is a quality ladder, not a load balancer:
//   1. Tavily    — a real research API: ranked results, snippets, dates, news.
//   2. Firecrawl — a real search API, when a self-hosted instance is configured.
//   3. DuckDuckGo HTML — the historical scrape. Kept so behaviour is unchanged
//      on a server with neither provider configured, never preferred.
// Each step falls through on failure or an empty result, so a provider outage
// degrades the answer rather than failing the request. This function does not
// throw: callers treat "no sources" as a fact about the world, not an error.
import "server-only";
import { stripHtml } from "@/lib/crawl/html";
import { tavilyEnabled } from "@/lib/tavily-flags.server";
import { firecrawlEnabled } from "@/lib/firecrawl-flags.server";
import { dedupeSources, rankSources, type WebSource } from "@/lib/research/sources";

export type { WebSource } from "@/lib/research/sources";

export type WebSearchOptions = {
  limit?: number;
  /** "news" asks the provider for recent coverage; only Tavily honours it. */
  topic?: "general" | "news";
  /** News only: how far back to look. Derive it from "when did we last check". */
  days?: number;
  /** Deeper, ~2x cost. For research passes, not for listing. */
  depth?: "basic" | "advanced";
  includeDomains?: string[];
  excludeDomains?: string[];
  /** At most this many results from any one host. Default 2. */
  perHost?: number;
  timeoutMs?: number;
  /** Attribution for metering. */
  route?: string;
  cacheTtlSeconds?: number;
};

/** True when a real research provider is available (not just the DDG scrape). */
export function webResearchAvailable(): boolean {
  return tavilyEnabled() || firecrawlEnabled();
}

/** Which provider a search would use right now — for "not configured" copy. */
export function webResearchProvider(): "tavily" | "firecrawl" | "ddg" {
  if (tavilyEnabled()) return "tavily";
  if (firecrawlEnabled()) return "firecrawl";
  return "ddg";
}

async function searchTavily(query: string, opts: WebSearchOptions): Promise<WebSource[]> {
  const { tavilySearch } = await import("@/lib/tavily-gateway.server");
  const response = await tavilySearch(query, {
    maxResults: opts.limit ?? 8,
    topic: opts.topic,
    days: opts.days,
    depth: opts.depth,
    includeDomains: opts.includeDomains,
    excludeDomains: opts.excludeDomains,
    timeoutMs: opts.timeoutMs,
    route: opts.route ?? "web-search",
    cacheTtlSeconds: opts.cacheTtlSeconds,
  });
  return response.results.map((result) => ({
    title: result.title,
    url: result.url,
    snippet: result.snippet,
    publishedDate: result.publishedDate,
    score: result.score,
    provider: "tavily" as const,
  }));
}

async function searchFirecrawl(query: string, opts: WebSearchOptions): Promise<WebSource[]> {
  const { firecrawlSearch } = await import("@/lib/firecrawl-gateway.server");
  const results = await firecrawlSearch(query, { limit: opts.limit ?? 8 });
  return results.map((result) => ({
    title: result.title || result.url,
    url: result.url,
    snippet: result.description || "",
    provider: "firecrawl" as const,
  }));
}

/**
 * The pre-Firecrawl behaviour, moved here verbatim from the two places that
 * each had their own copy. No API key, no metering, and no guarantees — it is
 * the floor, so a server with nothing configured still returns something.
 */
async function searchDuckDuckGo(query: string, opts: WebSearchOptions): Promise<WebSource[]> {
  const limit = opts.limit ?? 8;
  try {
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      headers: { "User-Agent": "Mozilla/5.0 MelloxResearchBot" },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 6_000),
    });
    if (!res.ok) return [];
    const html = await res.text();
    const out: WebSource[] = [];
    const re =
      /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
    for (const match of html.matchAll(re)) {
      let url = match[1];
      const redirected = url.match(/[?&]uddg=([^&]+)/);
      if (redirected) {
        try {
          url = decodeURIComponent(redirected[1]);
        } catch {
          /* keep the raw href */
        }
      }
      const title = stripHtml(match[2], 200);
      const snippet = stripHtml(match[3], 320);
      if (title && url.startsWith("http")) {
        out.push({ title, url, snippet, provider: "ddg" });
      }
      if (out.length >= limit) break;
    }
    return out;
  } catch {
    return [];
  }
}

/**
 * Search the web. Returns deduped, ranked, quality-filtered sources, or an
 * empty array when nothing usable came back. Never throws.
 */
export async function webSearch(query: string, opts: WebSearchOptions = {}): Promise<WebSource[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const providers: Array<[string, () => Promise<WebSource[]>]> = [];
  if (tavilyEnabled()) providers.push(["tavily", () => searchTavily(trimmed, opts)]);
  if (firecrawlEnabled()) providers.push(["firecrawl", () => searchFirecrawl(trimmed, opts)]);
  providers.push(["duckduckgo", () => searchDuckDuckGo(trimmed, opts)]);

  for (const [name, run] of providers) {
    try {
      const results = await run();
      if (results.length) {
        return dedupeSources(rankSources(results), {
          perHost: opts.perHost ?? 2,
          limit: opts.limit ?? 8,
        });
      }
    } catch (error) {
      // A provider being down is expected operational noise, not a failure of
      // the caller's request — log it and try the next rung of the ladder.
      console.error(`[web-search] ${name} search failed, falling through`, error);
    }
  }
  return [];
}

/**
 * Run several searches at once and merge them into one deduped source list.
 * Cheaper than it looks: identical queries collapse in the gateway's in-flight
 * dedupe, and every result is cached per tenant.
 */
export async function webSearchMany(
  queries: readonly string[],
  opts: WebSearchOptions = {},
): Promise<WebSource[]> {
  const perQuery = Math.max(3, Math.ceil((opts.limit ?? 12) / Math.max(1, queries.length)) + 2);
  const batches = await Promise.all(
    queries.filter(Boolean).map((query) => webSearch(query, { ...opts, limit: perQuery })),
  );
  return dedupeSources(rankSources(batches.flat()), {
    perHost: opts.perHost ?? 2,
    limit: opts.limit ?? 12,
  });
}

/**
 * A short grounded answer plus the sources behind it. Only Tavily can produce
 * the answer itself; with any other provider this returns sources and an empty
 * answer, and the caller's own model does the reasoning — which is the
 * arrangement Mellox wants anyway: the provider supplies information, Mellox
 * supplies the intelligence.
 */
export async function webAnswer(
  query: string,
  opts: WebSearchOptions = {},
): Promise<{ answer: string; sources: WebSource[] }> {
  const trimmed = query.trim();
  if (!trimmed) return { answer: "", sources: [] };

  if (tavilyEnabled()) {
    try {
      const { tavilySearch } = await import("@/lib/tavily-gateway.server");
      const response = await tavilySearch(trimmed, {
        maxResults: opts.limit ?? 6,
        topic: opts.topic,
        days: opts.days,
        depth: opts.depth,
        includeAnswer: true,
        timeoutMs: opts.timeoutMs,
        route: opts.route ?? "web-answer",
        cacheTtlSeconds: opts.cacheTtlSeconds,
      });
      const sources = dedupeSources(
        rankSources(
          response.results.map((result) => ({
            title: result.title,
            url: result.url,
            snippet: result.snippet,
            publishedDate: result.publishedDate,
            score: result.score,
            provider: "tavily" as const,
          })),
        ),
        { perHost: opts.perHost ?? 2, limit: opts.limit ?? 6 },
      );
      if (sources.length || response.answer) {
        return { answer: response.answer ?? "", sources };
      }
    } catch (error) {
      console.error("[web-search] tavily answer failed, falling back to search", error);
    }
  }
  return { answer: "", sources: await webSearch(trimmed, opts) };
}
