// media-decision.ts — turns one classifier answer into a read the guardrails
// can count. Classifiers are told to name only the rule ids below, but they
// still answer with their own words ("adult_content", "real_person",
// "unable_to_view"), so a read is judged by what it names, not by its bare
// `safe` flag:
//
// - flagged:    it names a prohibited policy (exact id or a known stem).
// - safe:       an explicit safe verdict with no prohibited policy named.
// - ambiguous:  `safe: false` that names no prohibited policy (empty, only
//               descriptive labels, or "could not see the image"). It never
//               blocks on its own; the caller asks independent reviewers.
//
// A refusal therefore always needs a named policy from two reads. A wrong
// "this is a real person" or "I can't open the link" is not a refusal.

/** The rule ids the classifier prompts ask for. Kept short on purpose. */
export const MEDIA_POLICY_IDS = [
  "sexual_content",
  "nudity",
  "ncii",
  "sexualized_deepfake",
  "minor_safety",
  "graphic_violence",
  "hate_symbols",
  "harassment",
  "self_harm",
  "illegal_drugs",
  "weapons_promotion",
  "personal_data",
  "deceptive_impersonation",
  "fabricated_endorsement",
  "unlawful_content",
  "ip_infringement",
] as const;

const POLICY_VIOLATIONS = new Set<string>([
  ...MEDIA_POLICY_IDS,
  "explicit_sexual_content",
  "pornography",
  "sexual_exploitation",
  "minor_sexual_content",
  "child_sexual_abuse",
  "violence",
  "gore",
  "hate",
  "hate_speech",
  "pii",
  "privacy_violation",
  "drugs",
  "weapons",
  "copyright_infringement",
  "prompt_too_large",
]);

// Other spellings of the same prohibited policies. A segment must start with
// one of these (so "nud" matches "nudity" but "gun" never matches "begun").
const VIOLATION_STEMS = [
  "sexual",
  "sexualized",
  "nud",
  "naked",
  "porn",
  "erotic",
  "nsfw",
  "explicit",
  "ncii",
  "deepfake",
  "csam",
  "exploit",
  "violen",
  "gore",
  "gory",
  "hate",
  "extremis",
  "terror",
  "harass",
  "selfharm",
  "suicide",
  "drug",
  "narcotic",
  "weapon",
  "firearm",
  "explosive",
  "pii",
  "privacy",
  "doxx",
  "impersonat",
  "unlawful",
  "illegal",
  "copyright",
  "infring",
  "coercion",
];
// Multi-word policies whose single words are harmless on their own
// ("minor", "child", "self", "personal", "credit" and "card" are not).
const VIOLATION_PHRASES = [
  "self_harm",
  "adult_content",
  "minor_safety",
  "minor_sexual",
  "minors_inappropriate",
  "inappropriate_minor",
  "child_abuse",
  "child_sexual",
  "child_exploitation",
  "child_endangerment",
  "personal_data",
  "personal_info",
  "id_card",
  "identity_document",
  "bank_card",
  "credit_card",
  "fake_endorsement",
  "fabricated_endorsement",
  "animal_cruelty",
];
// A classifier that could not see or judge the image answers with these.
const UNREADABLE_STEMS = [
  "unable",
  "cannot",
  "cant",
  "unavailable",
  "inaccessible",
  "unviewable",
  "unreadable",
  "unverified",
  "unverifiable",
  "unspecified",
  "unknown",
  "unclear",
  "uncertain",
  "missing",
  "blank",
  "corrupt",
  "insufficient",
  "failed",
  "error",
];

// Labels some classifiers add to safe business content.
const CONTENT_LABELS = new Set(["marketing_content", "marketing_creative"]);

export type MediaRead =
  | { kind: "safe" }
  | { kind: "flagged"; categories: string[] }
  | { kind: "ambiguous"; categories: string[] };

function segments(category: string): string[] {
  return category.toLowerCase().split("_").filter(Boolean);
}

export function isPolicyViolation(category: string): boolean {
  const id = category.toLowerCase();
  if (CONTENT_LABELS.has(id)) return false;
  if (POLICY_VIOLATIONS.has(id)) return true;
  if (VIOLATION_PHRASES.some((phrase) => id.includes(phrase))) return true;
  const parts = segments(id);
  return parts.some((part) => VIOLATION_STEMS.some((stem) => part.startsWith(stem)));
}

function isUnreadable(category: string): boolean {
  return segments(category).some((part) => UNREADABLE_STEMS.some((stem) => part.startsWith(stem)));
}

export function readMediaDecision(safe: boolean, categories: string[]): MediaRead {
  const violations = categories.filter(isPolicyViolation);
  if (violations.length) return { kind: "flagged", categories: violations };
  if (safe) return { kind: "safe" };
  // `safe: false` without a prohibited policy: an empty list, a description
  // of the picture, or a classifier that could not open it.
  return {
    kind: "ambiguous",
    categories: categories.filter((category) => isUnreadable(category)),
  };
}

/** Prohibited policies a read names (empty unless it is flagged). */
export function mediaViolationCategories(safe: boolean, categories: string[]): string[] {
  const read = readMediaDecision(safe, categories);
  return read.kind === "flagged" ? read.categories : [];
}

export type MediaVerdict =
  { verdict: "safe" } | { verdict: "flagged"; categories: string[] } | { verdict: "unverified" };

/**
 * Combines one first read with up to two independent reviews (missing reviews
 * are `null`). Two named refusals block, two safe reads clear, anything else
 * is unverified and the caller fails closed without calling it a refusal.
 */
export function combineMediaReads(reads: readonly (MediaRead | null)[]): MediaVerdict {
  const answered = reads.filter((read): read is MediaRead => !!read);
  const flagged = answered.filter(
    (read): read is Extract<MediaRead, { kind: "flagged" }> => read.kind === "flagged",
  );
  const safe = answered.filter((read) => read.kind === "safe");
  if (flagged.length >= 2)
    return {
      verdict: "flagged",
      categories: [...new Set(flagged.flatMap((read) => read.categories))],
    };
  if (safe.length >= 2) return { verdict: "safe" };
  return { verdict: "unverified" };
}
