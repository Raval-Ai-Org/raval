// series.ts — the shape of per-page daily numbers and how a metric is read
// from them. Pure; shared by eligibility, analysis, placebo and the UI.
import type { ExperimentMetric } from "./constants";

/** One page on one complete day. A page absent on a complete day is all zeros. */
export type MetricRow = {
  clicks: number;
  impressions: number;
  position_weighted: number;
  sessions: number;
  key_events: number;
  revenue: number;
  ai_referral_sessions: number;
};

export const ZERO_ROW: MetricRow = Object.freeze({
  clicks: 0,
  impressions: 0,
  position_weighted: 0,
  sessions: 0,
  key_events: 0,
  revenue: 0,
  ai_referral_sessions: 0,
});

/** path → date (YYYY-MM-DD) → numbers. */
export type PageSeries = Record<string, Record<string, MetricRow>>;

/**
 * A metric as numerator / denominator. Counts have a denominator of one per
 * day (it cancels in every ratio the analysis takes); CTR is clicks over
 * impressions, so it is aggregated as a ratio of sums, never a mean of ratios.
 */
export function metricParts(
  metric: ExperimentMetric,
  row: MetricRow,
): { num: number; den: number } {
  if (metric === "ctr") return { num: row.clicks, den: row.impressions };
  return { num: row[metric], den: 1 };
}

/** The numerator's name, for "extra clicks per month" style copy. */
export function unitOf(metric: ExperimentMetric): string {
  switch (metric) {
    case "ctr":
    case "clicks":
      return "clicks";
    case "impressions":
      return "impressions";
    case "sessions":
      return "sessions";
    case "key_events":
      return "key events";
    case "revenue":
      return "revenue";
    case "ai_referral_sessions":
      return "AI referral sessions";
  }
}

/** The numerator field a metric counts (clicks for CTR). */
export function unitField(metric: ExperimentMetric): keyof MetricRow {
  return metric === "ctr" ? "clicks" : metric;
}

export function rowFor(series: PageSeries, path: string, date: string): MetricRow {
  return series[path]?.[date] ?? ZERO_ROW;
}

/** Sum of a metric's numerator for one page over some dates. */
export function pageTotal(
  series: PageSeries,
  path: string,
  dates: readonly string[],
  field: keyof MetricRow,
): number {
  let total = 0;
  for (const d of dates) total += rowFor(series, path, d)[field];
  return total;
}

/** Inclusive list of ISO dates from `start` to `end`. */
export function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  const stop = new Date(`${end}T00:00:00Z`).getTime();
  while (d.getTime() <= stop) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
