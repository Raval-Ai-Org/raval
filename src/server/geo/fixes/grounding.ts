// grounding.ts — "no invented facts" for AI-proposed content changes.
//
// The agent may restructure copy that already exists on the site, derive
// metadata from it, and use facts the user typed in. It may not add new
// claims, numbers, dates, names, emails or URLs. This check extracts the human
// readable text a patch ADDS (JSX text, content-ish string literals, meta/alt
// attributes, JSON-LD string values) and requires each fragment to be found in
// the grounding corpus: the site's scanned text, the file's existing text and
// the user's inputs.
//
// Heuristic by design; failures are reported with the offending strings so the
// agent can correct them or ask the user for the missing facts.

import { diffLines } from "diff";

export type GroundingResult = {
  ok: boolean;
  checked: number;
  ungrounded: { path: string; text: string; reason: string }[];
};

const normalize = (s: string) =>
  s
    .normalize("NFKC")
    .replace(/&(amp|nbsp|quot|#39|apos);/g, (m) =>
      m === "&amp;" ? "&" : m === "&nbsp;" ? " " : m === "&quot;" ? '"' : "'",
    )
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

const STOP = new Set(
  "a an the and or of to in on for with by at from is are was were be as it its this that these those your our we you us their they them how what why when where who which can will more most about into over than all any".split(
    " ",
  ),
);

const tokens = (s: string) =>
  normalize(s)
    .split(/[^\p{L}\p{N}@.+:/-]+/u)
    .map((t) => t.replace(/^[.:/-]+|[.:/-]+$/g, ""))
    .filter((t) => t.length >= 3 && !STOP.has(t));

/** Facts that must appear verbatim: numbers, dates, emails, URLs, handles, prices. */
const FACT = /(\b\d[\d,.:/-]*\b|[\w.+-]+@[\w-]+\.[\w.]+|https?:\/\/\S+|@\w{2,}|[$€£¥₹]\s?\d)/g;

/** Keys whose values are prose read by people or crawlers. */
const PROSE_KEY =
  /["']?\b(title|description|headline|slogan|text|answer|question|acceptedAnswer|alt|label|summary|content|caption|abstract|about)\b["']?\s*[:=]\s*(["'`])((?:\\.|(?!\2).)*)\2/gi;
/** Keys whose values are facts: short values still count and must be grounded. */
const FACT_KEY =
  /["']?\b(name|alternateName|legalName|author|publisher|jobTitle|datePublished|dateModified|foundingDate|founder|email|telephone|streetAddress|addressLocality|postalCode|sameAs|price|priceCurrency|ratingValue|reviewCount|award|og:site_name)\b["']?\s*[:=]\s*(["'`])((?:\\.|(?!\2).)*)\2/gi;

/** Human-readable fragments in added lines. */
export function addedTextFragments(path: string, before: string, after: string): string[] {
  const added: string[] = [];
  for (const part of diffLines(before, after)) {
    if (part.added) added.push(part.value);
  }
  const text = added.join("\n");
  const out = new Set<string>();
  const push = (s: string | undefined, fact = false) => {
    if (!s) return;
    const v = s.replace(/\s+/g, " ").trim();
    if (fact) {
      // Names, dates, emails, prices: short but meaningful. Skip template expressions.
      if (v.length >= 2 && !v.includes("${") && !/^[a-z][A-Za-z0-9_.]*$/.test(v)) out.add(v);
      return;
    }
    // Skip code-looking strings: identifiers, class lists, paths, selectors.
    if (v.length < 12 || !/\s/.test(v)) return;
    if (/^[a-z0-9_:\-/[\]#.!]+(\s+[a-z0-9_:\-/[\]#.!]+)+$/.test(v) && /-|:/.test(v)) return;
    if (/[{};=<>]/.test(v) && !/[.!?]$/.test(v)) return;
    out.add(v);
  };

  const isMarkup = /\.(html?|vue|svelte|astro|mdx?)$/i.test(path);
  const isCode = /\.(tsx|jsx|ts|js|mjs|vue|svelte|astro)$/i.test(path);

  // Attribute values that are read by people or crawlers.
  for (const m of text.matchAll(/\s(?:content|alt|title|aria-label)\s*=\s*(["'])([^"']{12,})\1/gi))
    push(m[2]);
  // Text between tags (HTML and JSX).
  for (const m of text.matchAll(/>([^<>{}]{12,})</g)) push(m[1]);
  if (isMarkup && /\.mdx?$/i.test(path)) {
    for (const line of text.split("\n"))
      if (!/^\s*(import|export|<)/.test(line)) push(line.replace(/^[#>*\-\d.\s]+/, ""));
  }
  if (isCode || /\.json$/i.test(path) || isMarkup) {
    const unescape = (v: string) => v.replace(/\\(["'`\\])/g, "$1");
    for (const m of text.matchAll(PROSE_KEY)) push(unescape(m[3]));
    for (const m of text.matchAll(FACT_KEY)) push(unescape(m[3]), true);
  }
  // JSON-LD blocks added wholesale.
  for (const m of text.matchAll(/application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = (v: unknown, fact = false) => {
        if (typeof v === "string") push(v, fact);
        else if (Array.isArray(v)) v.forEach((x) => walk(x, fact));
        else if (v && typeof v === "object")
          for (const [k, x] of Object.entries(v))
            if (!k.startsWith("@") && !["url", "logo", "image", "item"].includes(k))
              walk(
                x,
                /^(name|author|date\w*|email|telephone|sameAs|price\w*|rating\w*|founder|address\w*)$/i.test(
                  k,
                ),
              );
      };
      walk(JSON.parse(m[1]));
    } catch {
      /* not literal JSON (e.g. JSON.stringify(data)) — the string literals above cover it */
    }
  }
  return [...out].slice(0, 200);
}

export function groundingCheck(input: {
  files: { path: string; before: string | null; after: string }[];
  /** Scanned page text: titles, descriptions, headings, excerpts, FAQ text. */
  siteText: string[];
  /** Values the user supplied (authors, dates, profile URLs …). */
  inputs: string[];
  threshold?: number;
}): GroundingResult {
  const threshold = input.threshold ?? 0.85;
  const corpusParts = [
    ...input.siteText,
    ...input.inputs,
    ...input.files.map((f) => f.before ?? ""),
  ];
  const corpus = normalize(corpusParts.join("\n"));
  const corpusTokens = new Set(tokens(corpusParts.join(" ")));
  const ungrounded: GroundingResult["ungrounded"] = [];
  let checked = 0;

  for (const f of input.files) {
    for (const frag of addedTextFragments(f.path, f.before ?? "", f.after)) {
      checked++;
      const n = normalize(frag);
      if (corpus.includes(n)) continue;
      const facts = [...frag.matchAll(FACT)].map((m) => normalize(m[0]).replace(/[.,]$/, ""));
      const missingFact = facts.find((x) => !corpus.includes(x));
      if (missingFact) {
        ungrounded.push({
          path: f.path,
          text: frag.slice(0, 200),
          reason: `“${missingFact}” doesn't appear on the site or in your inputs`,
        });
        continue;
      }
      const t = tokens(frag);
      if (!t.length) continue;
      const known = t.filter((x) => corpusTokens.has(x)).length / t.length;
      if (known < threshold) {
        const unknown = t.filter((x) => !corpusTokens.has(x)).slice(0, 5);
        ungrounded.push({
          path: f.path,
          text: frag.slice(0, 200),
          reason: `new wording not found on the site (${unknown.join(", ")})`,
        });
      }
    }
  }
  return { ok: ungrounded.length === 0, checked, ungrounded: ungrounded.slice(0, 20) };
}
