// The Mellox Score: five 0-100 dimensions and one overall number. Pure.
//
// The model proposes the dimensions; this file decides the overall number, the
// free checks that cap a dimension, and how sure Mellox may claim to be.
import { aiClicheScore } from "@/lib/studio/naturalize";
import {
  DIMENSIONS,
  type Confidence,
  type Dimension,
  type Dimensions,
  type HeuristicNote,
  type Subject,
  type Trait,
} from "./contracts";
import { normalizeText, stableHash } from "./hash";

/** Bump when scores stop being comparable with older ones. */
export const SCORE_VERSION = 1;

export const WEIGHTS: Dimensions = { fit: 0.3, hook: 0.25, clarity: 0.15, trust: 0.15, cta: 0.15 };

export function clampScore(value: unknown, fallback = 50): number {
  const n = typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}

export function cleanDimensions(raw: unknown): Dimensions {
  const record = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out = {} as Dimensions;
  for (const key of DIMENSIONS) out[key] = clampScore(record[key]);
  return out;
}

export function overallOf(dimensions: Dimensions): number {
  let total = 0;
  for (const key of DIMENSIONS) total += dimensions[key] * WEIGHTS[key];
  return clampScore(total);
}

export function averageDimensions(rows: { dimensions: Dimensions; weight: number }[]): Dimensions {
  const out = {} as Dimensions;
  const weight = rows.reduce((sum, row) => sum + Math.max(0, row.weight), 0) || 1;
  for (const key of DIMENSIONS) {
    out[key] = clampScore(
      rows.reduce((sum, row) => sum + row.dimensions[key] * Math.max(0, row.weight), 0) / weight,
    );
  }
  return out;
}

export function subjectHash(subject: Subject): string {
  return stableHash(
    [
      subject.kind,
      subject.platform,
      normalizeText(subject.title),
      normalizeText(subject.body),
    ].join("␟"),
  );
}

export function openingOf(body: string): string {
  return (
    body
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

// A question, a link, or a sentence that starts by telling the reader what to
// do. "We opened a shop" is not a next step; "Shop the new range" is.
const CTA_RE =
  /\?|\bhttps?:\/\/|\blink in bio\b|\b(learn|read|find out) more\b|(?:^|[.!?:\n]\s*|\p{Extended_Pictographic}\s*)(?:please\s+|now\s+|then\s+|so\s+|just\s+)?(comment|reply|share|save|follow|subscribe|sign up|signup|join|book|try|download|get|grab|shop|buy|order|see|dm|message|tell|click|tap|visit|start|register|apply|watch|check out|send|call|drop)\b/iu;

export type Heuristics = { notes: HeuristicNote[]; caps: Partial<Dimensions> };

/** Free checks: no model, the same answer every time. A cap can only lower a dimension. */
export function checkSubject(subject: Subject): Heuristics {
  const notes: HeuristicNote[] = [];
  const caps: Partial<Dimensions> = {};
  const body = subject.body.trim();
  const opening = openingOf(body);

  if (body.length < 25) {
    notes.push({ id: "too_short", level: "warn", text: "There is very little to react to yet." });
    for (const key of DIMENSIONS) caps[key] = 45;
    return { notes, caps };
  }

  if (opening.length > 150) {
    caps.hook = 70;
    notes.push({
      id: "long_opening",
      level: "warn",
      text: "The first line is long. Most people decide in the first few words.",
    });
  } else if (opening.length >= 12) {
    notes.push({
      id: "short_opening",
      level: "good",
      text: "The first line is short enough to read at a glance.",
    });
  }

  if (subject.kind !== "concept" && !CTA_RE.test(body.slice(-400))) {
    caps.cta = 55;
    notes.push({
      id: "no_next_step",
      level: "warn",
      text: "It doesn't say what to do next.",
    });
  }

  const cliche = aiClicheScore(body);
  if (cliche.score >= 2) {
    caps.trust = 70;
    notes.push({
      id: "generic_phrases",
      level: "warn",
      text: `Some phrases sound generic (${cliche.hits.slice(0, 2).join(", ")}).`,
    });
  }
  return { notes, caps };
}

export function applyCaps(dimensions: Dimensions, caps: Partial<Dimensions>): Dimensions {
  const out = { ...dimensions };
  for (const key of Object.keys(caps) as Dimension[]) {
    const cap = caps[key];
    if (typeof cap === "number") out[key] = Math.min(out[key], cap);
  }
  return out;
}

export type Verdict = "Strong" | "Good" | "Okay" | "Weak";

export function verdictFor(overall: number): Verdict {
  if (overall >= 80) return "Strong";
  if (overall >= 65) return "Good";
  if (overall >= 50) return "Okay";
  return "Weak";
}

export type ScoreTone = "success" | "primary" | "warning" | "destructive";

export function toneFor(overall: number): ScoreTone {
  if (overall >= 80) return "success";
  if (overall >= 65) return "primary";
  if (overall >= 50) return "warning";
  return "destructive";
}

/**
 * How sure Mellox may say it is. Real results are what earn "high"; a deeper
 * check on a well-described audience earns "medium"; everything else is a guess.
 */
export function confidenceFor(args: {
  depth: "score" | "pulse";
  traits: Trait[];
  measuredPosts: number;
}): Confidence {
  if (args.measuredPosts >= 20) return "high";
  if (args.measuredPosts >= 8) return "medium";
  const known = args.traits.filter((t) => t.source !== "assumed").length;
  if (args.depth === "pulse" && known >= 4) return "medium";
  return "low";
}

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  low: "Early guess",
  medium: "Fairly sure",
  high: "Backed by your results",
};
