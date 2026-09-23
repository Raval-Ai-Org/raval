// naturalize.ts — decides whether a generated caption still reads like a
// machine wrote it (past what humanizeText's em-dash pass catches) and, if
// so, what must survive a rewrite untouched. Pure and unit-tested; the
// server wrapper that actually calls the model lives in naturalize.server.ts
// and is the only thing that imports this alongside "server-only" code.
//
// This is deliberately a quality *gate*, not a blanket rewrite: most
// generated captions never cross the threshold below and ship unchanged.

/** Phrases and structures that read as generic AI marketing copy. */
const CLICHE_PATTERNS: { re: RegExp; label: string }[] = [
  {
    re: /\bin today'?s (?:fast-paced|digital|ever-evolving|competitive) \w+/i,
    label: "today's-world opener",
  },
  { re: /\bunlock(?:ing)?\b/i, label: "unlock" },
  { re: /\belevate\b/i, label: "elevate" },
  { re: /\bunleash(?:ing)?\b/i, label: "unleash" },
  { re: /\bsupercharge\b/i, label: "supercharge" },
  { re: /\bgame[- ]chang(?:er|ing)\b/i, label: "game-changer" },
  { re: /\bseamless(?:ly)?\b/i, label: "seamless" },
  { re: /\bdive (?:in|into)\b/i, label: "dive into" },
  { re: /\bdelve into\b/i, label: "delve into" },
  { re: /\bit'?s (?:important|worth) (?:to note|noting)\b/i, label: "it's worth noting" },
  { re: /\bwhether you'?re[^.!?]* or\b/i, label: "whether-you're-or" },
  { re: /\btake your \w+ to the next level\b/i, label: "next level" },
  { re: /\blook no further\b/i, label: "look no further" },
  { re: /^\s*(?:furthermore|moreover)\b/im, label: "furthermore/moreover opener" },
  { re: /\bpicture this\b/i, label: "picture this" },
  { re: /\bimagine a world\b/i, label: "imagine a world" },
  { re: /\bnot just \w[^.!?]*,? it'?s\b/i, label: "not just X, it's Y" },
  { re: /\bboost your\b/i, label: "boost your" },
  { re: /\bmaximi[sz]e your\b/i, label: "maximize your" },
  { re: /\bin a world where\b/i, label: "in a world where" },
  { re: /\bat the end of the day\b/i, label: "at the end of the day" },
];

function countEmoji(text: string): number {
  const matches = text.match(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}]/gu);
  return matches?.length ?? 0;
}

export type ClicheReport = { score: number; hits: string[] };

/** Higher = more machine-sounding. Not a probability, just a threshold signal. */
export function aiClicheScore(text: string): ClicheReport {
  const hits: string[] = [];
  for (const { re, label } of CLICHE_PATTERNS) if (re.test(text)) hits.push(label);
  let score = hits.length;
  if (countEmoji(text) > 3) {
    score += 1;
    hits.push("emoji-heavy");
  }
  if ((text.match(/!/g)?.length ?? 0) > 2) {
    score += 1;
    hits.push("exclamation-heavy");
  }
  return { score, hits };
}

/** Below this, a caption ships unchanged — most of them do. */
export const NATURALIZE_THRESHOLD = 2;

export function needsNaturalization(text: string): boolean {
  return !!text.trim() && aiClicheScore(text).score >= NATURALIZE_THRESHOLD;
}

const URL_RE = /https?:\/\/[^\s)]+/gi;
const MENTION_RE = /(?<![\w@])@[\w.]{2,}/g;
const HASHTAG_RE = /#[\p{L}\p{N}_]+/gu;
// Standalone numbers worth preserving verbatim: currency, percentages, plain
// figures with 2+ digits (so a lone "a" or list marker "1." isn't flagged).
const NUMBER_RE = /[$€£]?\d[\d,.]*\d|\b\d\b%?/g;
// Sentence punctuation a URL match can trail into ("...sale, tag" / "...sale.").
const TRAILING_PUNCT_RE = /[,.!?;:'")\]]+$/;

/** Facts a rewrite must not drop or alter: URLs, @mentions, #hashtags, numbers. */
export function extractProtectedTokens(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(URL_RE)) found.add(m[0].replace(TRAILING_PUNCT_RE, ""));
  for (const re of [MENTION_RE, HASHTAG_RE, NUMBER_RE]) {
    for (const m of text.matchAll(re)) found.add(m[0]);
  }
  return [...found];
}

export type PreservationCheck = { ok: boolean; missing: string[] };

/** Every protected token from the original must appear verbatim in the rewrite. */
export function checkPreservation(original: string, rewritten: string): PreservationCheck {
  const missing = extractProtectedTokens(original).filter((token) => !rewritten.includes(token));
  return { ok: missing.length === 0, missing };
}

/**
 * A rewrite is only worth keeping if it actually reduced the cliché score,
 * still says something (isn't empty/degenerate), and didn't balloon in
 * length (a sign the model padded rather than rewrote).
 */
export function isBetterThanOriginal(original: string, rewritten: string): boolean {
  const trimmed = rewritten.trim();
  if (!trimmed || trimmed === original.trim()) return false;
  if (trimmed.length > original.length * 1.5 + 40) return false;
  return aiClicheScore(trimmed).score < aiClicheScore(original).score;
}
