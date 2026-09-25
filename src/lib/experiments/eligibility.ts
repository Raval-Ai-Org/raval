// eligibility.ts — can this group of pages carry a trustworthy test?
// (ADR-0024 §6). Pure; every number shown to people comes from here.
//
//   - at least MIN_PAGES pages with Search Console data in the pre-period
//   - PRE_PERIOD_DAYS complete days of data
//   - no single page above MAX_PAGE_SHARE of the primary metric
//   - power: MDE(28) ≤ MAX_MDE, where MDE(w) = (z_α + z_power) × SE(w) and
//     SE(w) comes from the daily log ratio of the two halves under many random
//     pair splits of the pre-period, with 7-day blocks.
import {
  BOOTSTRAP_BLOCK_DAYS,
  MAX_MDE,
  MAX_PAGE_SHARE,
  MDE_BLOCK_DAYS,
  MDE_HORIZONS_DAYS,
  MIN_PAGES,
  POWER_SPLITS,
  PRE_PERIOD_DAYS,
  Z_CHECKPOINT,
  Z_POWER,
  type ExperimentMetric,
} from "./constants";
import { drawPairs } from "./assign";
import { mulberry32 } from "./random";
import { metricParts, pageTotal, rowFor, unitField, type PageSeries } from "./series";

export type EligibilityReason = { code: string; message: string };

export type Eligibility = {
  eligible: boolean;
  reasons: EligibilityReason[];
  metric: ExperimentMetric;
  pageCount: number;
  pagesWithData: number;
  preDays: number;
  /** Pre-period total of the metric's numerator across the group. */
  total: number;
  /** Share of the largest single page. */
  topShare: number;
  topPath: string | null;
  /** Minimum detectable effect by horizon, as a proportion (0.12 = 12%). */
  mde: Record<string, number | null>;
};

function variance(values: number[]): number {
  if (values.length < 2) return NaN;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
}

/**
 * Standard error of a log-ratio lift measured over `w` post days, from the
 * pre-period. Returns null when there aren't two full blocks of data.
 */
export function estimateLiftSe(
  metric: ExperimentMetric,
  paths: string[],
  series: PageSeries,
  dates: string[],
  w: number,
  splits = POWER_SPLITS,
): number | null {
  const blocks = Math.floor(dates.length / BOOTSTRAP_BLOCK_DAYS);
  if (blocks < 2 || paths.length < 4) return null;
  const field = unitField(metric);
  const pages = paths.map((path) => ({ path, value: pageTotal(series, path, dates, field) }));
  const rng = mulberry32(0x0e11);
  let sumVar = 0;
  let used = 0;
  for (let s = 0; s < splits; s++) {
    const { pairs } = drawPairs(pages, Math.floor(rng() * 0x7fffffff));
    const logs: number[] = [];
    for (const d of dates) {
      let tn = 0,
        td = 0,
        cn = 0,
        cd = 0;
      for (const p of pairs) {
        const t = metricParts(metric, rowFor(series, p.treatment, d));
        const c = metricParts(metric, rowFor(series, p.control, d));
        tn += t.num;
        td += t.den;
        cn += c.num;
        cd += c.den;
      }
      if (td <= 0 || cd <= 0) {
        logs.push(NaN);
        continue;
      }
      // +0.5 keeps quiet days finite without favouring either arm.
      logs.push(Math.log((tn + 0.5) / td) - Math.log((cn + 0.5) / cd));
    }
    const means: number[] = [];
    for (let b = 0; b < blocks; b++) {
      const chunk = logs
        .slice(b * BOOTSTRAP_BLOCK_DAYS, (b + 1) * BOOTSTRAP_BLOCK_DAYS)
        .filter(Number.isFinite);
      if (chunk.length) means.push(chunk.reduce((a, v) => a + v, 0) / chunk.length);
    }
    const v = variance(means);
    if (Number.isFinite(v)) {
      sumVar += v;
      used++;
    }
  }
  if (!used) return null;
  const blockVar = sumVar / used;
  // Mean of w post days minus mean of the pre-period, both over 7-day blocks.
  return Math.sqrt(blockVar * (BOOTSTRAP_BLOCK_DAYS / w + BOOTSTRAP_BLOCK_DAYS / dates.length));
}

export function mdeFromSe(se: number | null): number | null {
  if (se === null || !Number.isFinite(se)) return null;
  return Math.exp((Z_CHECKPOINT + Z_POWER) * se) - 1;
}

export function checkEligibility(input: {
  metric: ExperimentMetric;
  paths: string[];
  series: PageSeries;
  /** Complete pre-period days, ascending. */
  dates: string[];
}): Eligibility {
  const { metric, series, dates } = input;
  const paths = [...new Set(input.paths)];
  const reasons: EligibilityReason[] = [];
  const hasGsc = (path: string) => dates.some((d) => rowFor(series, path, d).impressions > 0);
  const withData = paths.filter(hasGsc);
  const field = unitField(metric);
  const totals = withData.map((path) => ({ path, value: pageTotal(series, path, dates, field) }));
  const total = totals.reduce((s, t) => s + t.value, 0);
  const top = totals.reduce<{ path: string; value: number } | null>(
    (best, t) => (!best || t.value > best.value ? t : best),
    null,
  );
  const topShare = total > 0 && top ? top.value / total : 0;

  if (dates.length < PRE_PERIOD_DAYS) {
    reasons.push({
      code: "short_history",
      message: `Only ${dates.length} complete days of data; ${PRE_PERIOD_DAYS} are needed.`,
    });
  }
  if (withData.length < MIN_PAGES) {
    reasons.push({
      code: "too_few_pages",
      message: `${withData.length} pages have Search Console data; at least ${MIN_PAGES} are needed.`,
    });
  }
  if (total <= 0) {
    reasons.push({ code: "no_traffic", message: "These pages had no traffic on this metric." });
  } else if (topShare > MAX_PAGE_SHARE) {
    reasons.push({
      code: "one_page_dominates",
      message: `One page holds ${Math.round(topShare * 100)}% of the traffic; the limit is ${Math.round(MAX_PAGE_SHARE * 100)}%.`,
    });
  }

  const mde: Record<string, number | null> = {};
  for (const w of MDE_HORIZONS_DAYS) {
    mde[String(w)] =
      withData.length >= 4 ? mdeFromSe(estimateLiftSe(metric, withData, series, dates, w)) : null;
  }
  const blocking = mde[String(MDE_BLOCK_DAYS)];
  if (reasons.length === 0) {
    if (blocking === null) {
      reasons.push({
        code: "no_power_estimate",
        message: "There isn't enough steady traffic to estimate what a test could detect.",
      });
    } else if (blocking > MAX_MDE) {
      reasons.push({
        code: "not_enough_traffic",
        message: `With this traffic a test could only detect changes above ${Math.round(blocking * 100)}% in ${MDE_BLOCK_DAYS} days; the limit is ${Math.round(MAX_MDE * 100)}%.`,
      });
    }
  }

  return {
    eligible: reasons.length === 0,
    reasons,
    metric,
    pageCount: paths.length,
    pagesWithData: withData.length,
    preDays: dates.length,
    total,
    topShare,
    topPath: top?.path ?? null,
    mde,
  };
}
