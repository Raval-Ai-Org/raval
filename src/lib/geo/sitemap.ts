// sitemap.ts — sitemap.xml / llms.txt shape checks and parsing.
//
// A server that answers every path with its SPA shell returns 200 + HTML for
// /sitemap.xml and /llms.txt. Counting those as "present" (as the first audit
// did) rewards a missing file, so both are validated by shape here.

import { decodeEntities } from "./html-tokenizer";

export type ParsedSitemap = { kind: "urlset" | "index" | "invalid"; locs: string[] };

const LOOKS_LIKE_HTML = /^\s*(<!doctype html|<html[\s>]|<head[\s>]|<body[\s>])/i;

export function parseSitemap(xml: string, limit = 5000): ParsedSitemap {
  if (!xml || LOOKS_LIKE_HTML.test(xml)) return { kind: "invalid", locs: [] };
  const isIndex = /<sitemapindex[\s>]/i.test(xml);
  const isUrlset = /<urlset[\s>]/i.test(xml);
  if (!isIndex && !isUrlset) return { kind: "invalid", locs: [] };
  const locs: string[] = [];
  for (const m of xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?([^<\]]+?)(?:\]\]>)?\s*<\/loc>/gi)) {
    const loc = decodeEntities(m[1].trim());
    if (/^https?:\/\//i.test(loc)) locs.push(loc);
    if (locs.length >= limit) break;
  }
  return { kind: isIndex ? "index" : "urlset", locs };
}

/**
 * llms.txt is Markdown (llmstxt.org): an H1 title, optionally a blockquote
 * summary and link lists. Anything that is HTML, or has no heading and no
 * links, is not an llms.txt.
 */
export function looksLikeLlmsTxt(text: string, contentType: string | null): boolean {
  const body = text.trim();
  if (body.length < 10) return false;
  if ((contentType ?? "").toLowerCase().includes("html")) return false;
  if (LOOKS_LIKE_HTML.test(body)) return false;
  const head = body.slice(0, 4000);
  return /^#\s+\S/m.test(head) || /\[[^\]]+\]\(https?:\/\/[^)]+\)/.test(head);
}

/** robots.txt is plain text with directives; an HTML shell is not a robots.txt. */
export function looksLikeRobotsTxt(text: string, contentType: string | null): boolean {
  const body = text.trim();
  if (!body) return false;
  if ((contentType ?? "").toLowerCase().includes("html") || LOOKS_LIKE_HTML.test(body))
    return false;
  return /^\s*(user-agent|disallow|allow|sitemap|crawl-delay)\s*:/im.test(body);
}
