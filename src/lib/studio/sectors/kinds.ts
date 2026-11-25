// kinds.ts — which kind of business a brand is (Round 9, ADR-0053). Pure and
// browser-safe: the Studio composer and the server settle video the same way.
// The full playbooks stay on the server (src/server/studio/sectors/).
import { SECTOR_KINDS } from "./kinds.generated";

export type BusinessKind = "product" | "service" | "hybrid" | "venue" | "digital";

export type SectorKindRow = { id: string; kind: BusinessKind; parent: string; match: string[] };

function escape(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const MATCHERS = SECTOR_KINDS.map((row) => ({
  row,
  terms: row.match.map((t) => ({
    re: new RegExp(`(^|[^a-z0-9])${escape(t)}($|[^a-z0-9])`, "i"),
    // A phrase ("game development") says more than one word ("software").
    weight: Math.min(3, t.trim().split(/\s+/).length),
  })),
}));

/**
 * The sector a brand belongs to: its industry line counts three times its
 * description; a single passing mention in the description is not enough.
 * A longer matching phrase counts more than a single word.
 */
export function sectorOf(industry?: string | null, text?: string | null): SectorKindRow | null {
  const line = (industry ?? "").toLowerCase();
  const body = (text ?? "").slice(0, 1500).toLowerCase();
  let best: { row: SectorKindRow; score: number } | null = null;
  for (const { row, terms } of MATCHERS) {
    let score = 0;
    for (const { re, weight } of terms) {
      if (line && re.test(line)) score += 3 * weight;
      if (body && re.test(body)) score += weight;
    }
    if (score >= 2 && (!best || score > best.score)) best = { row, score };
  }
  return best?.row ?? null;
}

/** The kind of business (service, product…), or null when no sector fits. */
export function businessKindOf(
  industry?: string | null,
  text?: string | null,
): BusinessKind | null {
  return sectorOf(industry, text)?.kind ?? null;
}

/** Sells work done by people rather than a thing made (services and venues). */
export function isServiceKind(kind: BusinessKind | null | undefined): boolean {
  return kind === "service" || kind === "venue";
}

/** Has no physical product to photograph: services, venues and digital products. */
export function sellsNoThing(kind: BusinessKind | null | undefined): boolean {
  return kind === "service" || kind === "venue" || kind === "digital";
}
