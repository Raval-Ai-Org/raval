// How a picker follows the brand's taste without losing its variety. Each
// picker first applies its own rules (fits the piece, not used lately); this
// then drops what the team asked for less of and, on two seeds out of three,
// keeps only what it loved. The third seed stays open, so loved choices lead
// but never become the only thing Mellox makes.

import type { Lean } from "./contracts";

function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function applyLean<T>(
  candidates: readonly T[],
  lean: Lean | null | undefined,
  seed: string,
  idOf: (item: T) => string,
): T[] {
  if (!lean || (!lean.liked.length && !lean.avoided.length)) return [...candidates];
  const avoided = new Set(lean.avoided);
  const kept = candidates.filter((c) => !avoided.has(idOf(c)));
  const base = kept.length ? kept : [...candidates];
  if (!lean.liked.length) return base;
  const liked = new Set(lean.liked);
  const loved = base.filter((c) => liked.has(idOf(c)));
  return loved.length && hash(`lean:${seed}`) % 3 !== 0 ? loved : base;
}
