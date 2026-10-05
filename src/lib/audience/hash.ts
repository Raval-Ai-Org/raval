// A small stable hash for cache keys (pure, same in the browser and on the
// server). Not for security: it only says "this is the same text as before".

function fnv(text: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

const SEEDS = [2166136261, 3339675911, 1013904223, 2654435761];

/** 32 hex characters. */
export function stableHash(text: string): string {
  return SEEDS.map((seed) => fnv(text, seed).toString(16).padStart(8, "0")).join("");
}

/** Whitespace and case differences are not a different piece of content. */
export function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** A number in [0, 1) from a string, for seeded choices. */
export function seededUnit(seed: string): number {
  return fnv(seed, SEEDS[0]) / 4294967296;
}
