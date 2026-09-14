// analyze-page.ts — HTML in, PageAnalysis out. The single entry point the scan
// worker calls per crawled page; everything downstream (rules, scoring,
// findings, the page evidence drawer) reads the returned record.

import { extractHtml, resolveHref } from "./extract";
import { summarizeJsonLd } from "./analyze/schema";
import {
  analyzeEntities,
  analyzeQuestions,
  analyzeReadiness,
  analyzeSemanticCoverage,
  analyzeStructure,
  analyzeTopic,
} from "./analyze/content";
import { analyzeClaims, analyzeSources, analyzeTrust } from "./analyze/trust";
import { clip, hostOf } from "./analyze/text";
import type { LinkRef, PageAnalysis, PageType, SchemaSummary } from "./types";

const MAX_INTERNAL_LINKS = 400;
const MAX_EXTERNAL_LINKS = 150;

/** Strip the fragment; keep the query (it can select a different document). */
export function canonicalizeUrl(url: URL): string {
  const u = new URL(url.toString());
  u.hash = "";
  return u.toString();
}

function classifyPageType(url: string, schema: SchemaSummary): PageType {
  let path = "/";
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    /* keep "/" */
  }
  const types = schema.types.map((t) => t.toLowerCase());
  if (path === "/" || /^\/(index\.html?|home)?\/?$/.test(path)) return "home";
  if (/(^|\/)(privacy|terms|legal|cookies?|gdpr|imprint|impressum)(\/|$|-|\.)/.test(path)) {
    return "legal";
  }
  if (/(^|\/)contact(-us)?(\/|$|\.)/.test(path)) return "contact";
  if (/(^|\/)(about|about-us|team|company|our-story)(\/|$|\.)/.test(path)) return "about";
  if (types.some((t) => /article|blogposting|newsarticle|techarticle|report/.test(t)))
    return "article";
  if (/(^|\/)(blog|news|articles?|posts?|guides?|insights|resources|learn)\/[^/]+/.test(path)) {
    return "article";
  }
  if (types.includes("product") || /(^|\/)(products?|shop|item)\/[^/]+/.test(path))
    return "product";
  if (/(^|\/)(blog|news|category|categories|tags?|collections?|search)(\/|$)/.test(path)) {
    return "listing";
  }
  return "other";
}

