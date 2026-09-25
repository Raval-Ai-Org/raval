// verify.ts — does the live page really show the article? Pure; the server
// fetches the page (safeFetch) and passes the HTML in.
//
// Required: the page loads, carries the title and the opening of the body, and
// isn't noindexed. Structured data is required only where Mellox wrote it
// (otherwise it's the site's theme/template, reported but not blocking).

import { analyzePage } from "@/lib/geo/analyze-page";
import { fingerprintPage } from "@/lib/sites/fingerprint";
import type { PublishableArticle } from "./render";

export type LiveCheck = {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  blocking: boolean;
};

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  rsquo: "'",
  lsquo: "'",
  rdquo: '"',
  ldquo: '"',
  ndash: "-",
  mdash: "-",
  hellip: "...",
};

export function plainText(html: string): string {
  return html
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

/** Lowercase words only, so quotes, dashes and markup differences don't matter. */
export function normalizeWords(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[‘’“”]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** The first ~10 words of the article body, as plain words. */
export function openingWords(markdown: string, n = 10): string {
  const first =
    markdown
      .replace(/^#\s+.+\n+/, "")
      .split(/\n{2,}/)
      .map((b) => b.trim())
      .find((b) => b && !/^(#|[-*+]\s|\d+\.\s|>|```|\|)/.test(b)) ?? "";
  const words = normalizeWords(first.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, ""))
    .split(" ")
    .filter(Boolean);
  return words.slice(0, n).join(" ");
}

export function verifyArticleHtml(
  html: string,
  url: string,
  article: PublishableArticle,
  opts: { status: number; expectStructuredData: boolean },
): { ok: boolean; placeholder: boolean; checks: LiveCheck[] } {
  const placeholder = fingerprintPage(html).placeholder;
  const page = analyzePage(html, url);
  const text = normalizeWords(plainText(html));
  const title = normalizeWords(article.title);
  const opening = openingWords(article.markdown);
  const types = page.schema.types;
  const checks: LiveCheck[] = [
    {
      id: "reachable",
      label: "Page is live",
      ok: opts.status >= 200 && opts.status < 300 && !placeholder,
      detail: placeholder ? "The site shows a “coming soon” page" : `HTTP ${opts.status}`,
      blocking: true,
    },
    {
      id: "title",
      label: "Shows the title",
      ok: !!title && text.includes(title),
      detail: page.title ?? "No title",
      blocking: true,
    },
    {
      id: "body",
      label: "Shows the article",
      ok: !opening || text.includes(opening),
      detail: opening ? `Looked for “${opening}…”` : "No body text to check",
      blocking: true,
    },
    {
      id: "indexable",
      label: "Search and AI engines may index it",
      ok: !page.robotsMeta?.noindex,
      detail: page.robotsMeta?.noindex ? "The page says noindex" : "No noindex",
      blocking: true,
    },
    {
      id: "faq",
      label: "FAQ is visible",
      ok: !article.faq.length || text.includes(normalizeWords(article.faq[0].question)),
      detail: article.faq.length ? `${article.faq.length} question(s)` : "No FAQ",
      blocking: false,
    },
    {
      id: "structured_data",
      label: "Article structured data",
      ok: types.some((t) => /^(BlogPosting|Article|NewsArticle|TechArticle)$/.test(t)),
      detail: types.join(", ") || "none",
      blocking: opts.expectStructuredData,
    },
  ];
  return { ok: checks.every((c) => c.ok || !c.blocking), placeholder, checks };
}
