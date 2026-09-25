// firecrawl-gateway.server.ts — self-hosted Firecrawl client for website
// scraping/crawling/mapping/search (Brand DNA extraction, competitor
// research, market research, GEO/AEO research, source-grounded research).
//
// Firecrawl does its OWN fetching on ITS OWN infrastructure, entirely outside
// this process's SSRF-guarded fetcher (src/server/safe-fetch.ts). Every
// function here that takes a user-supplied URL calls assertPublicUrl() first
// — required defense-in-depth, since skipping it would let a workspace point
// this server's Firecrawl instance at an internal address
// (e.g. http://169.254.169.254/) under the guise of "a website to analyze".
//
// Deliberately never uses Firecrawl's LLM-powered /extract format — only
// markdown/links — so every synthesis step still goes through this
// codebase's own metered, budget-checked gateways
// (src/lib/ai-gateway.server.ts), never a side channel through a
// Firecrawl-configured LLM key.
import "server-only";
import FirecrawlSdk from "@mendable/firecrawl-js";
import { assertPublicUrl } from "@/server/safe-fetch";
import { UpstreamError } from "@/server/upstream";
import { recordUsage } from "@/server/ai/metering";
import { firecrawlEnabled } from "@/lib/firecrawl-flags.server";

export class FirecrawlGatewayError extends UpstreamError {
  constructor(status: number, message: string, code?: string) {
    super(status, message, { provider: "firecrawl", code });
    this.name = "FirecrawlGatewayError";
  }
}

export type FirecrawlPage = {
  url: string;
  markdown: string;
  links: string[];
  title?: string;
  description?: string;
};

export type FirecrawlSearchResult = { url: string; title?: string; description?: string };

type FirecrawlDocLike = {
  markdown?: string;
  links?: string[];
  metadata?: { title?: string; description?: string; sourceURL?: string };
};

/** The narrow slice of the SDK's surface this gateway actually calls — tests inject a fake. */
export type FirecrawlClientLike = {
  scrape: (url: string, options?: Record<string, unknown>) => Promise<FirecrawlDocLike>;
  crawl: (url: string, options?: Record<string, unknown>) => Promise<{ data: FirecrawlDocLike[] }>;
  map: (
    url: string,
    options?: Record<string, unknown>,
  ) => Promise<{ links: Array<{ url: string; title?: string; description?: string }> }>;
  search: (
    query: string,
    options?: Record<string, unknown>,
  ) => Promise<{ web?: Array<{ url: string; title?: string; description?: string }> }>;
};

function buildClient(): FirecrawlClientLike {
  const apiUrl = process.env.FIRECRAWL_BASE_URL?.trim() || undefined;
  const apiKey = process.env.FIRECRAWL_API_KEY?.trim() || undefined;
  return new FirecrawlSdk({ apiUrl, apiKey }) as unknown as FirecrawlClientLike;
}

let clientOverride: FirecrawlClientLike | null = null;

/** Tests inject a fake client instead of hitting a real Firecrawl instance. Pass null to reset. */
export function setFirecrawlClient(next: FirecrawlClientLike | null): void {
  clientOverride = next;
}

function client(): FirecrawlClientLike {
  return clientOverride ?? buildClient();
}

function requireEnabled(): void {
  if (!firecrawlEnabled()) {
    throw new FirecrawlGatewayError(
      503,
      "Firecrawl is not configured on the server. Set FIRECRAWL_BASE_URL.",
      "missing_config",
    );
  }
}

function mapError(error: unknown, action: string): FirecrawlGatewayError {
  if (error instanceof FirecrawlGatewayError) return error;
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 300);
  return new FirecrawlGatewayError(502, `Firecrawl ${action} failed: ${message}`, "provider_error");
}

function toPage(fallbackUrl: string, doc: FirecrawlDocLike | undefined): FirecrawlPage {
  return {
    url: doc?.metadata?.sourceURL || fallbackUrl,
    markdown: doc?.markdown ?? "",
    links: Array.isArray(doc?.links) ? doc.links : [],
    title: doc?.metadata?.title,
    description: doc?.metadata?.description,
  };
}

function meter(
  model: string,
  route: string,
  startedAt: number,
  units: number,
  status: "ok" | "error",
) {
  recordUsage({
    provider: "firecrawl",
    model,
    route,
    kind: "search",
    units,
    latencyMs: Date.now() - startedAt,
    status,
  });
}

