// extract.ts — one pass over a page's HTML collecting the raw evidence every
// GEO analyzer needs. A port of the GEO module's PageHTMLParser and
// ContentStructureParser, merged so each page is tokenized exactly once.
//
// Pure: input is the HTML string and the page URL, output is plain data.

import { tokenizeHtml, VOID_ELEMENTS } from "./html-tokenizer";
import { collapse, wordCount } from "./analyze/text";

export type RawLink = { href: string; text: string; rel: string };
export type RawSection = {
  heading: string | null;
  level: number | null;
  words: number;
  lists: number;
  firstParagraph: string | null;
};

export type RawExtraction = {
  lang: string | null;
  charset: boolean;
  titles: string[];
  metaDescriptions: string[];
  robotsMeta: string[];
  viewport: boolean;
  og: Record<string, string>;
  twitter: Record<string, string>;
  canonicals: string[];
  hreflang: { lang: string; href: string }[];
  jsonLd: string[];
  microdataTypes: string[];
  headings: { level: number; text: string }[];
  sections: RawSection[];
  paragraphs: string[];
  lists: number;
  images: { total: number; missingAlt: number; emptyAlt: number };
  links: RawLink[];
  landmarks: string[];
  hasBreadcrumbNav: boolean;
  bodyText: string;
  mainText: string;
  mainSource: "main" | "article" | "role_main" | "body" | "none";
};

const IGNORE_CONTENT = new Set([
  "script",
  "style",
  "noscript",
  "svg",
  "canvas",
  "template",
  "iframe",
]);
const HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const LANDMARKS = new Set(["main", "article", "nav", "header", "footer", "section", "aside"]);
const BLOCK_BREAKS = new Set([
  "p",
  "div",
  "section",
  "article",
  "header",
  "footer",
  "main",
  "nav",
  "aside",
  "li",
  "ul",
  "ol",
  "table",
  "tr",
  "td",
  "th",
  "br",
  "blockquote",
  "figure",
  "figcaption",
  "form",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
]);

const MAX_LINKS = 1500;
const MAX_HEADINGS = 200;

