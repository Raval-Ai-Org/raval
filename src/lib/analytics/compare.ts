// compare.ts — deterministic period-over-period comparison and the exact
// aggregation rules for ratio metrics. Pure and fully unit-tested: the same
// inputs always produce the same deltas, significance and direction, and the
// AI insight layer only ever narrates these results.
import { METRICS, type MetricKey } from "./metrics";

export type ComparisonStatus = "ok" | "insufficient_history" | "no_data";

export type Comparison = {
  current: number | null;
  previous: number | null;
  /** current − previous. */
  abs: number | null;
  /** Relative change in percent, 1 decimal. Null when previous is 0 or missing. */
  pct: number | null;
  direction: "up" | "down" | "flat";
  /** Whether the change is good news for this metric. Null when flat or unknown. */
  favorable: boolean | null;
  /** Clears the metric's volume and size thresholds (metrics.ts). */
  significant: boolean;
  status: ComparisonStatus;
};

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Relative change in percent, or null when there is no base to compare with. */
export function pctChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return round1(((current - previous) / Math.abs(previous)) * 100);
}

export function compareMetric(
  key: MetricKey,
  current: number | null | undefined,
  previous: number | null | undefined,
  opts: {
    /** Whether the stored history fully covers the previous window. */
    previousCovered?: boolean;
    /** Volume behind a ratio metric (sessions for GA4 rates, impressions for CTR/position). */
    volume?: number;
  } = {},
): Comparison {
  const spec = METRICS[key];
  const cur = current ?? null;
  if (cur === null || !Number.isFinite(cur)) {
    return empty(null, null, "no_data");
  }
  if (opts.previousCovered === false) {
    return empty(cur, null, "insufficient_history");
  }
  const prev = previous ?? null;
  if (prev === null || !Number.isFinite(prev)) return empty(cur, null, "insufficient_history");

  const abs = cur - prev;
  const pct = pctChange(cur, prev);
  const isRate = spec.format !== "count";
  const flat = isRate ? Math.abs(abs) < 1e-9 : abs === 0 || (pct !== null && Math.abs(pct) < 0.5);
  const direction: Comparison["direction"] = flat ? "flat" : abs > 0 ? "up" : "down";
  const favorable = direction === "flat" ? null : (direction === "up") === spec.higherIsBetter;

  const sig = spec.significance as {
    minPct?: number;
    minAbs?: number;
    minBase?: number;
    minVolume?: number;
  };
  let significant = direction !== "flat";
  if (
    significant &&
    sig.minBase !== undefined &&
    Math.max(Math.abs(cur), Math.abs(prev)) < sig.minBase
  )
    significant = false;
  if (significant && sig.minVolume !== undefined && (opts.volume ?? 0) < sig.minVolume)
    significant = false;
  if (significant && sig.minAbs !== undefined && Math.abs(abs) < sig.minAbs) significant = false;
  if (significant && sig.minPct !== undefined) {
    // A metric appearing from zero is significant once it clears its base.
    if (pct !== null && Math.abs(pct) < sig.minPct) significant = false;
  }

  return {
    current: cur,
    previous: prev,
    abs,
    pct,
    direction,
    favorable,
    significant,
    status: "ok",
  };
}

function empty(
  current: number | null,
  previous: number | null,
  status: ComparisonStatus,
): Comparison {
  return {
    current,
    previous,
    abs: null,
    pct: null,
    direction: "flat",
    favorable: null,
    significant: false,
    status,
  };
}

// ── Exact aggregation for ratio metrics ─────────────────────────────────────

export type GscTotals = {
  clicks: number;
  impressions: number;
  /** clicks ÷ impressions — recomputed from totals, never averaged. */
  ctr: number | null;
  /** Σ(position × impressions) ÷ Σimpressions. */
  position: number | null;
};

export function gscTotals(
  rows: ReadonlyArray<{ clicks: number; impressions: number; position_weighted: number }>,
): GscTotals {
  let clicks = 0;
  let impressions = 0;
  let weighted = 0;
  for (const r of rows) {
    clicks += Number(r.clicks) || 0;
    impressions += Number(r.impressions) || 0;
    weighted += Number(r.position_weighted) || 0;
  }
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : null,
    position: impressions > 0 ? weighted / impressions : null,
  };
}

export type Ga4Totals = {
  sessions: number;
  newUsers: number;
  engagedSessions: number;
  pageViews: number;
  keyEvents: number;
  engagementRate: number | null;
  avgSessionDuration: number | null;
};

export function ga4Totals(
  rows: ReadonlyArray<{
    sessions: number;
    new_users: number;
    engaged_sessions: number;
    screen_page_views: number;
    key_events: number;
    session_duration_seconds: number;
  }>,
): Ga4Totals {
  let sessions = 0;
  let newUsers = 0;
  let engaged = 0;
  let views = 0;
  let keyEvents = 0;
  let duration = 0;
  for (const r of rows) {
    sessions += Number(r.sessions) || 0;
    newUsers += Number(r.new_users) || 0;
    engaged += Number(r.engaged_sessions) || 0;
    views += Number(r.screen_page_views) || 0;
    keyEvents += Number(r.key_events) || 0;
    duration += Number(r.session_duration_seconds) || 0;
  }
  return {
    sessions,
    newUsers,
    engagedSessions: engaged,
    pageViews: views,
    keyEvents,
    engagementRate: sessions > 0 ? engaged / sessions : null,
    avgSessionDuration: sessions > 0 ? duration / sessions : null,
  };
}
