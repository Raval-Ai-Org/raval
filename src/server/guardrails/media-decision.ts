// Some classifiers label safe business content instead of returning an empty
// violation list. Accept only the two observed benign labels, and only with an
// explicit safe verdict. Unknown or prohibited categories still block media.
const CONTENT_LABELS = new Set(["marketing_content", "marketing_creative"]);
const POLICY_VIOLATIONS = new Set([
  "sexual_content",
  "explicit_sexual_content",
  "pornography",
  "nudity",
  "ncii",
  "sexual_exploitation",
  "sexualized_deepfake",
  "minor_sexual_content",
  "child_sexual_abuse",
  "graphic_violence",
  "violence",
  "gore",
  "hate",
  "hate_speech",
  "hate_symbols",
  "harassment",
  "self_harm",
  "illegal_drugs",
  "drugs",
  "weapons",
  "weapons_promotion",
  "personal_data",
  "pii",
  "privacy_violation",
  "deceptive_impersonation",
  "fabricated_endorsement",
  "unlawful_content",
  "copyright_infringement",
  "ip_infringement",
  "prompt_too_large",
]);

export function mediaViolationCategories(safe: boolean, categories: string[]): string[] {
  if (!safe)
    return categories.filter((category) => !CONTENT_LABELS.has(category)).length
      ? categories.filter((category) => !CONTENT_LABELS.has(category))
      : ["unspecified_policy_violation"];
  // A classifier sometimes adds descriptive labels despite returning safe=true.
  // Only a recognized policy category can contradict that explicit safe verdict.
  return categories.filter((category) => POLICY_VIOLATIONS.has(category));
}
