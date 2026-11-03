// performance.ts — lab and real-user speed for AI Visibility, the pure half.
//
// Lab: Lighthouse runs (through Google's PageSpeed Insights API) on a few
// pages chosen the way Unlighthouse samples a site (MIT, (c) Harlan Wilton):
// pages that share a route template — /blog/:slug — behave alike, so one per
// template is measured instead of every page. Field: Chrome UX Report p75s
// for the origin, plus its weekly history, which is what lets Mellox show
// whether a fix made the site faster for real people.
//
// Thresholds are Google's published Core Web Vitals boundaries.

import type { FieldHistory, FieldMetric, FieldVitals, LabRun, VitalRating } from "./types";

export type VitalId = "lcp" | "inp" | "cls" | "fcp" | "ttfb";

/** [good up to, needs improvement up to] — ms, except CLS (unitless). */
export const VITAL_THRESHOLDS: Record<VitalId, [number, number]> = {
  lcp: [2500, 4000],
  inp: [200, 500],
  cls: [0.1, 0.25],
  fcp: [1800, 3000],
  ttfb: [800, 1800],
};

export function vitalRating(id: VitalId, value: number): VitalRating {
  const [good, ni] = VITAL_THRESHOLDS[id];
  return value <= good ? "good" : value <= ni ? "needs_improvement" : "poor";
}

/* ───────────────────────── route sampling ───────────────────────── */

const DYNAMIC_SEGMENT =
  /^(\d+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,}|[a-z0-9]+(?:-[a-z0-9]+){2,})$/i;

/**
 * The route template a path belongs to: ids and long slugs become parameters,
 * and the last segment of a nested path is a slug (siblings share a template).
 */
export function routeGroup(url: string): string {
  let path = "/";
  try {
    path = new URL(url).pathname;
  } catch {
    return "/";
  }
  const segments = path.split("/").filter(Boolean);
  if (!segments.length) return "/";
  const mapped = segments.map((s, i) => {
    if (/^\d+$/.test(s)) return ":id";
    if (i === segments.length - 1 && segments.length > 1) return ":slug";
    return DYNAMIC_SEGMENT.test(s) && i > 0 ? ":slug" : s.toLowerCase();
  });
  return `/${mapped.join("/")}`;
}

/**
 * Pick at most `max` pages to measure: the homepage first, then one page per
 * route template in the order given (callers pass the most important first).
 */
export function sampleLabPages(urls: string[], max: number): { url: string; group: string }[] {
  const out: { url: string; group: string }[] = [];
  const seen = new Set<string>();
  for (const url of urls) {
    if (out.length >= max) break;
    const group = routeGroup(url);
    if (seen.has(group)) continue;
    seen.add(group);
    out.push({ url, group });
  }
  return out;
}

/* ───────────────────────── Chrome UX Report ───────────────────────── */

const CRUX_METRICS: Record<VitalId, string> = {
  lcp: "largest_contentful_paint",
  inp: "interaction_to_next_paint",
  cls: "cumulative_layout_shift",
  fcp: "first_contentful_paint",
  ttfb: "experimental_time_to_first_byte",
};

