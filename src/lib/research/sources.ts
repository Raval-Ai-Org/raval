// sources.ts — how Mellox treats a web source before it is allowed to inform
// anything a user sees. Pure and browser-safe: the rules are the same whether
// a result came from Tavily, Firecrawl or the DuckDuckGo fallback, and the UI
// needs them too (to render a source chip, or to decline to).
//
// The posture matches src/lib/links/rank.ts: judge on what the data really
// supports, refuse file hosts and throwaway domains outright, and never let a
// single site flood a result set just because it published ten pages.

export type SourceProvider = "tavily" | "firecrawl" | "ddg";

export type WebSource = {
  title: string;
  url: string;
  snippet: string;
  /** ISO date, only when the provider actually reported one. */
  publishedDate?: string;
  /** Provider relevance score where available; never shown as a Mellox rating. */
  score?: number;
  provider: SourceProvider;
};

/** Hosts that are storage or redirectors, never a citable publisher. */
const FILE_AND_REDIRECT_HOSTS = [
  "drive.google.com",
  "docs.google.com",
  "dropbox.com",
  "box.com",
  "scribd.com",
  "slideshare.net",
  "t.co",
  "bit.ly",
  "lnkd.in",
  "tinyurl.com",
  "webcache.googleusercontent.com",
  "translate.google.com",
];

/** TLDs that in practice carry throwaway and spam domains. */
const THROWAWAY_TLDS = [
  ".xyz",
  ".top",
  ".click",
  ".link",
  ".gq",
  ".cf",
  ".tk",
  ".ml",
  ".ga",
  ".work",
  ".loan",
  ".zip",
  ".mov",
];

/** Extensions that are a download, not a page we can quote from. */
const BINARY_EXTENSIONS =
  /\.(pdf|docx?|xlsx?|pptx?|zip|rar|7z|dmg|exe|csv|mp4|mp3|jpg|jpeg|png|gif|webp|svg)$/i;

/**
 * Hosts that aggregate or list other companies. Useful as *evidence about*
 * competitors, useless as a competitor themselves — competitor discovery
 * excludes them as candidates while still keeping them as a source.
 */
const AGGREGATOR_HOSTS = [
  "g2.com",
  "capterra.com",
  "getapp.com",
  "softwareadvice.com",
  "trustradius.com",
  "trustpilot.com",
  "producthunt.com",
  "crunchbase.com",
  "wikipedia.org",
  "reddit.com",
  "quora.com",
  "medium.com",
  "substack.com",
  "youtube.com",
  "linkedin.com",
  "facebook.com",
  "instagram.com",
  "x.com",
  "twitter.com",
  "tiktok.com",
  "pinterest.com",
  "github.com",
  "stackoverflow.com",
  "glassdoor.com",
  "indeed.com",
  "yelp.com",
  "amazon.com",
  "alternativeto.net",
  "slant.co",
  "sourceforge.net",
  "saasworthy.com",
  "gartner.com",
  "forbes.com",
  "techcrunch.com",
  "businessinsider.com",
];

/** Lower-case registrable-ish host, without a leading www. Empty when unparseable. */
export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** True when `host` is, or sits under, one of `list`. */
function hostMatches(host: string, list: readonly string[]): boolean {
  return list.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

/**
 * A stable identity for a result: scheme and host lower-cased, tracking
 * parameters and fragments dropped, trailing slash normalised. Two links to
 * the same page from two different searches collapse to one.
 */
export function normalizeSourceUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    parsed.protocol = parsed.protocol === "http:" ? "https:" : parsed.protocol;
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^utm_/i.test(key) || /^(fbclid|gclid|msclkid|mc_cid|mc_eid|ref|source)$/i.test(key)) {
        parsed.searchParams.delete(key);
      }
    }
    const path = parsed.pathname.replace(/\/+$/, "") || "/";
    const query = parsed.searchParams.toString();
    return `${parsed.protocol}//${parsed.hostname}${path}${query ? `?${query}` : ""}`;
  } catch {
    return url.trim();
  }
}