export function analyzePage(
  html: string,
  pageUrl: string,
  opts: { bytes?: number; truncated?: boolean } = {},
): PageAnalysis {
  const raw = extractHtml(html);
  const host = hostOf(pageUrl);
  const schema = summarizeJsonLd(raw.jsonLd);

  const internal: LinkRef[] = [];
  const external: LinkRef[] = [];
  const mailto: string[] = [];
  let tel = 0;
  const seenInternal = new Set<string>();
  for (const link of raw.links) {
    if (/^mailto:/i.test(link.href)) {
      if (mailto.length < 10) mailto.push(link.href);
      continue;
    }
    if (/^tel:/i.test(link.href)) {
      tel++;
      continue;
    }
    const resolved = resolveHref(link.href, pageUrl);
    if (!resolved || !/^https?:$/.test(resolved.protocol)) continue;
    const href = canonicalizeUrl(resolved);
    const ref: LinkRef = {
      href,
      text: clip(link.text, 120),
      ...(link.rel ? { rel: link.rel } : {}),
    };
    if (hostOf(href) === host) {
      if (!seenInternal.has(href) && internal.length < MAX_INTERNAL_LINKS) {
        seenInternal.add(href);
        internal.push(ref);
      }
    } else if (external.length < MAX_EXTERNAL_LINKS) {
      external.push(ref);
    }
  }

  const title = raw.titles.find((t) => t.trim())?.trim() ?? (raw.titles.length ? "" : null);
  const metaDescription = raw.metaDescriptions.length
    ? (raw.metaDescriptions.find((d) => d.trim()) ?? "")
    : null;

  const robotsRaw = raw.robotsMeta.filter(Boolean).join(", ");
  const directives = robotsRaw
    .toLowerCase()
    .split(/[,;\s]+/)
    .filter(Boolean);
  const robotsMeta = raw.robotsMeta.length
    ? {
        raw: robotsRaw,
        noindex: directives.includes("noindex") || directives.includes("none"),
        nofollow: directives.includes("nofollow") || directives.includes("none"),
        nosnippet: directives.includes("nosnippet"),
      }
    : null;

  const canonicals = raw.canonicals
    .map((c) => resolveHref(c, pageUrl))
    .filter((u): u is URL => !!u && /^https?:$/.test(u.protocol))
    .map(canonicalizeUrl);

  const hreflang = raw.hreflang
    .map((h) => ({ lang: h.lang, href: resolveHref(h.href, pageUrl)?.toString() ?? "" }))
    .filter((h) => h.href)
    .slice(0, 50);
  const byLang = new Map<string, Set<string>>();
  for (const h of hreflang) {
    const key = h.lang.toLowerCase();
    byLang.set(key, (byLang.get(key) ?? new Set()).add(h.href));
  }

  const pageType = classifyPageType(pageUrl, schema);
  const structure = analyzeStructure(raw, title);
  const h1Count = raw.headings.filter((h) => h.level === 1).length;
  const mainText = raw.mainText;
  const topic = analyzeTopic(mainText, title, raw.headings);
  const entities = analyzeEntities(mainText, title, raw.headings, schema, pageType === "home");
  const questions = analyzeQuestions(raw, schema, mainText);
  const readinessInput = { structure, hasH1: h1Count > 0, topic, entities, questions };
  const sourceResult = analyzeSources(external, raw.headings, raw.bodyText);
  const bodyWords = raw.bodyText ? raw.bodyText.split(" ").length : 0;

  return {
    v: 1,
    url: pageUrl,
    pageType,
    bytes: opts.bytes ?? html.length,
    truncated: opts.truncated ?? false,
    lang: raw.lang,
    charset: raw.charset,
    viewport: raw.viewport,
    title,
    titleCount: raw.titles.length,
    metaDescription,
    metaDescriptionCount: raw.metaDescriptions.length,
    robotsMeta,
    canonicals: [...new Set(canonicals)],
    headings: raw.headings.slice(0, 80).map((h) => ({ level: h.level, text: clip(h.text, 160) })),
    h1Count,
    hierarchyIssues: structure.hierarchyIssues,
    landmarks: raw.landmarks,
    og: raw.og,
    twitter: raw.twitter,
    schema,
    microdataTypes: raw.microdataTypes,
    hasBreadcrumbNav: raw.hasBreadcrumbNav,
    images: raw.images,
    links: { internal, external, mailto, tel },
    hreflang,
    hreflangConflict: [...byLang.values()].some((s) => s.size > 1),
    text: {
      words: bodyWords,
      paragraphs: raw.paragraphs.length,
      textToHtmlRatio: Math.round((raw.bodyText.length / Math.max(1, html.length)) * 1000) / 1000,
      mainSource: raw.mainSource,
      excerpt: clip(mainText, 320),
    },
    structure: {
      sections: structure.sections,
      emptySections: structure.emptySections,
      thinSections: structure.thinSections,
      longParagraphs: structure.longParagraphs,
      lists: structure.lists,
      repeatedHeadings: structure.repeatedHeadings,
      hierarchyValid: structure.hierarchyValid,
    },
    titleH1Aligned: structure.titleH1Aligned,
    questions,
    topic,
    entities,
    readiness: analyzeReadiness(readinessInput),
    semanticCoverage: analyzeSemanticCoverage(readinessInput),
    trust: analyzeTrust({ internal, mailto, tel, text: raw.bodyText, schema, og: raw.og }),
    claims: analyzeClaims(mainText, sourceResult.candidates),
    sources: sourceResult.sources,
  };
}
