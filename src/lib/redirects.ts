import { normalizeDomain, toWebsiteUrl } from "@/lib/workspace/domain";

export function safeNextPath(value: string | null | undefined, fallback = "/projects") {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback;

  try {
    const parsed = new URL(value, "http://mellox.local");
    if (parsed.origin !== "http://mellox.local") return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

/** Where a website typed on the public site is turned into a workspace and scanned. */
export const START_PATH = "/start";

/** `/start?url=<site>` for a website a person typed, or null if it isn't one. */
export function startPathFor(site: string | null | undefined): string | null {
  const url = toWebsiteUrl(site?.slice(0, 2000));
  return url ? `${START_PATH}?url=${encodeURIComponent(url)}` : null;
}

/** The website a start link carries ("acme.com"), for a line of copy; else null. */
export function siteFromNextPath(next: string): string | null {
  if (!next.startsWith(`${START_PATH}?`)) return null;
  return normalizeDomain(new URLSearchParams(next.slice(START_PATH.length + 1)).get("url"));
}

/**
 * Where sign-in or sign-up goes next, from the page's own query: an explicit
 * `?next=` (an invite, a workspace page) first, then a website carried from
 * the landing page (`?url=`), which goes straight to its Brand DNA scan.
 */
export function authNextPath(search: string | URLSearchParams, fallback = "/projects") {
  const params = typeof search === "string" ? new URLSearchParams(search) : search;
  const next = params.get("next");
  if (next) return safeNextPath(next, fallback);
  return startPathFor(params.get("url")) ?? fallback;
}