/** A source we refuse to quote from or cite at all. */
export function isLowQualitySource(url: string): boolean {
  const host = hostOf(url);
  if (!host) return true;
  if (hostMatches(host, FILE_AND_REDIRECT_HOSTS)) return true;
  if (THROWAWAY_TLDS.some((tld) => host.endsWith(tld))) return true;
  try {
    if (BINARY_EXTENSIONS.test(new URL(url).pathname)) return true;
  } catch {
    return true;
  }
  return false;
}

/** A publisher that writes *about* companies rather than being one. */
export function isAggregatorSource(url: string): boolean {
  const host = hostOf(url);
  return Boolean(host) && hostMatches(host, AGGREGATOR_HOSTS);
}

/**
 * Drop duplicates and stop one site dominating. `perHost` is the cap on how
 * many results a single host may contribute — the reason a competitor's blog
 * cannot crowd out five other companies in a discovery pass.
 */
export function dedupeSources(
  sources: readonly WebSource[],
  opts: { perHost?: number; limit?: number } = {},
): WebSource[] {
  const perHost = opts.perHost ?? 2;
  const seenUrls = new Set<string>();
  const hostCounts = new Map<string, number>();
  const out: WebSource[] = [];
  for (const source of sources) {
    if (!source?.url || isLowQualitySource(source.url)) continue;
    const key = normalizeSourceUrl(source.url);
    if (seenUrls.has(key)) continue;
    const host = hostOf(source.url);
    const used = hostCounts.get(host) ?? 0;
    if (used >= perHost) continue;
    seenUrls.add(key);
    hostCounts.set(host, used + 1);
    out.push(source);
    if (opts.limit && out.length >= opts.limit) break;
  }
  return out;
}

/**
 * A coarse, honest hint about how much weight a source deserves — used to
 * order what a model reads, never rendered as a score. There is no dataset
 * behind a precise number here, so Mellox does not invent one.
 */
export function sourceAuthorityHint(url: string): "high" | "medium" | "low" {
  const host = hostOf(url);
  if (!host) return "low";
  if (/\.(gov|edu)$/.test(host) || host.endsWith(".gov.uk")) return "high";
  if (hostMatches(host, AGGREGATOR_HOSTS)) return "medium";
  const labels = host.split(".").length;
  return labels > 3 ? "low" : "medium";
}

/**
 * Order sources the way a researcher would skim them: recent first when a date
 * is known, then provider relevance, then authority. Stable for equal items.
 */
export function rankSources(sources: readonly WebSource[]): WebSource[] {
  const authorityRank = { high: 2, medium: 1, low: 0 } as const;
  return [...sources]
    .map((source, index) => ({ source, index }))
    .sort((a, b) => {
      const scoreDelta = (b.source.score ?? 0) - (a.source.score ?? 0);
      if (Math.abs(scoreDelta) > 0.05) return scoreDelta;
      const authorityDelta =
        authorityRank[sourceAuthorityHint(b.source.url)] -
        authorityRank[sourceAuthorityHint(a.source.url)];
      if (authorityDelta !== 0) return authorityDelta;
      return a.index - b.index;
    })
    .map((entry) => entry.source);
}

/**
 * Sources as numbered evidence for a prompt. Always carries the URL, because
 * every prompt that reads these also requires the model to cite one.
 */
export function formatSourcesForPrompt(sources: readonly WebSource[], maxChars = 6_000): string {
  const lines: string[] = [];
  let used = 0;
  sources.forEach((source, index) => {
    const dateLabel = source.publishedDate ? ` (${source.publishedDate.slice(0, 10)})` : "";
    const line = `[${index + 1}] ${source.title}${dateLabel}\n${source.url}\n${source.snippet}`;
    if (used + line.length > maxChars) return;
    used += line.length;
    lines.push(line);
  });
  return lines.join("\n\n");
}
