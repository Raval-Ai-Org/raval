// The words on a product hero poster, from the product's stored facts only
// (ADR-0035, ADR-0040). Pure.
//
// A benefit is the brand's own sentence, cut to its first clause so it fits
// a poster line. Nothing is rewritten by a model and nothing is added: a
// product with fewer than three short benefits simply doesn't get a benefit
// column.

const MAX_BENEFIT_WORDS = 8;

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

function firstClause(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (words(flat) <= MAX_BENEFIT_WORDS) return flat.replace(/[.;:!]+$/, "");
  const cut = flat.split(/\s*(?:[.;:!(]|\s[—–-]\s|,\s)\s*/)[0] ?? "";
  return cut.trim();
}

/** Up to five short benefit lines, in the brand's own words. */
export function benefitLines(benefits: readonly string[], max = 5): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const benefit of benefits) {
    const line = firstClause(benefit);
    const n = words(line);
    if (n < 2 || n > MAX_BENEFIT_WORDS) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line[0].toUpperCase() + line.slice(1));
    if (out.length >= max) break;
  }
  return out;
}

// The product's own formula, the first that the name or category names,
// then the description. Only physical textures a camera can shoot.
const TEXTURES: readonly [RegExp, string][] = [
  [/\bgel\b/i, "gel"],
  [/\b(?:cream|moisturi[sz]er|creme)\b/i, "cream"],
  [/\b(?:foam|foaming|lather|mousse)\b/i, "foam"],
  [/\bserum\b/i, "serum"],
  [/\b(?:balm|butter)\b/i, "balm"],
  [/\blotion\b/i, "lotion"],
  [/\b(?:face|facial|body|hair|cleansing) oil\b|\boil for\b/i, "oil"],
  [/\b(?:juice|smoothie)\b/i, "juice"],
  [/\b(?:coffee|espresso|latte|cold brew)\b/i, "coffee"],
  [/\bchocolate\b/i, "melted chocolate"],
  [/\bhoney\b/i, "honey"],
  [/\b(?:syrup|sauce)\b/i, "sauce"],
  [/\b(?:soda|sparkling|fizzy)\b/i, "fizz and bubbles"],
  [/\b(?:milk|yogh?urt)\b/i, "milk"],
  [/\b(?:shampoo|body wash|shower gel)\b/i, "lather"],
];

export function textureOf(product: {
  name: string;
  category?: string | null;
  description?: string | null;
}): string | null {
  for (const text of [`${product.name} ${product.category ?? ""}`, product.description ?? ""])
    for (const [re, texture] of TEXTURES) if (re.test(text)) return texture;
  return null;
}

/** A support line: the description's first sentence, when it is short. */
export function supportLine(description: string | null | undefined, maxWords = 22): string | null {
  const first =
    (description ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .split(/(?<=[.!?])\s/)[0] ?? "";
  return first && words(first) <= maxWords ? first : null;
}

const INGREDIENT_LEAD =
  /\b(?:made with|made from|infused with|enriched with|packed with|powered by|contains|containing|blended with|formulated with)\s+([^.;:!?()]+)/gi;
const NOT_INGREDIENT =
  /\b(?:love|care|skin|you|your|every|each|daily|use|results?|ingredients?|formula|benefits?|texture|feel|finish|ease|confidence|style|purpose)\b/i;

/**
 * Up to three ingredients the product's own description names ("made with
 * green tea and aloe"), so a poster can show them. Nothing is guessed.
 */
export function ingredientsOf(description: string | null | undefined): string[] {
  const out: string[] = [];
  for (const match of (description ?? "").matchAll(INGREDIENT_LEAD)) {
    for (const raw of match[1].split(/\s*(?:,|&|\band\b|\bplus\b)\s*/i)) {
      const item = raw.replace(/^(?:a|an|the|real|pure|fresh|natural|organic)\s+/i, "").trim();
      const n = words(item);
      if (!item || n > 3 || /\d|%/.test(item) || NOT_INGREDIENT.test(item)) continue;
      const lower = item.toLowerCase();
      if (!out.includes(lower)) out.push(lower);
      if (out.length >= 3) return out;
    }
  }
  return out;
}
