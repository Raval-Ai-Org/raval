// Some classifiers label safe business content instead of returning an empty
// violation list. Accept only the two observed benign labels, and only with an
// explicit safe verdict. Unknown or prohibited categories still block media.
const CONTENT_LABELS = new Set(["marketing_content", "marketing_creative"]);

export function mediaViolationCategories(safe: boolean, categories: string[]): string[] {
  return safe ? categories.filter((category) => !CONTENT_LABELS.has(category)) : categories;
}
