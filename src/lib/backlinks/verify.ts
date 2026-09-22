// Link verification — the pure half.
//
// Given a page's HTML, does it actually link to us, with what anchor, and does
// the link pass authority? The fetching half lives in
// src/server/backlinks/verify.server.ts and goes through the SSRF-guarded
// fetcher; keeping the parsing here makes every outcome unit-testable.
//
// Deliberately conservative: a page we could not read properly is reported as
// unreachable, never as "the link is gone". Telling someone a link was removed
// when a CDN simply blocked our crawler is worse than saying nothing.
import { isSameSite } from "./normalize";
import type { VerificationResult } from "./types";

export type ParsedLink = {
  href: string;
  /** Absolute form of `href` when it could be resolved against the page URL. */
  resolved: string | null;
  anchor: string | null;
  rel: string[];
};

const ANCHOR_RE = /<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi;
const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)));
}

function attributes(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTR_RE.exec(raw)) !== null) {
    const name = (match[1] ?? "").toLowerCase();
    out[name] = match[3] ?? match[4] ?? match[5] ?? "";
  }
  return out;
}

/** Visible text of an anchor: tags stripped, entities decoded, collapsed. */
function anchorText(inner: string): string | null {
  const text = decodeEntities(inner.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
  return text ? text.slice(0, 500) : null;
}

export function extractLinks(html: string, baseUrl: string): ParsedLink[] {
  const links: ParsedLink[] = [];
  ANCHOR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ANCHOR_RE.exec(html)) !== null) {
    const attrs = attributes(match[1] ?? "");
    const href = attrs.href?.trim();
    if (!href) continue;
    let resolved: string | null = null;
    try {
      const url = new URL(decodeEntities(href), baseUrl);
      // `javascript:`, `mailto:` and friends parse fine but are never a
      // backlink; leaving them unresolved keeps them out of matching.
      resolved = url.protocol === "http:" || url.protocol === "https:" ? url.toString() : null;
    } catch {
      resolved = null;
    }
    links.push({
      href,
      resolved,
      anchor: anchorText(match[2] ?? ""),
      rel: (attrs.rel ?? "").toLowerCase().split(/\s+/).filter(Boolean),
    });
  }
  return links;
}

export type MatchOutcome = {
  result: VerificationResult;
  linkFound: boolean;
  targetMatches: boolean;
  anchorFound: string | null;
  relValues: string[];
  isNofollow: boolean;
  isSponsored: boolean;
  isUgc: boolean;
  matchedHref: string | null;
};

/**
 * Does any link on the page point at `expectedTarget` (a host, or a full URL
 * when the caller wants an exact page)?
 *
 * Matching is exact when `expectedTarget` is a full URL: a post that links to
 * the site's homepage instead of the page we asked for has not created the
 * backlink we wanted, so it counts as missing.
 */
export function matchLink(links: ParsedLink[], expectedTarget: string): MatchOutcome {
  const empty: MatchOutcome = {
    result: "missing",
    linkFound: false,
    targetMatches: false,
    anchorFound: null,
    relValues: [],
    isNofollow: false,
    isSponsored: false,
    isUgc: false,
    matchedHref: null,
  };

  const wantsExactUrl = /^https?:\/\//i.test(expectedTarget);
  let expectedHost = expectedTarget;
  let expectedUrl: URL | null = null;
  if (wantsExactUrl) {
    try {
      expectedUrl = new URL(expectedTarget);
      expectedHost = expectedUrl.hostname;
    } catch {
      expectedUrl = null;
    }
  }

  let sameSiteButWrongPage: ParsedLink | null = null;

  for (const link of links) {
    if (!link.resolved) continue;
    let host: string;
    try {
      host = new URL(link.resolved).hostname;
    } catch {
      continue;
    }
    if (!isSameSite(host, expectedHost)) continue;

    if (expectedUrl) {
      const samePage =
        link.resolved === expectedUrl.toString() ||
        new URL(link.resolved).pathname.replace(/\/$/, "") ===
          expectedUrl.pathname.replace(/\/$/, "");
      if (!samePage) {
        sameSiteButWrongPage ??= link;
        continue;
      }
    }

    const isNofollow = link.rel.includes("nofollow");
    const isSponsored = link.rel.includes("sponsored");
    const isUgc = link.rel.includes("ugc");
    return {
      // sponsored and ugc do not pass authority either — same practical outcome.
      result: isNofollow || isSponsored || isUgc ? "nofollow" : "live",
      linkFound: true,
      targetMatches: true,
      anchorFound: link.anchor,
      relValues: link.rel,
      isNofollow,
      isSponsored,
      isUgc,
      matchedHref: link.href,
    };
  }

  if (sameSiteButWrongPage) {
    // Right site, wrong page: the link we asked for is not there.
    return {
      ...empty,
      linkFound: true,
      targetMatches: false,
      anchorFound: sameSiteButWrongPage.anchor,
      relValues: sameSiteButWrongPage.rel,
      isNofollow: sameSiteButWrongPage.rel.includes("nofollow"),
      matchedHref: sameSiteButWrongPage.href,
    };
  }

  return empty;
}

/** Plain-language labels for the UI. */
export const VERIFICATION_LABELS: Record<VerificationResult, string> = {
  pending: "Checking",
  live: "Live",
  nofollow: "Live, no credit",
  missing: "Link not found",
  unreachable: "Couldn't open the page",
  blocked: "Address not allowed",
};
