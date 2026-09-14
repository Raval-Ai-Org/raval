// content.ts — answer-engine content analysis. Ports of the GEO module's
// ContentStructureAnalyzer, QuestionAnalyzer, AnswerAnalyzer,
// TopicSemanticAnalyzer, EntityAnalyzer, ReadinessAnalyzer and
// SemanticCoverageAnalyzer. Deterministic heuristics — no model calls.
//
// Deliberate differences from the Python originals are marked "Mellox:".

import type { RawExtraction } from "../extract";
import type { EntityItem, PageAnalysis, QuestionItem, SchemaSummary } from "../types";
import {
  clip,
  collapse,
  countBy,
  meaningfulTokens,
  mostCommon,
  sentences,
  tokenize,
  wordCount,
} from "./text";

type Structure = PageAnalysis["structure"];
type Questions = PageAnalysis["questions"];
type Topic = PageAnalysis["topic"];
type Entities = PageAnalysis["entities"];
type Readiness = PageAnalysis["readiness"];
type Coverage = PageAnalysis["semanticCoverage"];

/* ───────────────────────── Structure ───────────────────────── */

function tokenSet(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/\b[a-z0-9]{2,}\b/g) ?? []);
}

/** Title / primary H1 alignment (evaluate_title_h1_alignment). null when neither exists. */
export function titleH1Alignment(title: string | null, h1: string | null): boolean | null {
  if (!title && !h1) return null;
  if (!title || !h1) return false;
  const t = collapse(title).toLowerCase();
  const h = collapse(h1).toLowerCase();
  if (t === h || t.includes(h) || h.includes(t)) return true;
  const a = tokenSet(title);
  const b = tokenSet(h1);
  if (!a.size || !b.size) return false;
  let shared = 0;
  for (const tok of a) if (b.has(tok)) shared++;
  return shared / Math.min(a.size, b.size) >= 0.6;
}

export function analyzeStructure(
  raw: RawExtraction,
  title: string | null,
): Structure & { hierarchyIssues: string[]; titleH1Aligned: boolean | null } {
  const headings = raw.headings;
  const issues: string[] = [];
  let valid = true;
  if (headings.length && headings[0].level !== 1) {
    valid = false;
    issues.push(`Outline starts with H${headings[0].level} instead of H1`);
  }
  for (let i = 1; i < headings.length; i++) {
    const prev = headings[i - 1];
    const cur = headings[i];
    if (cur.level > prev.level + 1) {
      valid = false;
      if (issues.length < 10) {
        issues.push(`Skips from H${prev.level} to H${cur.level} at "${clip(cur.text, 60)}"`);
      }
    }
  }

  const counts = countBy(headings.map((h) => h.text.toLowerCase()).filter(Boolean));
  const repeatedHeadings = [...counts.entries()]
    .filter(([, n]) => n > 1)
    .map(([text]) => clip(headings.find((h) => h.text.toLowerCase() === text)?.text, 80))
    .slice(0, 10);

  const withHeading = raw.sections.filter((s) => s.heading !== null);
  const emptySections = withHeading
    .filter((s) => s.words === 0 && s.lists === 0)
    .map((s) => clip(s.heading, 80))
    .slice(0, 10);
  const thinSections = withHeading
    .filter((s) => s.words > 0 && s.words < 5 && s.lists === 0)
    .map((s) => clip(s.heading, 80))
    .slice(0, 10);

  const firstH1 = headings.find((h) => h.level === 1 && h.text)?.text ?? null;
  return {
    sections: raw.sections.length,
    emptySections,
    thinSections,
    longParagraphs: raw.paragraphs.filter((p) => wordCount(p) >= 150).length,
    lists: raw.lists,
    repeatedHeadings,
    hierarchyValid: valid,
    hierarchyIssues: issues,
    titleH1Aligned: titleH1Alignment(title, firstH1),
  };
}

/* ───────────────────────── Questions & answers ───────────────────────── */

const QUESTION_WORDS = new Set([
  "who",
  "what",
  "where",
  "when",
  "why",
  "how",
  "can",
  "is",
  "are",
  "does",
  "do",
  "should",
  "which",
  "will",
  "could",
  "would",
]);

