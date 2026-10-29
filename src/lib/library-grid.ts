// The Library's masonry: every tile keeps the post's true shape, so nothing is
// cropped. Pure and browser-safe.

/** "4:5" → 0.8 (width ÷ height). Null for anything that isn't a ratio. */
export function parseRatio(value: unknown): number | null {
  if (typeof value === "number") return value > 0.2 && value < 5 ? value : null;
  if (typeof value !== "string") return null;
  const m = value.trim().match(/^(\d+(?:\.\d+)?)\s*[:x×/]\s*(\d+(?:\.\d+)?)$/i);
  if (!m) return null;
  const r = Number(m[1]) / Number(m[2]);
  return Number.isFinite(r) && r > 0.2 && r < 5 ? r : null;
}

/** How many columns fit a container this wide. */
export function columnsFor(width: number): number {
  if (width < 560) return 2;
  if (width < 880) return 3;
  if (width < 1180) return 4;
  return 5;
}

/**
 * Items into columns, each into the shortest one so far. Reading left to
 * right, top to bottom keeps the original order (newest first).
 */
export function masonry<T>(
  items: readonly T[],
  columns: number,
  ratioOf: (item: T) => number,
): T[][] {
  const n = Math.max(1, Math.floor(columns));
  const cols: T[][] = Array.from({ length: n }, () => []);
  const heights = new Array<number>(n).fill(0);
  for (const item of items) {
    let best = 0;
    for (let i = 1; i < n; i++) if (heights[i] < heights[best] - 1e-6) best = i;
    cols[best].push(item);
    const r = ratioOf(item);
    heights[best] += 1 / (r > 0 ? r : 1);
  }
  return cols;
}

/** Made after the last time this browser opened the Library (or today, on a first visit). */
export function isNewSince(
  createdAt: string | null | undefined,
  lastSeen: string | null,
  now = Date.now(),
): boolean {
  if (!createdAt) return false;
  const t = Date.parse(createdAt);
  if (!Number.isFinite(t)) return false;
  const since = lastSeen ? Date.parse(lastSeen) : now - 24 * 3600_000;
  return t > (Number.isFinite(since) ? since : now - 24 * 3600_000);
}
