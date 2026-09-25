// cms-values.ts — deterministic values for CMS fixes and published articles.
// Nothing here is invented: every name, URL, date and answer comes from the
// scanned site, the CMS object or the article itself. Pure; browser-safe.

import { AI_BOTS } from "./robots";

/** Absolute page URL without query or fragment — a self-referencing canonical. */
export function canonicalFor(url: string): string {
  const u = new URL(url);
  u.search = "";
  u.hash = "";
  return u.toString();
}

export type JsonLd = Record<string, unknown>;

/** Organization + WebSite, from the brand name and origin the scan saw. */
export function organizationGraph(input: {
  origin: string;
  name: string;
  logoUrl?: string | null;
  description?: string | null;
}): JsonLd {
  const origin = input.origin.replace(/\/+$/, "");
  const org: JsonLd = {
    "@type": "Organization",
    "@id": `${origin}/#organization`,
    name: input.name,
    url: `${origin}/`,
  };
  if (input.logoUrl) org.logo = input.logoUrl;
  if (input.description) org.description = input.description;
  return {
    "@context": "https://schema.org",
    "@graph": [
      org,
      {
        "@type": "WebSite",
        "@id": `${origin}/#website`,
        name: input.name,
        url: `${origin}/`,
        publisher: { "@id": `${origin}/#organization` },
      },
    ],
  };
}

const titleCase = (slug: string) =>
  decodeURIComponent(slug)
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();

/** BreadcrumbList from the URL path; names come from crawled page titles where known. */
export function breadcrumbList(
  url: string,
  titles: Record<string, string | null | undefined> = {},
): JsonLd | null {
  const u = new URL(url);
  const parts = u.pathname.split("/").filter(Boolean);
  if (!parts.length) return null;
  const items: JsonLd[] = [
    { "@type": "ListItem", position: 1, name: "Home", item: `${u.origin}/` },
  ];
  let path = "";
  parts.forEach((part, i) => {
    path += `/${part}`;
    const href = `${u.origin}${path}${i === parts.length - 1 && u.pathname.endsWith("/") ? "/" : ""}`;
    const known = titles[href] ?? titles[`${href}/`] ?? titles[href.replace(/\/$/, "")];
    const name = (known?.split(/\s[|–—-]\s/)[0] ?? "").trim() || titleCase(part);
    items.push({ "@type": "ListItem", position: i + 2, name, item: href });
  });
  return { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: items };
}

/** Article (posts) or WebPage (pages) with the object's own dates and headline. */
export function pageEntity(input: {
  kind: "article" | "webpage";
  url: string;
  headline: string;
  description?: string | null;
  datePublished?: string | null;
  dateModified?: string | null;
  authorName?: string | null;
  publisherName?: string | null;
  origin: string;
  image?: string | null;
}): JsonLd {
  const origin = input.origin.replace(/\/+$/, "");
  const base: JsonLd = {
    "@context": "https://schema.org",
    "@type": input.kind === "article" ? "Article" : "WebPage",
    ...(input.kind === "article"
      ? { headline: input.headline.slice(0, 110) }
      : { name: input.headline }),
    url: input.url,
    mainEntityOfPage: input.url,
  };
  if (input.description) base.description = input.description;
  if (input.datePublished) base.datePublished = input.datePublished;
  if (input.dateModified) base.dateModified = input.dateModified;
  if (input.image) base.image = input.image;
  if (input.authorName) base.author = { "@type": "Person", name: input.authorName };
  if (input.publisherName)
    base.publisher = {
      "@type": "Organization",
      name: input.publisherName,
      "@id": `${origin}/#organization`,
    };
  return base;
}

const stripTags = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#8217;|&rsquo;/g, "’")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Question headings (h2–h4 ending in "?") and the text that answers them,
 * up to the next heading. Only pairs with a real answer are returned.
 */
export function extractFaqPairs(html: string, max = 10): { question: string; answer: string }[] {
  const pairs: { question: string; answer: string }[] = [];
  const re = /<h([2-4])\b[^>]*>([\s\S]*?)<\/h\1>([\s\S]*?)(?=<h[1-4]\b|$)/gi;
  for (const m of html.matchAll(re)) {
    const question = stripTags(m[2]);
    if (!question.endsWith("?") || question.length < 8 || question.length > 200) continue;
    const answer = stripTags(m[3]).slice(0, 1000);
    if (answer.split(/\s+/).length < 8) continue;
    pairs.push({ question, answer });
    if (pairs.length >= max) break;
  }
  return pairs;
}

export function faqPage(pairs: { question: string; answer: string }[]): JsonLd | null {
  if (!pairs.length) return null;
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: pairs.map((p) => ({
      "@type": "Question",
      name: p.question,
      acceptedAnswer: { "@type": "Answer", text: p.answer },
    })),
  };
}

/** Replace entities of the same @type in `existing` with `next` (keeps the rest). */
export function mergeJsonLd(existing: JsonLd[], next: JsonLd[]): JsonLd[] {
  const typeOf = (x: JsonLd) => String(x["@type"] ?? (x["@graph"] ? "@graph" : ""));
  const replaced = new Set(next.map(typeOf));
  return [...existing.filter((x) => !replaced.has(typeOf(x))), ...next];
}

/**
 * robots.txt lines a rule needs added (Allow for a blocked AI crawler, a
 * permissive default, or the sitemap declaration). Existing lines are kept;
 * duplicates are not added.
 */
export function robotsAdditions(input: {
  ruleId: string;
  existingAppend: string;
  sitemapUrl: string | null;
}): string {
  const lines: string[] = [];
  const bot = input.ruleId.startsWith("ai.bot.")
    ? AI_BOTS.find((b) => `ai.bot.${b.id.toLowerCase()}` === input.ruleId)?.id
    : null;
  if (bot) lines.push(`User-agent: ${bot}`, "Allow: /");
  else if (input.ruleId === "ai.robots_txt")
    for (const b of AI_BOTS) lines.push(`User-agent: ${b.id}`, "Allow: /", "");
  if (
    (input.ruleId === "tech.robots_sitemap" || input.ruleId === "ai.robots_txt") &&
    input.sitemapUrl
  )
    lines.push(`Sitemap: ${input.sitemapUrl}`);
  const existing = input.existingAppend.trim();
  const block = lines.join("\n").trim();
  if (!block) return existing;
  if (existing.includes(block)) return existing;
  return [existing, block].filter(Boolean).join("\n\n");
}

/** Images in HTML with a missing or empty alt, with WordPress media ids where present. */
export function imagesMissingAlt(
  html: string,
  max = 12,
): { tag: string; src: string; mediaId: number | null }[] {
  const out: { tag: string; src: string; mediaId: number | null }[] = [];
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const alt = /\salt\s*=\s*(["'])([\s\S]*?)\1/i.exec(tag);
    if (alt && alt[2].trim()) continue;
    const src = /\ssrc\s*=\s*(["'])([^"']+)\1/i.exec(tag)?.[2] ?? "";
    const id = /wp-image-(\d+)/.exec(tag)?.[1];
    out.push({ tag, src, mediaId: id ? Number(id) : null });
    if (out.length >= max) break;
  }
  return out;
}

/** Set (or add) the alt attribute on one exact <img> tag. */
export function withAlt(tag: string, alt: string): string {
  const safe = alt.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  return /\salt\s*=\s*(["'])[\s\S]*?\1/i.test(tag)
    ? tag.replace(/\salt\s*=\s*(["'])[\s\S]*?\1/i, ` alt="${safe}"`)
    : tag.replace(/<img\b/i, `<img alt="${safe}"`);
}
