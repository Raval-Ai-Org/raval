// crawler.server.ts — the network edge of AI Visibility scans.
//
// Every request goes through the SSRF-guarded safe fetch (DNS-level address
// check, per-hop redirect re-validation, byte caps). On top of that this
// module adds what a polite, bounded crawler needs: robots.txt discovery,
// sitemap and llms.txt validation, retries with backoff for transient
// failures only, and URL normalisation that keeps the crawl on one site.
import "server-only";
import { getAppUrl } from "@/server/env";
import {
  createSafeFetch,
  ResponseTooLargeError,
  SsrfBlockedError,
  type SafeFetchOptions,
  type SafeFetchResult,
} from "@/server/safe-fetch";
import { robotsSitemaps } from "@/lib/geo/robots";
import { looksLikeLlmsTxt, looksLikeRobotsTxt, parseSitemap } from "@/lib/geo/sitemap";
import type { SiteArtifacts } from "@/lib/geo/types";

/** Product token robots.txt groups can target to allow or block Mellox scans. */
export const GEO_CRAWLER_TOKEN = "MelloxAI-Audit";

export function geoUserAgent(): string {
  let base = "https://mellox.ai";
  try {
    base = getAppUrl();
  } catch {
    /* env not configured (tests) */
  }
  return `Mozilla/5.0 (compatible; ${GEO_CRAWLER_TOKEN}/2.0; +${base}/bot)`;
}

export type Fetcher = (url: string, opts: SafeFetchOptions) => Promise<SafeFetchResult>;

let defaultFetcher: Fetcher | null = null;
/** One guarded connection pool per process. */
export function getDefaultFetcher(): Fetcher {
  defaultFetcher ??= createSafeFetch();
  return defaultFetcher;
}

export type FetchOutcome = {
  ok: boolean;
  status: number | null;
  finalUrl: string | null;
  contentType: string | null;
  xRobotsTag: string | null;
  retryAfterSeconds: number | null;
  body: string;
  bytes: number;
  truncated: boolean;
  ms: number;
  /** Set when the request never produced an HTTP response. */
  error: string | null;
  /** The URL (or a redirect hop) resolved to a non-public address. */
  blocked: boolean;
};

const RETRY_STATUSES = new Set([429, 502, 503, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchWithRetry(
  fetcher: Fetcher,
  url: string,
  opts: { timeoutMs?: number; maxBytes?: number; retries?: number; accept?: string } = {},
): Promise<FetchOutcome> {
  const retries = opts.retries ?? 2;
  const started = Date.now();
  let last: FetchOutcome | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetcher(url, {
        headers: {
          "user-agent": geoUserAgent(),
          accept: opts.accept ?? "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5",
          "accept-language": "en;q=0.9,*;q=0.5",
        },
        timeoutMs: opts.timeoutMs ?? 10_000,
        maxBytes: opts.maxBytes ?? 2 * 1024 * 1024,
        onOverflow: "truncate",
      });
      const retryAfter = Number(res.headers.get("retry-after"));
      last = {
        ok: res.ok,
        status: res.status,
        finalUrl: res.url,
        contentType: res.headers.get("content-type"),
        xRobotsTag: res.headers.get("x-robots-tag"),
        retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
        body: res.text(),
        bytes: res.bytes.byteLength,
        truncated: res.truncated,
        ms: Date.now() - started,
        error: null,
        blocked: false,
      };
      if (!RETRY_STATUSES.has(res.status) || attempt === retries) return last;
      const waitMs = last.retryAfterSeconds
        ? Math.min(5_000, last.retryAfterSeconds * 1000)
        : 500 * 2 ** attempt + Math.floor(Math.random() * 250);
      await sleep(waitMs);
    } catch (error) {
      // The DNS guard's error arrives either directly or as undici's `cause`.
      const cause = (error as { cause?: unknown })?.cause;
      if (
        error instanceof SsrfBlockedError ||
        cause instanceof SsrfBlockedError ||
        (cause as { code?: string } | undefined)?.code === "ESSRFBLOCKED"
      ) {
        return failure(
          "URL is not allowed: it resolves to a private or reserved address.",
          started,
          true,
        );
      }
      const message =
        error instanceof ResponseTooLargeError
          ? "Response too large"
          : error instanceof Error && error.name === "TimeoutError"
            ? "Timed out"
            : error instanceof Error
              ? error.message.slice(0, 200)
              : "Request failed";
      last = failure(message, started, false);
      if (attempt === retries) return last;
      await sleep(400 * 2 ** attempt);
    }
  }
  return last ?? failure("Request failed", started, false);
}

function failure(error: string, started: number, blocked: boolean): FetchOutcome {
  return {
    ok: false,
    status: null,
    finalUrl: null,
    contentType: null,
    xRobotsTag: null,
    retryAfterSeconds: null,
    body: "",
    bytes: 0,
    truncated: false,
    ms: Date.now() - started,
    error,
    blocked,
  };
}

export function isHtmlResponse(contentType: string | null, body: string): boolean {
  const type = (contentType ?? "").toLowerCase();
  if (type.includes("html")) return true;
  if (type && !type.startsWith("text/")) return false;
  return /<(!doctype html|html|head|body)[\s>]/i.test(body.slice(0, 2000));
}

/* ───────────────────────── URL policy ───────────────────────── */