type CruxDate = { year: number; month: number; day: number };
const isoDate = (d: CruxDate | undefined): string | null =>
  d ? `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}` : null;

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number.parseFloat(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

/** A `records:queryRecord` response → p75 per vital. null when the record has no usable data. */
export function parseCruxRecord(json: unknown, scope: FieldVitals["scope"]): FieldVitals | null {
  const record = (json as { record?: Record<string, unknown> } | null)?.record;
  if (!record) return null;
  const metrics = (record.metrics ?? {}) as Record<string, { percentiles?: { p75?: unknown } }>;
  const key = (record.key ?? {}) as { origin?: string; url?: string };
  const metric = (id: VitalId): FieldMetric | null => {
    const p75 = num(metrics[CRUX_METRICS[id]]?.percentiles?.p75);
    return p75 === null ? null : { p75, rating: vitalRating(id, p75) };
  };
  const out: FieldVitals = {
    scope,
    key: key.origin ?? key.url ?? "",
    lcp: metric("lcp"),
    inp: metric("inp"),
    cls: metric("cls"),
    fcp: metric("fcp"),
    ttfb: metric("ttfb"),
    periodEnd: isoDate((record.collectionPeriod as { lastDate?: CruxDate } | undefined)?.lastDate),
  };
  return out.lcp || out.inp || out.cls ? out : null;
}

/** A `records:queryHistoryRecord` response → weekly p75 series, oldest first. */
export function parseCruxHistory(json: unknown): FieldHistory | null {
  const record = (json as { record?: Record<string, unknown> } | null)?.record;
  if (!record) return null;
  const periods = (record.collectionPeriods ?? []) as { lastDate?: CruxDate }[];
  const metrics = (record.metrics ?? {}) as Record<
    string,
    { percentilesTimeseries?: { p75s?: unknown[] } }
  >;
  const series = (id: VitalId) => {
    const values = metrics[CRUX_METRICS[id]]?.percentilesTimeseries?.p75s ?? [];
    return periods.map((_, i) => num(values[i]));
  };
  const dates = periods.map((p) => isoDate(p.lastDate) ?? "");
  const out: FieldHistory = { dates, lcp: series("lcp"), inp: series("inp"), cls: series("cls") };
  const any = (xs: (number | null)[]) => xs.some((x) => x !== null);
  return dates.length && (any(out.lcp) || any(out.inp) || any(out.cls)) ? out : null;
}

/* ───────────────────────── PageSpeed Insights (Lighthouse) ───────────────────────── */

type LhAudit = {
  title?: string;
  score?: number | null;
  scoreDisplayMode?: string;
  numericValue?: number;
  details?: { type?: string; overallSavingsMs?: number };
};
type LhCategory = { score?: number | null; auditRefs?: { id: string; weight?: number }[] };

const MAX_OPPORTUNITIES = 6;
const MAX_FAILED_AUDITS = 8;

/** A `runPagespeed` response → the parts Mellox keeps (no screenshots, no full report). */
export function parsePsi(json: unknown, url: string, group: string): LabRun {
  const lh = (json as { lighthouseResult?: Record<string, unknown> } | null)?.lighthouseResult;
  if (!lh) return { url, group, ok: false, error: "No Lighthouse result" };
  const categories = (lh.categories ?? {}) as Record<string, LhCategory>;
  const audits = (lh.audits ?? {}) as Record<string, LhAudit>;
  const score = (id: string) => {
    const s = categories[id]?.score;
    return typeof s === "number" ? Math.round(s * 100) : null;
  };
  const value = (id: string) => num(audits[id]?.numericValue);
  const round = (n: number | null, d = 0) =>
    n === null ? null : Math.round(n * 10 ** d) / 10 ** d;

  const opportunities = Object.entries(audits)
    .filter(([, a]) => a.details?.type === "opportunity" && (a.score ?? 1) < 0.9)
    .map(([id, a]) => ({
      id,
      title: (a.title ?? id).slice(0, 120),
      savingsMs: Math.round(a.details?.overallSavingsMs ?? 0),
    }))
    .filter((o) => o.savingsMs >= 100)
    .sort((a, b) => b.savingsMs - a.savingsMs)
    .slice(0, MAX_OPPORTUNITIES);

  const failedAudits: { id: string; title: string; category: string }[] = [];
  for (const cat of ["seo", "accessibility", "best-practices"]) {
    for (const ref of categories[cat]?.auditRefs ?? []) {
      const a = audits[ref.id];
      if (
        !a ||
        !ref.weight ||
        a.scoreDisplayMode === "notApplicable" ||
        a.scoreDisplayMode === "manual"
      )
        continue;
      if (typeof a.score === "number" && a.score < 1 && failedAudits.length < MAX_FAILED_AUDITS) {
        failedAudits.push({ id: ref.id, title: (a.title ?? ref.id).slice(0, 120), category: cat });
      }
    }
  }

  return {
    url,
    group,
    ok: true,
    scores: {
      performance: score("performance"),
      accessibility: score("accessibility"),
      bestPractices: score("best-practices"),
      seo: score("seo"),
    },
    metrics: {
      lcpMs: round(value("largest-contentful-paint")),
      cls: round(value("cumulative-layout-shift"), 3),
      tbtMs: round(value("total-blocking-time")),
      fcpMs: round(value("first-contentful-paint")),
      speedIndexMs: round(value("speed-index")),
      ttfbMs: round(value("server-response-time")),
    },
    opportunities,
    failedAudits,
  };
}

/* ───────────────────────── change over time ───────────────────────── */

export type FieldChange = {
  metric: "lcp" | "inp" | "cls";
  before: number;
  after: number;
  /** Negative is faster / steadier. */
  change: number;
  improved: boolean;
};

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Real-user p75 before a date against the latest weeks after it. CrUX periods
 * are rolling 28-day windows, so the "after" side only counts periods that
 * started after the date (end ≥ date + 28 days). Needs `minPoints` per side.
 */
export function fieldChangeSince(
  history: FieldHistory,
  sinceIso: string,
  minPoints = 2,
): FieldChange[] {
  const since = Date.parse(sinceIso);
  if (Number.isNaN(since)) return [];
  const settled = since + 28 * 24 * 3600 * 1000;
  const out: FieldChange[] = [];
  for (const metric of ["lcp", "inp", "cls"] as const) {
    const before: number[] = [];
    const after: number[] = [];
    history.dates.forEach((d, i) => {
      const v = history[metric][i];
      const at = Date.parse(d);
      if (v === null || Number.isNaN(at)) return;
      if (at < since) before.push(v);
      else if (at >= settled) after.push(v);
    });
    if (before.length < minPoints || after.length < minPoints) continue;
    const b = median(before.slice(-4));
    const a = median(after.slice(-4));
    const change = b ? (a - b) / b : 0;
    // Under 5% either way is noise in a 28-day p75.
    if (Math.abs(change) < 0.05) continue;
    out.push({
      metric,
      before: b,
      after: a,
      change: Math.round(change * 1000) / 1000,
      improved: a < b,
    });
  }
  return out;
}

/** Plain-words value for a vital: "2.4 s", "180 ms", "0.08". */
export function formatVital(id: VitalId, value: number): string {
  if (id === "cls") return value.toFixed(2);
  return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`;
}

export function worstRating(ratings: (VitalRating | undefined | null)[]): VitalRating | null {
  const present = ratings.filter((r): r is VitalRating => !!r);
  if (!present.length) return null;
  return present.includes("poor")
    ? "poor"
    : present.includes("needs_improvement")
      ? "needs_improvement"
      : "good";
}

export type LabSummary = { pages: number; ok: number; medianPerformance: number | null };

export function summarizeLab(runs: LabRun[]): LabSummary {
  const ok = runs.filter((r) => r.ok && r.scores?.performance != null);
  return {
    pages: runs.length,
    ok: ok.length,
    medianPerformance: ok.length ? Math.round(median(ok.map((r) => r.scores!.performance!))) : null,
  };
}
