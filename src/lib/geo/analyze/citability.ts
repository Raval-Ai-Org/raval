// citability.ts — whether an answer engine can lift a passage from this page
// and quote it on its own.
//
// Answer engines retrieve passages, not pages: a paragraph that opens with
// "This is why…" means nothing once it is cut out, and a dense, readable
// paragraph with a concrete fact is the unit that gets quoted. Adapted from
// GEO Optimizer's citability methods (MIT, (c) Juan Camilo Auriti — chunk
// quotability, readability, freshness and temporal coherence) and SiteOne
// Crawler's "vague references" verdict (MIT, (c) Ján Regeš), reduced to
// deterministic string work. Pure.

import { collapse, clip, sentences, words } from "./text";
import type { PageCitability } from "../types";

const MIN_PARAGRAPH_WORDS = 8;

// A pronoun or pointer that needs the previous paragraph, followed by a verb —
// "This is why", "It also lets" — not "This guide explains", which names its subject.
const VAGUE_OPENER =
  /^(?:(?:this|that|these|those|it|they)\s+(?:is|was|are|were|has|have|had|can|could|will|would|should|may|might|means|meant|makes|made|helps|helped|allows|lets|also|does|did|doesn't|isn't|aren't|won't|wasn't|includes|works|gives|keeps)\b|it's\b|that's\b|they're\b|as (?:mentioned|noted|discussed|shown|described|explained|stated) (?:above|below|earlier|before|previously)\b|see (?:above|below)\b|the (?:former|latter)\b|here's (?:why|how)\b)/i;

// A figure, or a proper name that isn't just the sentence's first word.
const CONCRETE_FACT = /\d|[a-z,;:]\s+[A-Z][a-zA-Z]{2,}/;

/** A figure, a name mid-sentence, or a capitalised name the paragraph repeats (its subject). */
function hasConcreteFact(p: string): boolean {
  if (CONCRETE_FACT.test(p)) return true;
  const caps = p.match(/\b[A-Z][a-zA-Z]{2,}\b/g) ?? [];
  const seen = new Set<string>();
  for (const c of caps) {
    if (seen.has(c)) return true;
    seen.add(c);
  }
  return false;
}

const HEADLINE_YEAR_CONTEXT =
  /\b(best|top|guide|review|reviews|trends?|ranking|rankings|list|vs\.?|versus|update|updated|edition|statistics|stats|report|predictions?|ideas|tips|checklist|how to|in \d{4}|for \d{4})\b/i;

const VISIBLE_UPDATED =
  /\b(?:last updated|updated|last modified|last reviewed|reviewed)(?:\s+on)?\s*:?\s+((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{4}|\d{4}-\d{2}-\d{2})/i;

/** Rough English syllable count: vowel groups, minus a silent final "e". */
export function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const groups = w
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "")
    .replace(/^y/, "")
    .match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups?.length ?? 1);
}

/** Flesch reading ease of prose sentences, or null when there's too little to judge. */
export function fleschEase(sentenceList: string[]): number | null {
  const ws = sentenceList.flatMap((s) => words(s).filter((w) => /[a-z]/i.test(w)));
  if (ws.length < 100 || sentenceList.length < 5) return null;
  const syl = ws.reduce((sum, w) => sum + syllables(w), 0);
  const score = 206.835 - 1.015 * (ws.length / sentenceList.length) - 84.6 * (syl / ws.length);
  return Math.round(Math.max(0, Math.min(100, score)));
}

export function analyzeCitability(input: {
  paragraphs: string[];
  title: string | null;
  h1: string | null;
  lang: string | null;
  bodyText: string;
  tables: number;
}): PageCitability {
  const prose = input.paragraphs
    .map(collapse)
    .filter((p) => words(p).length >= MIN_PARAGRAPH_WORDS);

  let quotable = 0;
  const vague: string[] = [];
  for (const p of prose) {
    const n = words(p).length;
    if (n >= 40 && n <= 150 && hasConcreteFact(p)) quotable++;
    if (VAGUE_OPENER.test(p)) vague.push(clip(p, 100));
  }

  const lang = (input.lang ?? "").toLowerCase();
  const english = !lang || lang.startsWith("en");
  const sents = prose.flatMap(sentences).filter((s) => words(s).length >= 3);
  const sentenceWords = sents.map((s) => words(s).length);
  const avg = sentenceWords.length
    ? Math.round((sentenceWords.reduce((a, b) => a + b, 0) / sentenceWords.length) * 10) / 10
    : 0;

  const headline = [input.title, input.h1].filter(Boolean).join(" · ");
  const year = /\b(19[89]\d|20\d{2})\b/.exec(headline);
  const updated = VISIBLE_UPDATED.exec(input.bodyText.slice(0, 20_000));

  return {
    paragraphs: prose.length,
    quotablePassages: quotable,
    vagueOpeners: vague.length,
    vagueSamples: vague.slice(0, 3),
    readability: {
      english,
      sentences: sents.length,
      avgSentenceWords: avg,
      fleschEase: english ? fleschEase(sents) : null,
      longSentences: sentenceWords.filter((n) => n > 40).length,
    },
    tables: input.tables,
    headlineYear: year && HEADLINE_YEAR_CONTEXT.test(headline) ? Number(year[1]) : null,
    visibleUpdated: updated ? updated[1] : null,
  };
}