const TRACKING_PARAMS =
  /^(utm_[a-z]+|fbclid|gclid|gclsrc|dclid|msclkid|mc_cid|mc_eid|_hsenc|_hsmi|ref|ref_src)$/i;
const SKIP_EXTENSIONS =
  /\.(pdf|jpe?g|png|gif|svg|webp|avif|ico|bmp|tiff?|zip|gz|rar|7z|mp4|mov|webm|mp3|wav|ogg|css|js|mjs|json|xml|txt|rss|atom|woff2?|ttf|eot|exe|dmg|apk|csv|xlsx?|docx?|pptx?)$/i;
const SKIP_PATHS =
  /\/(wp-admin|wp-json|wp-login|cart|checkout|basket|login|logout|signin|signup|sign-in|sign-up|account|my-account|admin|cdn-cgi)(\/|$)/i;

export function siteHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * Normalise a URL for the crawl frontier, or null when it should not be
 * crawled: other hosts, non-http(s), files, auth/cart paths, tracking and
 * obviously unbounded query strings.
 */
export function normalizeCrawlUrl(raw: string, host: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (siteHost(u.toString()) !== host) return null;
  if (u.username || u.password) return null;
  if (SKIP_EXTENSIONS.test(u.pathname) || SKIP_PATHS.test(u.pathname)) return null;
  u.hash = "";
  for (const key of [...u.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) u.searchParams.delete(key);
  }
  if ([...u.searchParams.keys()].length > 3 || u.search.length > 120) return null;
  u.hostname = u.hostname.toLowerCase();
  const out = u.toString();
  return out.length > 500 ? null : out;
}

/* ───────────────────────── Site discovery ───────────────────────── */

const MAX_SITEMAP_URLS = 5000;
const MAX_SITEMAP_DOCS = 6;

export async function discoverSiteArtifacts(
  fetcher: Fetcher,
  origin: string,
): Promise<{ site: SiteArtifacts; sitemapUrls: string[] }> {
  const url = new URL(origin);
  const host = siteHost(origin);

  const [robotsRes, llmsRes, llmsFullRes] = await Promise.all([
    fetchWithRetry(fetcher, `${origin}/robots.txt`, {
      timeoutMs: 8000,
      maxBytes: 512 * 1024,
      retries: 1,
      accept: "text/plain,*/*",
    }),
    fetchWithRetry(fetcher, `${origin}/llms.txt`, {
      timeoutMs: 8000,
      maxBytes: 256 * 1024,
      retries: 1,
      accept: "text/plain,text/markdown,*/*",
    }),
    fetchWithRetry(fetcher, `${origin}/llms-full.txt`, {
      timeoutMs: 8000,
      maxBytes: 64 * 1024,
      retries: 0,
      accept: "text/plain,text/markdown,*/*",
    }),
  ]);

  const robotsFound = robotsRes.ok && looksLikeRobotsTxt(robotsRes.body, robotsRes.contentType);
  const robotsStatus: SiteArtifacts["robots"]["status"] = robotsFound
    ? "found"
    : robotsRes.status !== null && robotsRes.status >= 500
      ? "error"
      : robotsRes.error && !robotsRes.blocked
        ? "error"
        : "missing";
  const robotsText = robotsFound ? robotsRes.body.slice(0, 64 * 1024) : "";
  const declared = robotsFound ? robotsSitemaps(robotsText) : [];

  // Sitemaps: robots.txt declarations first, /sitemap.xml as the fallback.
  const queue = declared.length ? [...declared] : [`${origin}/sitemap.xml`];
  const seenDocs = new Set<string>();
  const sources: string[] = [];
  const locs = new Set<string>();
  let isIndex = false;
  while (queue.length && seenDocs.size < MAX_SITEMAP_DOCS && locs.size < MAX_SITEMAP_URLS) {
    const doc = queue.shift()!;
    if (seenDocs.has(doc)) continue;
    seenDocs.add(doc);
    const res = await fetchWithRetry(fetcher, doc, {
      timeoutMs: 10_000,
      maxBytes: 5 * 1024 * 1024,
      retries: 1,
      accept: "application/xml,text/xml,*/*",
    });
    if (!res.ok) continue;
    const parsed = parseSitemap(res.body, MAX_SITEMAP_URLS);
    if (parsed.kind === "invalid") continue;
    sources.push(doc);
    if (parsed.kind === "index") {
      isIndex = true;
      queue.push(...parsed.locs.slice(0, MAX_SITEMAP_DOCS));
    } else {
      for (const loc of parsed.locs) {
        if (siteHost(loc) === host) locs.add(loc);
        if (locs.size >= MAX_SITEMAP_URLS) break;
      }
    }
  }
  // An index whose children all failed still proves a sitemap exists.
  const sitemapFound = sources.length > 0;

  const llmsFound = llmsRes.ok && looksLikeLlmsTxt(llmsRes.body, llmsRes.contentType);
  const site: SiteArtifacts = {
    origin,
    host,
    https: url.protocol === "https:",
    robots: { status: robotsStatus, text: robotsText, sitemaps: declared },
    llms: {
      found: llmsFound,
      bytes: llmsFound ? llmsRes.bytes : 0,
      full: llmsFullRes.ok && looksLikeLlmsTxt(llmsFullRes.body, llmsFullRes.contentType),
    },
    sitemap: { found: sitemapFound, urls: locs.size, isIndex, sources },
  };
  return { site, sitemapUrls: [...locs] };
}
