// tavily-gateway.server.ts — the only file that reads TAVILY_API_KEY or talks
// to api.tavily.com. Tavily is Mellox's *discovery* layer over the open web:
// who exists, what changed, what is being said, who gets cited. It answers
// questions no amount of reading the customer's own site can answer.
//
// Division of responsibility with the other fetchers, deliberately narrow:
//   Tavily      — search the open web, and (fallback only) pull page text.
//   Firecrawl   — deep, structured crawl of ONE known site (src/lib/firecrawl-gateway.server.ts).
//   safeFetch   — anything this process fetches itself from a user-supplied URL.
// Tavily /extract exists here only so competitor profiling still works where
// Firecrawl is not configured; where Firecrawl IS configured it wins.
//
// The host is a fixed constant, never user input, so requests go through plain
// fetch (via src/server/upstream.ts) rather than the SSRF-guarded safeFetch —
// the same reasoning as any other fixed first-party API host in this codebase.
// User-supplied domains and URLs are a different matter: they are checked with
// assertPublicUrl() BEFORE they enter a request body, because Tavily fetches
// on its own infrastructure, outside this process's SSRF pipeline.
//
// The key is only ever sent in an Authorization header. It is never logged,
// never placed in a URL, and never returned to a caller.
import "server-only";
import { assertPublicUrl } from "@/server/safe-fetch";
import { UpstreamError, fetchWithRetry } from "@/server/upstream";
import { recordUsage } from "@/server/ai/metering";
import { unitPrice } from "@/server/ai/pricing";
import { enforceBudget } from "@/server/ai/budget";
import { cache, digest, recordCacheLookup } from "@/server/cache/store";
import { getRequestScope } from "@/server/request-context";
import { tavilyEnabled } from "@/lib/tavily-flags.server";

export class TavilyGatewayError extends UpstreamError {
  constructor(status: number, message: string, code?: string) {
    super(status, message, { provider: "tavily", code });
    this.name = "TavilyGatewayError";
  }
}

export type TavilySearchResult = {
  url: string;
  title: string;
  snippet: string;
  /** ISO date when the provider reports one (news results usually do). */
  publishedDate?: string;
  /** Provider relevance score, 0..1. Not a Mellox judgement. */
  score: number;
};

export type TavilySearchResponse = {
  results: TavilySearchResult[];
  /** Only present when `includeAnswer` was requested. */
  answer?: string;
};

export type TavilySearchOptions = {
  maxResults?: number;
  /** "advanced" costs about twice as much; use it for research, not for a list. */
  depth?: "basic" | "advanced";
  topic?: "general" | "news";
  /** News only: how many days back. Derived from "when did we last look", never a fixed sweep. */
  days?: number;
  timeRange?: "day" | "week" | "month" | "year";
  includeAnswer?: boolean;
  includeDomains?: string[];
  excludeDomains?: string[];
  /** Override the cache TTL. 0 skips the cache entirely. */
  cacheTtlSeconds?: number;
  timeoutMs?: number;
  /** Attribution for metering. */
  route?: string;
};

export type TavilyExtractResult = { url: string; markdown: string };

const DEFAULT_BASE_URL = "https://api.tavily.com";
const DEFAULT_TIMEOUT_MS = 20_000;
// General web facts move slowly; news does not. Both are well short of the
// windows the callers themselves cache on, so this layer only absorbs the
// duplicate calls a single interaction makes.
const GENERAL_TTL_SECONDS = 6 * 3600;
const NEWS_TTL_SECONDS = 30 * 60;
const MAX_RESULTS_CAP = 20;
const MAX_EXTRACT_URLS = 10;

