// signals.ts — the deterministic list of meaningful changes that AI insights
// are allowed to talk about, and its fingerprint. The fingerprint rounds each
// change into coarse buckets, so day-to-day noise produces the same
// fingerprint and the cached insight is reused (no new AI call).
import type { Comparison } from "./compare";
import { formatMetric, METRICS, type MetricKey } from "./metrics";
import type { MoverRow } from "./movers";
import type { DataSource } from "./sources";

export type Signal = {
  /** Stable id, e.g. "metric:gsc.clicks" or "mover:gsc:page:/pricing". */
  id: string;
  source: DataSource;
  kind: "metric" | "mover";
  metric: MetricKey;
  label: string;
  current: number;
  previous: number;
  abs: number;
  pct: number | null;
  direction: "up" | "down";
  favorable: boolean;
  /** Mover signals: which breakdown and which row. */
  dimension?: string;
  value?: string;
  /** Plain-language fact built from the numbers (no model involved). */
  fact: string;
};

export type MoverGroup = {
  source: DataSource;
  metric: MetricKey;
  dimension: string;
  dimensionLabel: string;
  risers: MoverRow[];
  fallers: MoverRow[];
};

const MAX_SIGNALS = 12;

function pctText(pct: number | null): string {
  return pct === null ? "new" : `${pct > 0 ? "+" : ""}${pct}%`;
}

export function buildSignals(input: {
  metrics: Partial<Record<MetricKey, Comparison>>;
  movers?: MoverGroup[];
}): Signal[] {
  const out: Signal[] = [];
  for (const [key, cmp] of Object.entries(input.metrics) as [MetricKey, Comparison][]) {
    if (!cmp || cmp.status !== "ok" || !cmp.significant || cmp.direction === "flat") continue;
    if (cmp.current === null || cmp.previous === null || cmp.abs === null) continue;
    const spec = METRICS[key];
    out.push({
      id: `metric:${key}`,
      source: spec.source,
      kind: "metric",
      metric: key,
      label: spec.label,
      current: cmp.current,
      previous: cmp.previous,
      abs: cmp.abs,
      pct: cmp.pct,
      direction: cmp.direction,
      favorable: cmp.favorable ?? false,
      fact: `${spec.label} (${spec.hint}) went from ${formatMetric(key, cmp.previous)} to ${formatMetric(key, cmp.current)} (${pctText(cmp.pct)}).`,
    });
  }
  for (const group of input.movers ?? []) {
    const spec = METRICS[group.metric];
    for (const row of [...group.risers.slice(0, 3), ...group.fallers.slice(0, 3)]) {
      const up = row.abs > 0;
      out.push({
        id: `mover:${group.source}:${group.dimension}:${row.value}`,
        source: group.source,
        kind: "mover",
        metric: group.metric,
        label: `${group.dimensionLabel}: ${row.value}`,
        current: row.current,
        previous: row.previous,
        abs: row.abs,
        pct: row.pct,
        direction: up ? "up" : "down",
        favorable: up === spec.higherIsBetter,
        dimension: group.dimension,
        value: row.value,
        fact: `${spec.label} for ${group.dimensionLabel.toLowerCase()} "${row.value}" went from ${formatMetric(group.metric, row.previous)} to ${formatMetric(group.metric, row.current)} (${row.isNew ? "new" : row.isLost ? "lost" : pctText(row.pct)}).`,
      });
    }
  }
  // Largest relative moves first; metric-level changes before single rows.
  const weight = (s: Signal) =>
    (s.kind === "metric" ? 1000 : 0) + Math.min(Math.abs(s.pct ?? 100), 999);
  return out
    .sort((a, b) => weight(b) - weight(a) || a.id.localeCompare(b.id))
    .slice(0, MAX_SIGNALS);
}

/** Coarse bucket of a change: sign + magnitude step, so noise doesn't churn it. */
function bucket(s: Signal): string {
  const pct = s.pct === null ? 999 : Math.abs(s.pct);
  const step = pct < 20 ? 1 : pct < 50 ? 2 : pct < 100 ? 3 : 4;
  return `${s.direction === "up" ? "+" : "-"}${step}`;
}

/**
 * Deterministic fingerprint of a signal set (cyrb53, hex). Same meaningful
 * changes → same fingerprint → the cached insight is reused.
 */
export function fingerprintSignals(signals: readonly Signal[]): string {
  const canonical = signals
    .map((s) => `${s.id}|${bucket(s)}`)
    .sort()
    .join("\n");
  return cyrb53(canonical);
}

function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return `v1-${n.toString(16).padStart(14, "0")}`;
}