export function extractHtml(html: string): RawExtraction {
  const out: RawExtraction = {
    lang: null,
    charset: false,
    titles: [],
    metaDescriptions: [],
    robotsMeta: [],
    viewport: false,
    og: {},
    twitter: {},
    canonicals: [],
    hreflang: [],
    jsonLd: [],
    microdataTypes: [],
    headings: [],
    sections: [],
    paragraphs: [],
    lists: 0,
    images: { total: 0, missingAlt: 0, emptyAlt: 0 },
    links: [],
    landmarks: [],
    hasBreadcrumbNav: false,
    bodyText: "",
    mainText: "",
    mainSource: "none",
  };

  const body: string[] = [];
  const main: string[] = [];
  const article: string[] = [];
  const roleMain: string[] = [];
  const landmarks = new Set<string>();
  const microdata = new Set<string>();

  let ignoreDepth = 0;
  let inTitle = false;
  let titleParts: string[] = [];
  let inJsonLd = false;
  let jsonLdParts: string[] = [];
  let headingLevel: number | null = null;
  let headingParts: string[] = [];
  let inParagraph = false;
  let paragraphParts: string[] = [];
  let anchor: { href: string; rel: string; parts: string[] } | null = null;
  let mainDepth = 0;
  let articleDepth = 0;
  const roleMainStack: string[] = [];

  let section: RawSection = {
    heading: null,
    level: null,
    words: 0,
    lists: 0,
    firstParagraph: null,
  };
  const finishSection = () => {
    if (section.heading !== null || section.words > 0) out.sections.push(section);
  };

  const closeParagraph = () => {
    if (!inParagraph) return;
    const text = collapse(paragraphParts.join(" "));
    if (text) {
      out.paragraphs.push(text);
      if (section.firstParagraph === null) section.firstParagraph = text.slice(0, 400);
    }
    inParagraph = false;
    paragraphParts = [];
  };

  for (const token of tokenizeHtml(html)) {
    if (token.type === "start") {
      const { name, attrs } = token;

      if (name === "html" && (attrs.lang || attrs["xml:lang"])) {
        out.lang = (attrs.lang || attrs["xml:lang"]).trim() || null;
      }

      if (name === "meta") {
        const key = (attrs.name || "").trim().toLowerCase();
        const prop = (attrs.property || "").trim().toLowerCase();
        const content = attrs.content ?? "";
        if ("charset" in attrs || (attrs["http-equiv"] || "").toLowerCase() === "content-type") {
          out.charset = true;
        }
        if (key === "description") out.metaDescriptions.push(content.trim());
        if (key === "viewport") out.viewport = true;
        if (key === "robots" || key === "googlebot") out.robotsMeta.push(content.trim());
        const og = prop.startsWith("og:") ? prop : key.startsWith("og:") ? key : "";
        if (og && !(og in out.og)) out.og[og] = content.trim();
        const tw = key.startsWith("twitter:") ? key : prop.startsWith("twitter:") ? prop : "";
        if (tw && !(tw in out.twitter)) out.twitter[tw] = content.trim();
      }

      if (name === "link") {
        const rel = (attrs.rel || "").toLowerCase().split(/\s+/);
        if (rel.includes("canonical")) out.canonicals.push((attrs.href || "").trim());
        if (rel.includes("alternate") && attrs.hreflang) {
          out.hreflang.push({ lang: attrs.hreflang.trim(), href: (attrs.href || "").trim() });
        }
      }

      if (name === "title") {
        inTitle = true;
        titleParts = [];
        continue;
      }

      if (name === "script" && (attrs.type || "").trim().toLowerCase() === "application/ld+json") {
        inJsonLd = true;
        jsonLdParts = [];
      }

      if (attrs.itemtype) {
        const type = attrs.itemtype.trim().split(/[/#]/).pop();
        if (type) microdata.add(type);
      }

      const aria = (attrs["aria-label"] || "").toLowerCase();
      const cls = `${attrs.class || ""} ${attrs.id || ""}`.toLowerCase();
      if (aria === "breadcrumb" || cls.includes("breadcrumb")) out.hasBreadcrumbNav = true;

      if (LANDMARKS.has(name)) landmarks.add(name);
      if ((attrs.role || "").toLowerCase() === "main") landmarks.add("main");

      if (IGNORE_CONTENT.has(name) && !token.selfClosing) {
        ignoreDepth++;
        continue;
      }
      if (ignoreDepth > 0) continue;

      if (name === "main") mainDepth++;
      if (name === "article") articleDepth++;
      if ((attrs.role || "").toLowerCase() === "main" && !VOID_ELEMENTS.has(name)) {
        roleMainStack.push(name);
      }

      if (BLOCK_BREAKS.has(name)) {
        body.push("\n");
        if (inParagraph && name !== "br") closeParagraph();
      }

      if (HEADINGS.has(name)) {
        headingLevel = Number(name[1]);
        headingParts = [];
      }

      if (name === "p") {
        inParagraph = true;
        paragraphParts = [];
      }

      if (name === "ul" || name === "ol") {
        out.lists++;
        section.lists++;
      }

      if (name === "img") {
        out.images.total++;
        if (!("alt" in attrs)) out.images.missingAlt++;
        else if (!attrs.alt.trim()) out.images.emptyAlt++;
      }

      if (name === "a") {
        anchor = {
          href: (attrs.href || "").trim(),
          rel: (attrs.rel || "").toLowerCase(),
          parts: [],
        };
      }
      continue;
    }

    if (token.type === "end") {
      const { name } = token;

      if (name === "title" && inTitle) {
        out.titles.push(collapse(titleParts.join("")));
        inTitle = false;
        continue;
      }

      if (name === "script" && inJsonLd) {
        out.jsonLd.push(jsonLdParts.join(""));
        inJsonLd = false;
      }

      if (IGNORE_CONTENT.has(name)) {
        if (ignoreDepth > 0) ignoreDepth--;
        continue;
      }
      if (ignoreDepth > 0) continue;

      if (HEADINGS.has(name) && headingLevel !== null) {
        const text = collapse(headingParts.join(" "));
        if (out.headings.length < MAX_HEADINGS) out.headings.push({ level: headingLevel, text });
        closeParagraph();
        finishSection();
        section = { heading: text, level: headingLevel, words: 0, lists: 0, firstParagraph: null };
        headingLevel = null;
        headingParts = [];
        body.push("\n");
        continue;
      }

      if (name === "p") closeParagraph();
      if (name === "main" && mainDepth > 0) mainDepth--;
      if (name === "article" && articleDepth > 0) articleDepth--;
      if (roleMainStack.length && roleMainStack[roleMainStack.length - 1] === name)
        roleMainStack.pop();

      if (name === "a" && anchor) {
        if (out.links.length < MAX_LINKS) {
          out.links.push({
            href: anchor.href,
            rel: anchor.rel,
            text: collapse(anchor.parts.join(" ")),
          });
        }
        anchor = null;
      }
      if (BLOCK_BREAKS.has(name)) body.push("\n");
      continue;
    }

    // text
    const text = token.text;
    if (inTitle) {
      titleParts.push(text);
      continue;
    }
    if (inJsonLd) {
      jsonLdParts.push(text);
      continue;
    }
    if (ignoreDepth > 0) continue;

    body.push(text);
    if (headingLevel !== null) headingParts.push(text);
    else section.words += wordCount(text);
    if (inParagraph) paragraphParts.push(text);
    if (anchor) anchor.parts.push(text);
    if (mainDepth > 0) main.push(text);
    if (articleDepth > 0) article.push(text);
    if (roleMainStack.length > 0) roleMain.push(text);
  }

  closeParagraph();
  finishSection();

  out.landmarks = [...landmarks].sort();
  out.microdataTypes = [...microdata].sort();
  out.bodyText = collapse(body.join(" "));
  const mainText = collapse(main.join(" "));
  const articleText = collapse(article.join(" "));
  const roleMainText = collapse(roleMain.join(" "));
  if (mainText) [out.mainText, out.mainSource] = [mainText, "main"];
  else if (articleText) [out.mainText, out.mainSource] = [articleText, "article"];
  else if (roleMainText) [out.mainText, out.mainSource] = [roleMainText, "role_main"];
  else if (out.bodyText) [out.mainText, out.mainSource] = [out.bodyText, "body"];
  return out;
}

/** Resolve an href against the page URL; null for non-navigable or malformed values. */
export function resolveHref(href: string, base: string): URL | null {
  if (!href || href.startsWith("#") || /^(javascript|data|blob):/i.test(href)) return null;
  try {
    return new URL(href, base);
  } catch {
    return null;
  }
}