function baseUrl(): string {
  return (process.env.TAVILY_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function configuredNumber(name: string, fallback: number, maximum: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.min(maximum, Math.round(value)) : fallback;
}

function requireEnabled(): string {
  const key = process.env.TAVILY_API_KEY?.trim();
  if (!tavilyEnabled() || !key) {
    throw new TavilyGatewayError(
      503,
      "Web research is not configured on the server. Set TAVILY_API_KEY.",
      "missing_config",
    );
  }
  return key;
}

/** The narrow slice of the transport this gateway uses — tests inject a fake. */
export type TavilyTransport = (
  path: "/search" | "/extract",
  body: Record<string, unknown>,
  timeoutMs: number,
) => Promise<unknown>;

let transportOverride: TavilyTransport | null = null;

/** Tests inject a fake transport instead of calling the real API. Pass null to reset. */
export function setTavilyTransport(next: TavilyTransport | null): void {
  transportOverride = next;
}

const httpTransport: TavilyTransport = async (path, body, timeoutMs) => {
  const apiKey = requireEnabled();
  const res = await fetchWithRetry(
    `${baseUrl()}${path}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // The key travels in a header only. Never a query parameter, which
        // would land it in provider access logs and any proxy in between.
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    },
    {
      timeoutMs,
      retries: configuredNumber("TAVILY_MAX_RETRIES", 2, 5),
      retryableStatuses: [429, 500, 502, 503, 504],
      onTransportError: ({ kind, detail }) =>
        new TavilyGatewayError(
          kind === "timeout" ? 504 : 502,
          `Web research request ${kind === "timeout" ? "timed out" : "failed"}: ${detail}`,
          kind,
        ),
    },
  );
  if (!res.ok) {
    // The body may echo request fields; keep only a short, non-secret excerpt.
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    if (res.status === 401 || res.status === 403) {
      throw new TavilyGatewayError(503, "Web research rejected the server's credentials.", "auth");
    }
    if (res.status === 429) {
      throw new TavilyGatewayError(429, "Web research is rate limited right now.", "rate_limited");
    }
    throw new TavilyGatewayError(
      502,
      `Web research failed (${res.status}): ${detail}`,
      "provider_error",
    );
  }
  return res.json();
};

function transport(): TavilyTransport {
  return transportOverride ?? httpTransport;
}

function cacheScope(): string {
  const scope = getRequestScope();
  return scope.workspaceId
    ? `ws:${scope.workspaceId}`
    : scope.userId
      ? `u:${scope.userId}`
      : "anon";
}

function meter(args: {
  model: string;
  route: string;
  startedAt: number;
  units: number;
  status: "ok" | "error";
  cached?: boolean;
  costUsd?: number;
}): void {
  const scope = getRequestScope();
  recordUsage({
    provider: "tavily",
    model: args.model,
    route: args.route,
    kind: "search",
    units: args.units,
    cached: args.cached,
    estCostUsd: args.cached ? 0 : args.costUsd,
    savedUsd: args.cached ? args.costUsd : undefined,
    latencyMs: Date.now() - args.startedAt,
    status: args.status,
    workspaceId: scope.workspaceId ?? null,
    userId: scope.userId ?? null,
  });
}

/**
 * Two callers asking the same question in the same tick pay once. The map is
 * per-process and short-lived by construction: an entry is deleted as soon as
 * its promise settles.
 */
const inflight = new Map<string, Promise<unknown>>();

async function dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const promise = fn().finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

/**
 * A user-supplied domain reaches Tavily's crawlers, which run outside this
 * process's SSRF guard. `include_domains` takes bare hostnames, so each is
 * checked as an https URL before it goes anywhere.
 */
function safeDomains(domains: string[] | undefined, field: string): string[] | undefined {
  if (!domains?.length) return undefined;
  return domains.slice(0, 20).map((raw) => {
    const host = raw
      .trim()
      .replace(/^https?:\/\//i, "")
      .replace(/\/.*$/, "");
    try {
      return assertPublicUrl(`https://${host}`).hostname;
    } catch {
      throw new TavilyGatewayError(
        400,
        `${field} contains a host that is not allowed.`,
        "blocked_host",
      );
    }
  });
}

function toResults(raw: unknown): TavilySearchResult[] {
  const rows = (raw as { results?: unknown })?.results;
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row): TavilySearchResult | null => {
      const r = row as Record<string, unknown>;
      const url = typeof r.url === "string" ? r.url : "";
      if (!url.startsWith("http")) return null;
      return {
        url,
        title: (typeof r.title === "string" ? r.title : "").slice(0, 300) || url,
        snippet: (typeof r.content === "string" ? r.content : "").slice(0, 1_200),
        publishedDate: typeof r.published_date === "string" ? r.published_date : undefined,
        score: typeof r.score === "number" ? r.score : 0,
      };
    })
    .filter((row): row is TavilySearchResult => row !== null);
}

function wrapUnknown(error: unknown, action: string): UpstreamError {
  if (error instanceof UpstreamError) return error;
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 300);
  return new TavilyGatewayError(502, `Web research ${action} failed: ${message}`, "provider_error");
}

/**
 * Search the open web. Cached per tenant, deduped in flight, metered, and
 * budget-checked like every other paid call in this codebase. Throws
 * TavilyGatewayError — callers that want graceful degradation should go
 * through src/server/research/web-search.server.ts instead of calling this.
 */
