// assign.ts — stratified random assignment (ADR-0024 §6).
//
// Pages are sorted by their pre-period primary metric and paired with their
// neighbour; one page of each pair goes to treatment. An odd page out is
// excluded from both arms. If the arms' pre-period totals differ by more than
// BALANCE_TOLERANCE, the draw is repeated with seed + k. The result is a pure
// function of the pages and the seed.
import { BALANCE_TOLERANCE, MAX_ASSIGNMENT_ATTEMPTS } from "./constants";
import { mulberry32 } from "./random";

export type AssignablePage = { path: string; value: number };

export type AssignedPair = { stratum: number; treatment: string; control: string };

export type AssignmentResult = {
  pairs: AssignedPair[];
  excluded: { path: string; reason: string }[];
  /** The stored base seed; the draw that was used is seed + attempts - 1. */
  seed: number;
  attempts: number;
  treatmentTotal: number;
  controlTotal: number;
  /** |ΣT − ΣC| / ΣC. */
  imbalance: number;
  balanced: boolean;
};

/** Deterministic order: highest value first, ties by path. */
function ordered(pages: AssignablePage[]): AssignablePage[] {
  return [...pages].sort((a, b) => b.value - a.value || (a.path < b.path ? -1 : 1));
}

export function imbalanceOf(treatment: number, control: number): number {
  if (control === 0) return treatment === 0 ? 0 : Infinity;
  return Math.abs(treatment - control) / control;
}

/** One draw with a given seed. */
export function drawPairs(pages: AssignablePage[], seed: number) {
  const sorted = ordered(pages);
  const rng = mulberry32(seed);
  const pairs: AssignedPair[] = [];
  let treatmentTotal = 0;
  let controlTotal = 0;
  for (let i = 0; i + 1 < sorted.length; i += 2) {
    const [a, b] = rng() < 0.5 ? [sorted[i], sorted[i + 1]] : [sorted[i + 1], sorted[i]];
    pairs.push({ stratum: i / 2, treatment: a.path, control: b.path });
    treatmentTotal += a.value;
    controlTotal += b.value;
  }
  const excluded =
    sorted.length % 2 === 1
      ? [{ path: sorted[sorted.length - 1].path, reason: "Odd page out of the pairing" }]
      : [];
  return { pairs, excluded, treatmentTotal, controlTotal };
}

export function assignPages(pages: AssignablePage[], seed: number): AssignmentResult {
  const unique = new Map(pages.map((p) => [p.path, p]));
  const list = [...unique.values()];
  let best: (ReturnType<typeof drawPairs> & { attempts: number; imbalance: number }) | null = null;
  for (let k = 0; k < MAX_ASSIGNMENT_ATTEMPTS; k++) {
    const draw = drawPairs(list, seed + k);
    const imbalance = imbalanceOf(draw.treatmentTotal, draw.controlTotal);
    if (!best || imbalance < best.imbalance) best = { ...draw, attempts: k + 1, imbalance };
    if (imbalance <= BALANCE_TOLERANCE) {
      return { ...draw, seed, attempts: k + 1, imbalance, balanced: true };
    }
  }
  const b = best!;
  return {
    pairs: b.pairs,
    excluded: b.excluded,
    seed,
    attempts: b.attempts,
    treatmentTotal: b.treatmentTotal,
    controlTotal: b.controlTotal,
    imbalance: b.imbalance,
    balanced: false,
  };
}

/** Rebuild the exact stored assignment from its seed and attempt count. */
export function replayAssignment(pages: AssignablePage[], seed: number, attempts: number) {
  return drawPairs([...new Map(pages.map((p) => [p.path, p])).values()], seed + attempts - 1);
}
