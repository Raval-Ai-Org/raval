// metrics.ts — the metric catalogue: source, label, format, direction and the
// thresholds that decide whether a change is "meaningful". Pure data; the
// comparison maths lives in compare.ts.
import type { DataSource } from "./sources";

export type MetricFormat = "count" | "percent" | "duration" | "position" | "score" | "decimal";

export type MetricSpec = {
  source: DataSource;
  label: string;
  /** Short explanation in plain words (tooltips). */
  hint: string;
  format: MetricFormat;
  /** Search position: lower is better. */
  higherIsBetter: boolean;
  /**
   * A change is significant only when all apply:
   *  - the larger of the two values is at least `minBase` (count metrics), or
   *    the supplied volume is at least `minVolume` (rate metrics);
   *  - |relative change| ≥ minPct (count metrics), or |absolute change| ≥ minAbs.
   */
  significance: { minPct?: number; minAbs?: number; minBase?: number; minVolume?: number };
};

export const METRICS = {
  // Google Analytics 4 — visits to the website.
  "ga4.sessions": {
    source: "ga4",
    label: "Visits",
    hint: "GA4 sessions",
    format: "count",
    higherIsBetter: true,
    significance: { minPct: 10, minBase: 50 },
  },
  "ga4.users": {
    source: "ga4",
    label: "Visitors",
    hint: "GA4 total users in the period",
    format: "count",
    higherIsBetter: true,
    significance: { minPct: 10, minBase: 50 },
  },
  "ga4.newUsers": {
    source: "ga4",
    label: "New visitors",
    hint: "GA4 new users",
    format: "count",
    higherIsBetter: true,
    significance: { minPct: 15, minBase: 30 },
  },
  "ga4.engagementRate": {
    source: "ga4",
    label: "Engaged visits",
    hint: "Share of GA4 sessions that were engaged",
    format: "percent",
    higherIsBetter: true,
    significance: { minAbs: 0.05, minVolume: 100 },
  },
  "ga4.engagedSessions": {
    source: "ga4",
    label: "Engaged sessions",
    hint: "GA4 sessions that met Google's engagement criteria",
    format: "count",
    higherIsBetter: true,
    significance: { minPct: 10, minBase: 50 },
  },
  "ga4.pageViews": {
    source: "ga4",
    label: "Page views",
    hint: "GA4 views",
    format: "count",
    higherIsBetter: true,
    significance: { minPct: 10, minBase: 100 },
  },
  "ga4.keyEvents": {
    source: "ga4",
    label: "Conversions",
    hint: "GA4 key events (conversions)",
    format: "count",
    higherIsBetter: true,
    significance: { minPct: 15, minBase: 10 },
  },
  "ga4.avgSessionDuration": {
    source: "ga4",
    label: "Avg. visit length",
    hint: "GA4 average session duration",
    format: "duration",
    higherIsBetter: true,
    significance: { minPct: 15, minVolume: 100 },
  },
  // Google Search Console — Google Search results.
  "gsc.clicks": {
    source: "gsc",
    label: "Google clicks",
    hint: "Clicks from Google Search (Search Console)",
    format: "count",
    higherIsBetter: true,
    significance: { minPct: 10, minBase: 30 },
  },
  "gsc.impressions": {
    source: "gsc",
    label: "Times shown",
    hint: "Impressions in Google Search (Search Console)",
    format: "count",
    higherIsBetter: true,
    significance: { minPct: 10, minBase: 300 },
  },
  "gsc.ctr": {
    source: "gsc",
    label: "Click rate",
    hint: "Clicks ÷ impressions (Search Console)",
    format: "percent",
    higherIsBetter: true,
    significance: { minAbs: 0.005, minVolume: 500 },
  },
  "gsc.position": {
    source: "gsc",
    label: "Avg. position",
    hint: "Average ranking in Google Search, weighted by impressions. Lower is better.",
    format: "position",
    higherIsBetter: false,
    significance: { minAbs: 1, minVolume: 500 },
  },
  // Mellox AI Visibility scan — a readiness score, not traffic.
  "geo.score": {
    source: "geo",
    label: "AI Visibility score",
    hint: "Mellox scan score, 0–100",
    format: "score",
    higherIsBetter: true,
    significance: { minAbs: 5 },
  },
  // Mellox internal activity.
  "mellox.created": {
    source: "mellox",
    label: "Content created",
    hint: "Posts and drafts made in Mellox",
    format: "count",
    higherIsBetter: true,
    significance: { minPct: 25, minBase: 5 },
  },
  "mellox.published": {
    source: "mellox",
    label: "Published",
    hint: "Content published from Mellox",
    format: "count",
    higherIsBetter: true,
    significance: { minPct: 25, minBase: 3 },
  },
  "mellox.scheduled": {
    source: "mellox",
    label: "Scheduled",
    hint: "Content waiting to go out",
    format: "count",
    higherIsBetter: true,
    significance: { minPct: 50, minBase: 5 },
  },
  "mellox.approvalsPending": {
    source: "mellox",
    label: "Waiting for approval",
    hint: "Approvals opened in the period that are still waiting",
    format: "count",
    higherIsBetter: false,
    significance: { minPct: 50, minBase: 5 },
  },
} as const satisfies Record<string, MetricSpec>;

export type MetricKey = keyof typeof METRICS;

export const METRIC_KEYS = Object.keys(METRICS) as MetricKey[];

export function metricSpec(key: MetricKey): MetricSpec {
  return METRICS[key];
}

export function isMetricKey(value: string): value is MetricKey {
  return Object.prototype.hasOwnProperty.call(METRICS, value);
}

/** Human formatting shared by the UI, chat context and insight prompts. */
export function formatMetric(key: MetricKey, value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const spec: MetricSpec = METRICS[key];
  switch (spec.format) {
    case "percent":
      return `${(value * 100).toFixed(value * 100 >= 10 ? 0 : 1)}%`;
    case "duration": {
      const s = Math.round(value);
      const m = Math.floor(s / 60);
      return m > 0 ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
    }
    case "position":
      return value.toFixed(1);
    case "score":
      return `${Math.round(value)}/100`;
    case "decimal":
      return value.toFixed(2);
    default:
      return formatCount(value);
  }
}

export function formatCount(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  if (abs >= 10_000) return `${(value / 1_000).toFixed(abs >= 100_000 ? 0 : 1)}k`;
  return Math.round(value).toLocaleString("en-US");
}