const DEFAULT_TIMEOUT_MS = 30_000;

function configuredNumber(name: string, fallback: number, maximum: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.min(maximum, Math.max(0, Math.round(value))) : fallback;
}

function retryable(error: unknown): boolean {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return /timeout|timed out|abort|econn|enotfound|429|502|503|504|network/.test(message);
}

async function withFirecrawlRetry<T>(operation: () => Promise<T>, timeoutMs?: number): Promise<T> {
  const budget = Math.max(
    1_000,
    timeoutMs ?? configuredNumber("FIRECRAWL_TIMEOUT_MS", DEFAULT_TIMEOUT_MS, 120_000),
  );
  const maxRetries = configuredNumber("FIRECRAWL_MAX_RETRIES", 2, 5);
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), budget);
    try {
      return await Promise.race([
        operation(),
        new Promise<never>((_, reject) =>
          controller.signal.addEventListener(
            "abort",
            () => reject(new Error("Firecrawl request timed out")),
            {
              once: true,
            },
          ),
        ),
      ]);
    } catch (error) {
      lastError = error;
      if (attempt === maxRetries || !retryable(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

/** Scrape one URL to markdown + links. Throws FirecrawlGatewayError on any failure. */
export async function firecrawlScrape(
  url: string,
  opts: { timeoutMs?: number } = {},
): Promise<FirecrawlPage> {
  requireEnabled();
  assertPublicUrl(url);
  const started = Date.now();
  try {
    const doc = await withFirecrawlRetry(
      () =>
        client().scrape(url, {
          formats: ["markdown", "links"],
          timeout: opts.timeoutMs,
        }),
      opts.timeoutMs,
    );
    meter("scrape", "firecrawl.scrape", started, 1, "ok");
    return toPage(url, doc);
  } catch (error) {
    meter("scrape", "firecrawl.scrape", started, 1, "error");
    throw mapError(error, "scrape");
  }
}

/** Crawl a site starting at URL, up to `limit` pages. Throws FirecrawlGatewayError on any failure. */
export async function firecrawlCrawl(
  url: string,
  opts: { limit?: number; maxDepth?: number } = {},
): Promise<FirecrawlPage[]> {
  requireEnabled();
  assertPublicUrl(url);
  const started = Date.now();
  try {
    const job = await withFirecrawlRetry(() =>
      client().crawl(url, {
        limit: opts.limit ?? 20,
        maxDiscoveryDepth: opts.maxDepth,
        scrapeOptions: { formats: ["markdown", "links"] },
      }),
    );
    const pages = (job.data ?? []).map((doc) => toPage(doc?.metadata?.sourceURL ?? url, doc));
    meter("crawl", "firecrawl.crawl", started, Math.max(1, pages.length), "ok");
    return pages;
  } catch (error) {
    meter("crawl", "firecrawl.crawl", started, 1, "error");
    throw mapError(error, "crawl");
  }
}

/** List URLs discovered on a site without fetching page content. */
export async function firecrawlMap(url: string, opts: { limit?: number } = {}): Promise<string[]> {
  requireEnabled();
  assertPublicUrl(url);
  const started = Date.now();
  try {
    const result = await withFirecrawlRetry(() => client().map(url, { limit: opts.limit ?? 100 }));
    const links = (result.links ?? []).map((link) => link.url).filter(Boolean);
    meter("map", "firecrawl.map", started, 1, "ok");
    return links;
  } catch (error) {
    meter("map", "firecrawl.map", started, 1, "error");
    throw mapError(error, "map");
  }
}

/** Web search (replaces the DuckDuckGo-scraping fallback used before Firecrawl). */
export async function firecrawlSearch(
  query: string,
  opts: { limit?: number } = {},
): Promise<FirecrawlSearchResult[]> {
  requireEnabled();
  const started = Date.now();
  try {
    const result = await withFirecrawlRetry(() =>
      client().search(query, { limit: opts.limit ?? 8 }),
    );
    const results = (result.web ?? []).map((entry) => ({
      url: entry.url,
      title: entry.title,
      description: entry.description,
    }));
    meter("search", "firecrawl.search", started, 1, "ok");
    return results;
  } catch (error) {
    meter("search", "firecrawl.search", started, 1, "error");
    throw mapError(error, "search");
  }
}
