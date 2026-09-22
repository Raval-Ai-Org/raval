// market-signals.server.ts — Market Brain's measured evidence, via Tavily web
// search instead of Google Trends/DataForSEO (removed from the product; see
// docs/adr/0023-tavily-market-signals.md). DataForSEO reported a numeric
// search-interest index that nothing else in Mellox produces; Tavily cannot
// replicate that, so Market Brain's evidence is now the same thing every other
// research surface in this codebase already uses — real, dated, linkable web
// sources — read through webSearchMany(), the one search path (ADR-0022).
//
// This is a thin, pure-ish wrapper: it owns the query shape and the output
// type, not caching or budget (src/lib/market-signals-collection.server.ts
// owns those, same split as competitor-intel.server.ts / web-search.server.ts).
import "server-only";
import { webSearchMany } from "@/server/research/web-search.server";
import { hostOf, type WebSource } from "@/lib/research/sources";

export type MarketSignalSource = {
  title: string;
  url: string;
  snippet: string;
  domain: string;
  /** ISO date, only when the provider actually reported one. */
  publishedDate: string | null;
};

export type MarketSignalsInput = {
  keywords: string[];
  location?: string;
};

export type MarketSignalsData = {
  keywords: string[];
  location: string | null;
  sources: MarketSignalSource[];
};

// How far back a "what's moving right now" scan looks. A daily re-scan with
// the same lens still finds new coverage inside this window.
const RECENCY_DAYS = 45;
const MAX_SOURCES = 15;

function toMarketSource(source: WebSource): MarketSignalSource {
  return {
    title: source.title,
    url: source.url,
    snippet: source.snippet,
    domain: hostOf(source.url),
    publishedDate: source.publishedDate ?? null,
  };
}

function buildQueries(input: MarketSignalsInput): string[] {
  const location = input.location?.trim();
  return input.keywords
    .map((keyword) => keyword.trim())
    .filter(Boolean)
    .slice(0, 5)
    .map((keyword) => (location ? `${keyword} ${location}` : keyword));
}

/**
 * Gather recent web coverage of `input.keywords` (optionally narrowed to
 * `input.location`). Never throws — webSearchMany() degrades through its own
 * provider ladder and returns an empty list rather than failing; an empty
 * result is a fact about the market ("nothing recent"), not an error.
 */
export async function collectMarketSignals(
  input: MarketSignalsInput,
  opts: { route?: string } = {},
): Promise<MarketSignalsData> {
  const queries = buildQueries(input);
  const sources = queries.length
    ? await webSearchMany(queries, {
        topic: "news",
        days: RECENCY_DAYS,
        limit: MAX_SOURCES,
        perHost: 2,
        route: opts.route ?? "market-signals",
      })
    : [];
  return {
    keywords: input.keywords,
    location: input.location?.trim() || null,
    sources: sources.map(toMarketSource),
  };
}

/** True when a collection carries any real evidence at all. */
export function hasMarketSignal(data: MarketSignalsData): boolean {
  return data.sources.length > 0;
}
