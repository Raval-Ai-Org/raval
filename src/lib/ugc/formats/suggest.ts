// Which formats suit a brand and a product. Pure string work, no model call:
// it drives Auto and the "For your brand" badges. It only orders, never refuses.

import { UGC_FORMATS } from "./formats";
import type { UgcFormat } from "./types";

export type FormatProfile = {
  industry?: string | null;
  audience?: string | null;
  /** The product's name, category, description and use cases. */
  product?: readonly (string | null | undefined)[];
  objective?: string | null;
};

/** Groups that tend to work best for each objective. */
const OBJECTIVE_GROUPS: Record<string, readonly UgcFormat["group"][]> = {
  awareness: ["interview", "skit", "talk"],
  engagement: ["interview", "skit", "talk"],
  sales: ["review", "talk", "lifestyle"],
  conversion: ["review", "talk", "interview"],
  app_install: ["skit", "review", "talk"],
  lead_gen: ["interview", "talk", "review"],
};

/** Formats that work for almost anyone, used when nothing more specific matches. */
const SAFE_DEFAULTS = ["subway-interview", "car-confessional", "honest-review", "pov-skit"];

/**
 * Format ids best first. The first `limit` come from different groups where
 * possible, so Auto's three concepts never all look alike.
 */
export function suggestFormats(profile: FormatProfile, limit = 3): string[] {
  const text = [profile.industry, profile.audience, ...(profile.product ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const groups = OBJECTIVE_GROUPS[profile.objective ?? ""] ?? OBJECTIVE_GROUPS.awareness;
  const scored = UGC_FORMATS.map((f, index) => {
    let score = 0;
    for (const tag of f.tags) {
      if (tag === "any") score += 1;
      else if (text && new RegExp(`\\b${tag.replace(/\s+/g, "\\s+")}s?\\b`, "i").test(text))
        score += 3;
    }
    const g = groups.indexOf(f.group);
    if (g >= 0) score += 3 - g;
    if (SAFE_DEFAULTS.includes(f.id)) score += 1;
    return { f, score, index };
  }).sort((a, b) => b.score - a.score || a.index - b.index);

  const out: string[] = [];
  const usedGroups = new Set<string>();
  for (const { f } of scored) {
    if (out.length >= limit) break;
    if (usedGroups.has(f.group)) continue;
    out.push(f.id);
    usedGroups.add(f.group);
  }
  for (const { f } of scored) {
    if (out.length >= limit) break;
    if (!out.includes(f.id)) out.push(f.id);
  }
  return out;
}

/** The brand's favourite formats first (known ids only), then the suggestions, at most `limit`. */
export function favouritesFirst(
  favourites: readonly string[] | undefined,
  suggested: readonly string[],
  limit = 6,
): string[] {
  const known = new Set(UGC_FORMATS.map((f) => f.id as string));
  const fav = (favourites ?? []).filter((id) => known.has(id));
  return [...new Set([...fav, ...suggested])].slice(0, limit);
}
