// brains.ts — how far each of the four brains has got during the onboarding
// scan, from what the scan really reported (pure, browser-safe). Nothing is
// timer-driven: a brain only fills when the server moved past its part.
import type { Discoveries } from "@/lib/brand-extract-events";
import type { BrainId } from "@/lib/brain/brain";

export type ScanState = "idle" | "loading" | "ok" | "error";

const clamp = (n: number) => Math.max(0, Math.min(1, n));

/**
 * 0..1 per brain.
 * - Brand follows the whole scan (it is what the scan builds).
 * - Market fills while the web research runs (phase 2) and is full once
 *   any mention or review came back.
 * - Competitors fill when the research found rivals; the tracking itself is
 *   set up after onboarding, so it never reads full before the scan ends.
 * - Audience fills while voice and audience are read (phase 3).
 */
export function brainFill(
  status: ScanState,
  phase: number,
  pct: number,
  d: Discoveries,
): Record<BrainId, number> {
  if (status === "ok") return { brand: 1, audience: 1, competitors: 1, market: 1 };
  if (status === "idle") return { brand: 0, audience: 0, competitors: 0, market: 0 };
  const m = d.market;
  const research = phase > 2 ? 1 : phase === 2 ? 0.5 : 0;
  return {
    brand: clamp(pct / 100),
    market: clamp(
      m && m.mentions + m.reviews + m.about > 0 ? Math.max(research, 0.8) : research * 0.8,
    ),
    competitors: clamp(m && m.competitors > 0 ? 0.85 : research * 0.6),
    audience: clamp(phase > 3 ? 0.9 : phase === 3 ? 0.5 : d.identity ? 0.15 : 0),
  };
}

/** One short line about what was found so far, for the dock. */
export function foundSoFar(d: Discoveries): string | null {
  const bits: string[] = [];
  const colors = d.identity?.colors.length ?? 0;
  if (colors) bits.push(`${Math.min(colors, 6)} colours`);
  const pages = d.pages?.paths.length ?? 0;
  if (pages) bits.push(`${pages} pages`);
  const products = d.products?.products.length ?? 0;
  if (products) bits.push(`${products} ${products === 1 ? "product" : "products"}`);
  const rivals = d.market?.competitors ?? 0;
  if (rivals) bits.push(`${rivals} ${rivals === 1 ? "competitor" : "competitors"}`);
  return bits.length ? bits.join(" · ") : null;
}