export function isQuestionText(text: string | null | undefined): boolean {
  const s = (text ?? "").trim();
  if (!s) return false;
  const w = s.toLowerCase().match(/\b[a-z']+\b/g) ?? [];
  if (w.length < 3) return false;
  if (/cookie|javascript|log in|sign in|accept/i.test(s)) return false;
  return s.endsWith("?") || QUESTION_WORDS.has(w[0] ?? "");
}

const DIRECT_STARTERS = [
  "yes",
  "no",
  "is ",
  "are ",
  "refers to",
  "means ",
  "defined as",
  "typically",
  "generally",
  "consists of",
  "includes ",
  "designed to",
  "works by",
  "allows ",
  "provides ",
  "primarily",
  "first",
  "mainly",
];
const DEFINITION_VERBS = [
  " is ",
  " are ",
  " was ",
  " were ",
  " refers to ",
  " defined as ",
  " means ",
  " consists of ",
  " includes ",
  " provides ",
  " works by ",
  " operates by ",
];

/** evaluate_answer_directness: does the answer open with an assertion? */
export function evaluateAnswerDirectness(text: string | null | undefined): boolean {
  const clean = (text ?? "").trim().toLowerCase();
  if (!clean) return false;
  const first = clean.split(/[.?!]\s+/)[0];
  if (DIRECT_STARTERS.some((s) => first.startsWith(s))) return true;
  if ([" because ", " due to ", " in order to ", " such as "].some((k) => first.includes(k))) {
    return true;
  }
  return DEFINITION_VERBS.some((v) => ` ${first} `.includes(v));
}

export function analyzeQuestions(
  raw: RawExtraction,
  schema: SchemaSummary,
  text: string,
): Questions {
  const items: QuestionItem[] = [];
  const seen = new Set<string>();
  const unansweredHeadings: string[] = [];
  const sectionByHeading = new Map(
    raw.sections.filter((s) => s.heading).map((s) => [s.heading!.toLowerCase(), s]),
  );

  for (const h of raw.headings) {
    if (!isQuestionText(h.text)) continue;
    const key = h.text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const sec = sectionByHeading.get(key);
    const answered = !!sec && (sec.words >= 5 || sec.lists > 0);
    if (!answered) unansweredHeadings.push(clip(h.text, 120));
    items.push({
      text: clip(h.text, 200),
      source: "heading",
      answered,
      answerWords: sec?.words ?? 0,
      direct: answered && evaluateAnswerDirectness(sec?.firstParagraph),
    });
  }

  for (const f of schema.faq) {
    const key = f.question.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const answered = f.answer.trim().length > 0;
    items.push({
      text: clip(f.question, 200),
      source: "faq_schema",
      answered,
      answerWords: wordCount(f.answer),
      direct: answered && evaluateAnswerDirectness(f.answer),
    });
  }

  const sents = sentences(text.slice(0, 60_000));
  let bodyQuestions = 0;
  for (let i = 0; i < sents.length && bodyQuestions < 20; i++) {
    const s = sents[i];
    if (!s.endsWith("?") || wordCount(s) < 4) continue;
    const key = s.toLowerCase();
    if ([...seen].some((q) => q.includes(key) || key.includes(q))) continue;
    seen.add(key);
    bodyQuestions++;
    const next = sents[i + 1] ?? "";
    const answered = !!next && !next.endsWith("?") && wordCount(next) >= 5;
    items.push({
      text: clip(s, 200),
      source: "body",
      answered,
      answerWords: answered ? wordCount(next) : 0,
      direct: answered && evaluateAnswerDirectness(next),
    });
  }

  const capped = items.slice(0, 40);
  return {
    items: capped,
    total: capped.length,
    answered: capped.filter((q) => q.answered).length,
    direct: capped.filter((q) => q.direct).length,
    unansweredHeadings: unansweredHeadings.slice(0, 10),
    faqSchema: schema.faq.length > 0 || schema.types.some((t) => /^(faqpage|qapage)$/i.test(t)),
  };
}

/* ───────────────────────── Topic ───────────────────────── */

export function analyzeTopic(
  text: string,
  title: string | null,
  headings: { level: number; text: string }[],
): Topic {
  const bodyTokens = meaningfulTokens(text);
  const titleTokens = meaningfulTokens(title);
  const headingTexts = headings.map((h) => h.text).filter(Boolean);
  const h1Texts = headings.filter((h) => h.level === 1).map((h) => h.text);
  const headingTokens = headingTexts.flatMap((t) => meaningfulTokens(t));
  const h1Tokens = h1Texts.flatMap((t) => meaningfulTokens(t));
  const totalWords = tokenize(text).length;

  const empty: Topic = {
    primary: null,
    confidence: 0,
    supporting: [],
    inTitle: false,
    inH1: false,
    lexicalDiversity: 0,
    depth: "thin",
    stuffing: null,
  };
  const weighted = [
    ...titleTokens,
    ...titleTokens,
    ...titleTokens,
    ...h1Tokens,
    ...h1Tokens,
    ...h1Tokens,
    ...headingTokens,
    ...headingTokens,
    ...bodyTokens,
  ];
  if (!weighted.length) return empty;

  const depth = totalWords < 50 ? "thin" : totalWords < 200 ? "moderate" : "deep";
  const unigrams = countBy(weighted);
  const sequence = meaningfulTokens([title ?? "", ...headingTexts, text].join(" "));
  const bigrams = countBy(sequence.slice(0, -1).map((w, i) => `${w} ${sequence[i + 1]}`));

  const titleLower = (title ?? "").toLowerCase();
  const h1Lower = h1Texts.join(" ").toLowerCase();

  let primary: string | null = null;
  let confidence = 0;
  const topBigram = mostCommon(bigrams, 5).find(([, n]) => n >= 2);
  if (topBigram) {
    primary = topBigram[0];
    const grounded = titleLower.includes(primary) || h1Lower.includes(primary);
    confidence = Math.min(0.95, 0.7 + (grounded ? 0.2 : 0));
  } else {
    const [word] = mostCommon(unigrams, 1)[0];
    primary = word;
    const grounded = titleLower.includes(word) || h1Lower.includes(word);
    confidence = Math.min(0.85, 0.55 + (grounded ? 0.2 : 0));
  }

  const seen = new Set(primary.split(" "));
  const supporting: string[] = [];
  for (const [term, n] of mostCommon(unigrams, 12)) {
    if (supporting.length >= 4) break;
    if (!seen.has(term) && n >= 2) {
      supporting.push(term);
      seen.add(term);
    }
  }

  // Mellox: keyword stuffing only on pages long enough for density to mean
  // something (a 40-word page repeating its brand name is not stuffing).
  let stuffing: Topic["stuffing"] = null;
  if (totalWords >= 150) {
    for (const [term, n] of mostCommon(countBy(bodyTokens), 5)) {
      const density = (n / totalWords) * 100;
      if (density > 7 && n >= 5) {
        stuffing = { term, density: Math.round(density * 10) / 10 };
        break;
      }
    }
  }

  return {
    primary,
    confidence: Math.round(confidence * 100) / 100,
    supporting,
    inTitle: titleLower.includes(primary),
    inH1: h1Lower.includes(primary),
    lexicalDiversity: totalWords
      ? Math.round((new Set(bodyTokens).size / totalWords) * 1000) / 1000
      : 0,
    depth,
    stuffing,
  };
}

/* ───────────────────────── Entities ───────────────────────── */

const KNOWN_SCHEMA_TYPES: Record<string, string> = {
  organization: "organization",
  corporation: "organization",
  localbusiness: "organization",
  person: "person",
  product: "product",
  place: "place",
  service: "service",
  brand: "brand",
  softwareapplication: "product",
  event: "event",
};
const ORG_SUFFIX_RE =
  /\b([A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+){0,3}\s+(?:Inc\.?|LLC\.?|Corp\.?|Corporation|Ltd\.?|Technologies|Labs|Laboratories|Foundation|Group))(?=[\s,.;:)]|$)/g;

export function analyzeEntities(
  text: string,
  title: string | null,
  headings: { level: number; text: string }[],
  schema: SchemaSummary,
  isHome: boolean,
): Entities {
  const titleLower = (title ?? "").toLowerCase();
  const h1Lower = headings
    .filter((h) => h.level === 1)
    .map((h) => h.text)
    .join(" ")
    .toLowerCase();
  const entities = new Map<string, EntityItem>();

  for (const org of schema.organizations) {
    const key = org.name.toLowerCase();
    entities.set(key, {
      name: clip(org.name, 100),
      type: "organization",
      sources: ["structured_data"],
      sameAs: org.sameAs.length,
      inTitle: titleLower.includes(key),
      inH1: h1Lower.includes(key),
    });
  }
  for (const name of schema.names) {
    const key = name.toLowerCase();
    if (entities.has(key)) continue;
    // Only typed entities the analyzer understands; page titles etc. are names too.
    const type = schema.types.map((t) => KNOWN_SCHEMA_TYPES[t.toLowerCase()]).find(Boolean);
    if (!type || type === "organization") continue;
    entities.set(key, {
      name: clip(name, 100),
      type,
      sources: ["structured_data"],
      sameAs: 0,
      inTitle: titleLower.includes(key),
      inH1: h1Lower.includes(key),
    });
    if (entities.size >= 25) break;
  }

  const haystack = `${text.slice(0, 30_000)}\n${headings.map((h) => h.text).join("\n")}`;
  for (const m of haystack.matchAll(ORG_SUFFIX_RE)) {
    const name = collapse(m[1]);
    const key = name.toLowerCase();
    if (name.length < 4 || entities.size >= 30) continue;
    const existing = entities.get(key);
    if (existing) {
      if (!existing.sources.includes("content")) existing.sources.push("content");
      continue;
    }
    entities.set(key, {
      name,
      type: "organization",
      sources: ["content"],
      sameAs: 0,
      inTitle: titleLower.includes(key),
      inH1: h1Lower.includes(key),
    });
  }

  const items = [...entities.values()];
  // Mellox: the site-wide Organization block sits in every page's layout, so
  // "schema entity not in the title/H1" is only meaningful on the homepage;
  // product/person entities are checked on the page that declares them.
  const consistencyIssues = items
    .filter(
      (e) =>
        e.sources.includes("structured_data") &&
        !e.inTitle &&
        !e.inH1 &&
        (e.type !== "organization" || isHome),
    )
    .map((e) => `${e.name} (${e.type}) is declared in schema but not named in the title or H1`)
    .slice(0, 5);

  return {
    items: items.slice(0, 20),
    hasOrganization: items.some((e) => e.type === "organization"),
    consistencyIssues,
  };
}

/* ───────────────────────── Readiness & coverage ───────────────────────── */

const round2 = (n: number) => Math.round(n * 100) / 100;

/** ReadinessAnalyzer: 40% Q&A, 25% structure, 20% topic depth, 15% entities. */
export function analyzeReadiness(input: {
  structure: Structure;
  hasH1: boolean;
  topic: Topic;
  entities: Entities;
  questions: Questions;
}): Readiness {
  const { structure, hasH1, topic, entities, questions } = input;
  const positives: string[] = [];
  const negatives: string[] = [];

  let qa = 0.5;
  if (questions.total > 0) {
    const answeredRatio = questions.answered / questions.total;
    const directRatio = questions.answered ? questions.direct / questions.answered : 0;
    qa = 0.6 * answeredRatio + 0.3 * directRatio + (questions.faqSchema ? 0.1 : 0);
    if (answeredRatio >= 0.75) {
      positives.push(`${questions.answered}/${questions.total} questions have an answer`);
    } else {
      negatives.push(
        `${questions.total - questions.answered}/${questions.total} questions lack an answer`,
      );
    }
    if (questions.direct) positives.push(`${questions.direct} direct, quotable answers`);
    if (questions.faqSchema) positives.push("FAQ schema makes answers machine-readable");
    else if (questions.total >= 3) negatives.push("Question-rich page without FAQ schema");
  } else {
    negatives.push("No questions or question headings for answer engines to match");
  }

  let struct = 0;
  if (hasH1) {
    struct += 0.3;
    positives.push("A primary H1 anchors the page");
  } else negatives.push("No H1 heading");
  if (structure.hierarchyValid) struct += 0.3;
  else negatives.push("Heading levels skip, breaking the outline");
  if (structure.lists > 0) {
    struct += 0.2;
    positives.push("Lists support snippet extraction");
  }
  if (!structure.emptySections.length && !structure.thinSections.length) struct += 0.2;
  else {
    negatives.push(
      `${structure.emptySections.length + structure.thinSections.length} empty or thin sections under headings`,
    );
  }

  let semantic = 0;
  if (topic.primary) {
    semantic += 0.3;
    if (topic.inTitle && topic.inH1) semantic += 0.3;
    else if (topic.inTitle || topic.inH1) semantic += 0.2;
    else negatives.push(`Main topic "${topic.primary}" is not in the title or H1`);
  }
  semantic += topic.depth === "deep" ? 0.4 : topic.depth === "moderate" ? 0.3 : 0.1;
  if (topic.depth === "thin") negatives.push("Too little text to give answer engines context");

  let entity = 0;
  if (entities.items.length) {
    entity += 0.4;
    positives.push(`${entities.items.length} recognisable entities`);
  } else negatives.push("No brand, organization or product entity detected");
  if (entities.hasOrganization) entity += 0.3;
  if (!entities.consistencyIssues.length) entity += 0.3;

  const score = round2(0.4 * qa + 0.25 * struct + 0.2 * semantic + 0.15 * entity);
  return {
    score,
    level: score >= 0.75 ? "high" : score >= 0.45 ? "moderate" : "low",
    components: {
      qa: round2(qa),
      structure: round2(struct),
      semantic: round2(semantic),
      entity: round2(entity),
    },
    positives: positives.slice(0, 6),
    negatives: negatives.slice(0, 6),
  };
}

/** SemanticCoverageAnalyzer: 35% topic, 25% Q&A, 20% entities, 20% structural breadth. */
export function analyzeSemanticCoverage(input: {
  structure: Structure;
  hasH1: boolean;
  topic: Topic;
  entities: Entities;
  questions: Questions;
}): Coverage {
  const { structure, hasH1, topic, entities, questions } = input;
  const gaps: string[] = [];

  let topicScore = 0;
  if (topic.primary) {
    topicScore += 0.5;
    if (topic.supporting.length) topicScore += 0.3;
    else gaps.push("No supporting sub-topics around the main topic");
    topicScore += topic.depth === "deep" ? 0.2 : topic.depth === "moderate" ? 0.1 : 0;
  } else gaps.push("No identifiable main topic");

  let qaScore = 0.5;
  if (questions.total > 0) {
    qaScore = questions.answered / questions.total;
    if (qaScore < 0.4) gaps.push(`${questions.total - questions.answered} unanswered questions`);
  }

  let entityScore = 0;
  if (entities.items.length) {
    entityScore += 0.5;
    if (entities.hasOrganization) entityScore += 0.3;
    if (!entities.consistencyIssues.length) entityScore += 0.2;
  } else gaps.push("No named entity context");

  let breadth = 0;
  if (hasH1) breadth += 0.3;
  if (structure.sections >= 3) breadth += 0.4;
  else if (structure.sections >= 1) breadth += 0.2;
  else gaps.push("One undivided block of content");
  if (!structure.emptySections.length && !structure.thinSections.length) breadth += 0.3;

  const score = round2(
    0.35 * Math.min(1, topicScore) +
      0.25 * qaScore +
      0.2 * Math.min(1, entityScore) +
      0.2 * Math.min(1, breadth),
  );
  return {
    score,
    level: score >= 0.75 ? "comprehensive" : score >= 0.45 ? "moderate" : "narrow",
    gaps: gaps.slice(0, 5),
  };
}
