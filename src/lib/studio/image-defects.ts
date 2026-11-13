// image-defects.ts — which visual-review results are worth a second picture (pure).
//
// The review (`studio.image.review`) returns free-text issues and, since
// Round 5, a creative rubric (0-10 per dimension) with specific fixes. A
// re-render costs a full picture plus another review, paid by Mellox, so a
// piece gets at most one, and only for:
//   - a defect a person can't publish (wrong or misspelled words, a wrong,
//     invented or missing product, a covered face, broken anatomy, an
//     unreadable result), or
//   - a picture that scores clearly below the bar on the rubric for its kind
//     (a meme whose joke doesn't read, a sale whose offer is lost, a design
//     with no hierarchy or an obvious generic-AI look), with fixes to apply.
// Everything else stays a note on the piece; a person can still ask for a
// change in the edit chat. The better-scoring of the two pictures is kept.

const HARD = [
  /misspel|spelling|typo|wrong (word|text|letter)|extra (word|text|letter)s?|missing (word|text|letter)/i,
  /garbled|gibberish|nonsense (text|letters)|illegible|unreadable|scrambled/i,
  /(wrong|different|invented|second|extra|missing|altered|distorted) product/i,
  /product('s)? (shape|colou?r|label|logo)s? (differ|changed|wrong|altered)/i,
  /(inside|in) a (frame|card|box|window)/i,
  /face (is )?(covered|hidden|cut off|obscured)|cover(s|ing)? (a |the )?(person's )?face/i,
  /(extra|missing|fused|deformed|malformed) (finger|hand|limb|arm|leg|eye)s?|deformed|malformed/i,
  /fake (logo|brand)|invented (logo|brand|badge|claim|price|offer)/i,
  /blank|empty (image|picture|canvas)|corrupt/i,
];

/** The issues that justify one automatic re-render (all others stay notes). */
export function hardImageDefects(issues: readonly string[]): string[] {
  return issues.filter((issue) => HARD.some((rule) => rule.test(issue)));
}

/* ───────────────────────────── the creative rubric ───────────────────────────── */

/** What the picture is, for the rubric: each kind is judged on what it must do. */
export type ReviewKind = "designed" | "native" | "meme" | "sales";

export const RUBRIC_KEYS = [
  "brief",
  "hierarchy",
  "legibility",
  "brand",
  "craft",
  "joke",
  "offer",
] as const;
export type RubricKey = (typeof RUBRIC_KEYS)[number];
export type RubricScores = Partial<Record<RubricKey, number>>;

/** What each dimension means, told to the reviewer (short, so the call stays cheap). */
export const RUBRIC_LINES: Record<RubricKey, string> = {
  brief: "brief: shows the brief's subject, product and message",
  hierarchy: "hierarchy: one focal point and a clear reading order at phone size",
  legibility: "legibility: every word reads at a glance, with contrast and clear space",
  brand: "brand: colours, type and mood fit this brand and its industry",
  craft:
    "craft: looks made by a professional, not generic AI (no plastic skin, random glow, floating objects, purple-blue gradients, sparkles, clutter)",
  joke: "joke: the meme reads in two seconds, the picture supports the punchline, the text sits where this format puts it",
  offer:
    "offer: the offer, who it is for and the action are clear in the first glance, with the action visible",
};

/** The dimensions each kind is judged on, with their weights. */
const WEIGHTS: Record<ReviewKind, Partial<Record<RubricKey, number>>> = {
  designed: { brief: 2, hierarchy: 2, legibility: 1.5, brand: 1.5, craft: 2 },
  native: { brief: 2, legibility: 1, brand: 1, craft: 2 },
  meme: { brief: 1, legibility: 2, craft: 1, joke: 3 },
  sales: { brief: 1.5, hierarchy: 2, legibility: 2, brand: 1, craft: 1.5, offer: 3 },
};

export function rubricFor(kind: ReviewKind): RubricKey[] {
  return RUBRIC_KEYS.filter((key) => WEIGHTS[kind][key] !== undefined);
}

/** Pick the kind from what the piece is (category register, its group, the format). */
export function reviewKindOf(args: {
  category?: { id: string; group: string; register: string } | null;
  type?: string | null;
  goal?: string | null;
}): ReviewKind {
  if (args.category?.id === "meme") return "meme";
  if (args.type === "ad" || args.category?.group === "sell" || args.goal === "offer")
    return "sales";
  if (args.category?.register === "native") return "native";
  return "designed";
}

/** Below this weighted score (0-10) a picture is made once more, with the fixes. */
export const REDO_BELOW = 6.5;

/** The weighted score over the dimensions the reviewer actually scored; null if none. */
export function creativeScore(scores: RubricScores | undefined, kind: ReviewKind): number | null {
  if (!scores) return null;
  let total = 0;
  let weight = 0;
  for (const [key, w] of Object.entries(WEIGHTS[kind]) as [RubricKey, number][]) {
    const value = scores[key];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    total += Math.min(10, Math.max(0, value)) * w;
    weight += w;
  }
  return weight ? Math.round((total / weight) * 10) / 10 : null;
}

export type RedoDecision = {
  redo: boolean;
  reason: "hard" | "score" | null;
  /** What the next render must fix, most important first. */
  fixes: string[];
  score: number | null;
};

/**
 * One redo at most: a hard defect always earns it; a below-bar score earns it
 * only when the reviewer said what to fix (no blind re-roll).
 */
export function creativeRedo(
  review: { issues: readonly string[]; scores?: RubricScores; fixes?: readonly string[] } | null,
  kind: ReviewKind,
  attempts: number,
): RedoDecision {
  const score = creativeScore(review?.scores, kind);
  if (!review || attempts >= 1) return { redo: false, reason: null, fixes: [], score };
  const hard = hardImageDefects(review.issues);
  if (hard.length)
    return {
      redo: true,
      reason: "hard",
      fixes: [...hard, ...(review.fixes ?? [])].slice(0, 5),
      score,
    };
  const fixes = (review.fixes ?? []).filter((f) => f.trim().length >= 4).slice(0, 4);
  if (score !== null && score < REDO_BELOW && fixes.length)
    return { redo: true, reason: "score", fixes, score };
  return { redo: false, reason: null, fixes: [], score };
}

/** After a redo: keep the first picture only when it scored clearly better and had no hard defect. */
export function keepFirstRender(
  first: { score: number | null; hard: boolean } | null | undefined,
  second: { score: number | null; hard: boolean },
): boolean {
  if (!first || first.hard || first.score === null) return false;
  if (second.hard) return true;
  return second.score !== null && first.score - second.score >= 0.5;
}
