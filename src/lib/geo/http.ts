// http.ts — the parts of an HTTP response AI Visibility rules read, reduced to
// plain data. Response headers are summarised here once so no raw header
// values (cookies, server banners) are ever stored with a scan.
//
// Adapted from SiteOne Crawler's headers, caching and security analyzers
// (MIT, (c) Ján Regeš): compression, cache validators and the security
// headers browsers act on.

import type { PageHttp, RedirectHop } from "./types";

const MAX_HOPS = 10;

export function summarizeHttp(
  headers: { get(name: string): string | null },
  redirects: RedirectHop[],
): PageHttp {
  const encoding = (headers.get("content-encoding") ?? "").trim().toLowerCase();
  const xfo = (headers.get("x-frame-options") ?? "").trim();
  const csp = (headers.get("content-security-policy") ?? "").trim();
  return {
    redirects: redirects
      .slice(0, MAX_HOPS)
      .map((h) => ({ status: h.status, url: h.url.slice(0, 500) })),
    contentEncoding: encoding && encoding !== "identity" ? encoding.slice(0, 40) : null,
    cacheControl: headers.get("cache-control")?.trim().slice(0, 200) || null,
    etag: Boolean(headers.get("etag")),
    lastModified: Boolean(headers.get("last-modified")),
    security: {
      hsts: /max-age\s*=\s*[1-9]/i.test(headers.get("strict-transport-security") ?? ""),
      contentTypeOptions: /nosniff/i.test(headers.get("x-content-type-options") ?? ""),
      frameProtection: Boolean(xfo) || /frame-ancestors/i.test(csp),
      referrerPolicy: Boolean(headers.get("referrer-policy")),
      csp: Boolean(csp),
    },
  };
}

/** `max-age` / `s-maxage` seconds from a Cache-Control value, or null. */
export function cacheMaxAge(cacheControl: string | null): number | null {
  if (!cacheControl) return null;
  const m =
    /(?:^|,)\s*s-maxage\s*=\s*(\d+)/i.exec(cacheControl) ??
    /(?:^|,)\s*max-age\s*=\s*(\d+)/i.exec(cacheControl);
  return m ? Number(m[1]) : null;
}

/** Whether the response can be revalidated or reused: a validator, or a cache lifetime. */
export function isCacheFriendly(http: PageHttp): boolean {
  if (http.etag || http.lastModified) return true;
  const cc = (http.cacheControl ?? "").toLowerCase();
  if (/no-store/.test(cc)) return false;
  return (cacheMaxAge(http.cacheControl) ?? 0) > 0;
}
