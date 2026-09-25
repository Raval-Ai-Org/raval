// random.ts — seeded randomness for the Proof Engine. Every random choice an
// experiment makes (assignment, bootstrap, placebo draws) comes from here, so
// a stored seed reproduces it exactly.

/** mulberry32: small, fast, deterministic 32-bit PRNG. Returns [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A non-negative 31-bit seed (fits Postgres bigint and JSON exactly). */
export function newSeed(random: () => number = Math.random): number {
  return Math.floor(random() * 0x7fffffff);
}

/** Integer in [0, n). */
export function randInt(rng: () => number, n: number): number {
  return Math.min(n - 1, Math.floor(rng() * n));
}
