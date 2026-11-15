// copy-qa.ts — the free copy review every Studio piece and every written
// brief passes before anything is drawn (pure, no model call). It catches the
// words that make a post read as generic AI copy and on-picture text too long
// to read on a phone. A miss earns one more take with the reason; it never
// fails a piece: after the one retry the draft is kept as it is.
import type { StudioJobOutput } from "./jobs";

/** Words and openings that make copy read like generic AI marketing. */
export const GENERIC_PHRASES = [
  "elevate",
  "unlock",
  "game-changer",
  "game changer",
  "seamless",
  "in today's",
  "fast-paced",
  "look no further",
  "take it to the next level",
  "revolutionize",
  "revolutionise",
  "unleash",
  "delve",
  "embark",
  "tapestry",
  "synergy",
  "cutting-edge",
  "world-class",
  "one-stop",
  "are you looking for",
  "look no more",
  "we've got you covered",
  "say goodbye to",
] as const;

/** The generic phrases in a piece of text, lower-cased, at most four. */
export function genericPhrases(text: string): string[] {
  const lower = (text ?? "").toLowerCase().replace(/[’]/g, "'");
  return GENERIC_PHRASES.filter((p) => lower.includes(p)).slice(0, 4);
}

const words = (s: string | undefined) => (s ?? "").trim().split(/\s+/).filter(Boolean).length;

/** Most words a picture's main line may have, readable at a glance. */
export const ON_PICTURE_MAX_WORDS = 12;

/**
 * What a finished draft's copy gets wrong, as one sentence the writer can fix,
 * or null. Captions, slides, Story frames, ads and on-picture text.
 */
export function copyIssue(
  output: StudioJobOutput,
  /** The person's own words: a phrase they wrote themselves is theirs to keep. */
  theirs = "",
): string | null {
  const own = genericPhrases(theirs);
  const texts = [
    output.onImageText,
    ...(output.onImageLines ?? []),
    ...(output.variants ?? []).map((v) => v.body),
    ...(output.slides ?? []).flatMap((s) => [s.heading, s.body]),
    ...(output.ads ?? []).flatMap((a) => [a.primaryText, a.headline, a.description]),
  ].filter((t): t is string => typeof t === "string" && t.length > 0);
  const found = [...new Set(texts.flatMap(genericPhrases))].filter((p) => !own.includes(p));
  if (found.length)
    return `The copy reads as generic AI marketing (${found.join(", ")}). Say the brand's real, specific point in plain words instead.`;
  if (words(output.onImageText) > ON_PICTURE_MAX_WORDS)
    return `The words on the picture are too long to read on a phone (${words(output.onImageText)} words). Keep the main line to ${ON_PICTURE_MAX_WORDS} words or fewer.`;
  return null;
}