export async function tavilySearch(
  query: string,
  opts: TavilySearchOptions = {},
): Promise<TavilySearchResponse> {
  requireEnabled();
  const trimmed = query.trim().slice(0, 400);
  if (!trimmed) return { results: [] };

  const topic = opts.topic ?? "general";
  const depth = opts.depth ?? "basic";
  const route = opts.route ?? "tavily.search";
  const costUsd = unitPrice(depth === "advanced" ? "tavily:search:advanced" : "tavily:search");

  const body: Record<string, unknown> = {
    query: trimmed,
    search_depth: depth,
    topic,
    max_results: Math.min(MAX_RESULTS_CAP, Math.max(1, opts.maxResults ?? 8)),
    include_answer: opts.includeAnswer ? "basic" : false,
    include_raw_content: false,
    include_images: false,
  };
  if (topic === "news" && opts.days) body.days = Math.min(365, Math.max(1, Math.round(opts.days)));
  if (opts.timeRange) body.time_range = opts.timeRange;
  const include = safeDomains(opts.includeDomains, "includeDomains");
  const exclude = safeDomains(opts.excludeDomains, "excludeDomains");
  if (include) body.include_domains = include;
  if (exclude) body.exclude_domains = exclude;

  const ttl = opts.cacheTtlSeconds ?? (topic === "news" ? NEWS_TTL_SECONDS : GENERAL_TTL_SECONDS);
  const key = `tavily:${await digest(`${cacheScope()}|${JSON.stringify(body)}`)}`;

  if (ttl > 0) {
    const hit = await cache.get<TavilySearchResponse>(key);
    recordCacheLookup("tavily", Boolean(hit));
    if (hit) {
      meter({
        model: `search:${depth}`,
        route,
        startedAt: Date.now(),
        units: 1,
        status: "ok",
        cached: true,
        costUsd,
      });
      return hit;
    }
  }

  // The budget check sits after the cache: a cached answer costs nothing, so
  // being over a ceiling should not stop it being served.
  await enforceBudget("search");

  const started = Date.now();
  try {
    const raw = await dedupe(key, () =>
      transport()(
        "/search",
        body,
        opts.timeoutMs ?? configuredNumber("TAVILY_TIMEOUT_MS", DEFAULT_TIMEOUT_MS, 120_000),
      ),
    );
    const answer = (raw as { answer?: unknown })?.answer;
    const response: TavilySearchResponse = {
      results: toResults(raw),
      answer:
        typeof answer === "string" && answer.trim() ? answer.trim().slice(0, 4_000) : undefined,
    };
    meter({ model: `search:${depth}`, route, startedAt: started, units: 1, status: "ok", costUsd });
    // An empty result set is a real answer for a niche query, but caching it
    // would hide a provider hiccup for hours. Only cache something useful.
    if (ttl > 0 && (response.results.length > 0 || response.answer)) {
      await cache.set(key, response, ttl);
    }
    return response;
  } catch (error) {
    meter({
      model: `search:${depth}`,
      route,
      startedAt: started,
      units: 1,
      status: "error",
      costUsd,
    });
    throw wrapUnknown(error, "search");
  }
}

/**
 * Pull readable text for URLs already discovered. A FALLBACK for competitor
 * profiling where Firecrawl is not configured — never a replacement for it,
 * and never a way to crawl a site (it fetches exactly the URLs given).
 */
export async function tavilyExtract(
  urls: string[],
  opts: { timeoutMs?: number; route?: string; cacheTtlSeconds?: number } = {},
): Promise<TavilyExtractResult[]> {
  requireEnabled();
  // Every URL here can originate from a workspace, so each is SSRF-checked
  // before Tavily's infrastructure is pointed at it. An unusable URL is
  // dropped rather than failing the batch.
  const safe = urls
    .slice(0, MAX_EXTRACT_URLS)
    .map((url) => {
      try {
        return assertPublicUrl(url).toString();
      } catch {
        return null;
      }
    })
    .filter((url): url is string => url !== null);
  if (!safe.length) return [];

  const route = opts.route ?? "tavily.extract";
  const costUsd = unitPrice("tavily:extract") * safe.length;
  const body = { urls: safe, extract_depth: "basic", format: "markdown" };
  const ttl = opts.cacheTtlSeconds ?? GENERAL_TTL_SECONDS;
  const key = `tavily:${await digest(`${cacheScope()}|extract|${JSON.stringify(body)}`)}`;

  if (ttl > 0) {
    const hit = await cache.get<TavilyExtractResult[]>(key);
    recordCacheLookup("tavily", Boolean(hit));
    if (hit) {
      meter({
        model: "extract",
        route,
        startedAt: Date.now(),
        units: safe.length,
        status: "ok",
        cached: true,
        costUsd,
      });
      return hit;
    }
  }

  await enforceBudget("search");
  const started = Date.now();
  try {
    const raw = await dedupe(key, () =>
      transport()(
        "/extract",
        body,
        opts.timeoutMs ?? configuredNumber("TAVILY_TIMEOUT_MS", DEFAULT_TIMEOUT_MS, 120_000),
      ),
    );
    const rows = (raw as { results?: unknown })?.results;
    const pages = Array.isArray(rows)
      ? rows
          .map((row) => {
            const r = row as Record<string, unknown>;
            const url = typeof r.url === "string" ? r.url : "";
            const content = typeof r.raw_content === "string" ? r.raw_content : "";
            return url && content ? { url, markdown: content } : null;
          })
          .filter((row): row is TavilyExtractResult => row !== null)
      : [];
    meter({
      model: "extract",
      route,
      startedAt: started,
      units: safe.length,
      status: "ok",
      costUsd,
    });
    if (ttl > 0 && pages.length) await cache.set(key, pages, ttl);
    return pages;
  } catch (error) {
    meter({
      model: "extract",
      route,
      startedAt: started,
      units: safe.length,
      status: "error",
      costUsd,
    });
    throw wrapUnknown(error, "extract");
  }
}
