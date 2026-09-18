// movers.ts — the pages, queries and channels that changed most between two
// periods. Deterministic: sorted by absolute change, ties by name.
import { pctChange } from "./compare";

export type MoverRow = {
  value: string;
  current: number;
  previous: number;
  abs: number;
  pct: number | null;
  /** In the current period only. */
  isNew: boolean;
  /** In the previous period only. */
  isLost: boolean;
};

export type Movers = { risers: MoverRow[]; fallers: MoverRow[] };

export function computeMovers(
  current: ReadonlyMap<string, number>,
  previous: ReadonlyMap<string, number>,
  opts: { minBase: number; minAbs: number; limit?: number },
): Movers {
  const limit = opts.limit ?? 5;
  const keys = new Set([...current.keys(), ...previous.keys()]);
  const rows: MoverRow[] = [];
  for (const value of keys) {
    const cur = current.get(value) ?? 0;
    const prev = previous.get(value) ?? 0;
    const abs = cur - prev;
    if (Math.max(cur, prev) < opts.minBase || Math.abs(abs) < opts.minAbs) continue;
    rows.push({
      value,
      current: cur,
      previous: prev,
      abs,
      pct: pctChange(cur, prev),
      isNew: prev === 0 && cur > 0,
      isLost: cur === 0 && prev > 0,
    });
  }
  const byMagnitude = (a: MoverRow, b: MoverRow) =>
    Math.abs(b.abs) - Math.abs(a.abs) || a.value.localeCompare(b.value);
  return {
    risers: rows
      .filter((r) => r.abs > 0)
      .sort(byMagnitude)
      .slice(0, limit),
    fallers: rows
      .filter((r) => r.abs < 0)
      .sort(byMagnitude)
      .slice(0, limit),
  };
}
