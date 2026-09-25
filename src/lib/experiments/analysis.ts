// analysis.ts — the lift estimate and its interval (ADR-0024 §6).
//
// Difference-in-differences as a ratio:
//   r    = (T_pre / C_pre)                 pre-period ratio of the arms
//   lift = (T_post / C_post) / r − 1       i.e. ΣT_post / Σ(r · C_post) − 1
// Shocks common to both arms (weekly cycles, algorithm updates, site-wide
// spikes) cancel. The interval is a moving-block bootstrap over days (blocks
// of BOOTSTRAP_BLOCK_DAYS), resampling (T_d, C_d) within pre and within post.
// The randomization p-value comes from placebo.ts.
//
// Pure: no I/O, and every random draw comes from a seeded generator.
import {
  BOOTSTRAP_BLOCK_DAYS,
  BOOTSTRAP_SAMPLES,
  CHECKPOINT_ALPHA,
  PLACEBO_DRAWS,
  type ExperimentMetric,
} from "./constants";
import { placeboTest, pairSums } from "./placebo";
import { mulberry32, randInt } from "./random";
import { metricParts, rowFor, type PageSeries } from "./series";

export type AnalysisPair = { stratum: number; treatment: string; control: string };

export type AnalysisInput = {
  metric: ExperimentMetric;
  /** Pairs still in the analysis (a pair with an excluded page is left out whole). */
  pairs: AnalysisPair[];
  series: PageSeries;
  /** Complete days only, ascending. */
  preDates: string[];
  postDates: string[];
};

export type AnalysisOptions = {
  bootstrapSamples?: number;
  placeboDraws?: number;
  seed?: number;
};

export type DailyPoint = {
  date: string;
  period: "pre" | "post";
  treatment: number;
  control: number;
  /** What treatment would have done without the change: r × control. */
  expected: number;
};

export type AnalysisResult = {
  metric: ExperimentMetric;
  pairs: number;
  preDays: number;
  postDays: number;
  /** null when the data can't support an estimate (reason says why). */
  lift: number | null;
  ci95: [number, number] | null;
  /** Interval at the per-look level CHECKPOINT_ALPHA — what verdicts use. */
  ciAdjusted: [number, number] | null;
  placeboP: number | null;
  placeboExact: boolean;
  totals: {
    treatmentPre: number;
    controlPre: number;
    treatmentPost: number;
    controlPost: number;
  };
  /** Extra units per day of the metric's numerator (clicks for CTR). */
  extraPerDay: number | null;
  daily: DailyPoint[];
  reason: string | null;
};

type Day = { tn: number; td: number; cn: number; cd: number };

function armDays(input: AnalysisInput, dates: string[]): Day[] {
  return dates.map((date) => {
    const day: Day = { tn: 0, td: 0, cn: 0, cd: 0 };
    for (const p of input.pairs) {
      const t = metricParts(input.metric, rowFor(input.series, p.treatment, date));
      const c = metricParts(input.metric, rowFor(input.series, p.control, date));
      day.tn += t.num;
      day.td += t.den;
      day.cn += c.num;
      day.cd += c.den;
    }
    return day;
  });
}

type Sums = { tn: number; td: number; cn: number; cd: number };

function sum(days: Day[]): Sums {
  const s = { tn: 0, td: 0, cn: 0, cd: 0 };
  for (const d of days) {
    s.tn += d.tn;
    s.td += d.td;
    s.cn += d.cn;
    s.cd += d.cd;
  }
  return s;
}

/** The ratio lift from period sums, or null when a ratio is undefined. */
export function ratioLift(pre: Sums, post: Sums): number | null {
  if (pre.td <= 0 || pre.cd <= 0 || post.td <= 0 || post.cd <= 0) return null;
  const tPre = pre.tn / pre.td;
  const cPre = pre.cn / pre.cd;
  const tPost = post.tn / post.td;
  const cPost = post.cn / post.cd;
  if (tPre <= 0 || cPre <= 0 || cPost <= 0) return null;
  return tPost / cPost / (tPre / cPre) - 1;
}

/** Moving-block resample of `days` to the same length. */
function blockResample(days: Day[], rng: () => number): Sums {
  const n = days.length;
  const block = Math.min(BOOTSTRAP_BLOCK_DAYS, n);
  const starts = n - block + 1;
  const s = { tn: 0, td: 0, cn: 0, cd: 0 };
  let taken = 0;
  while (taken < n) {
    const start = randInt(rng, starts);
    for (let i = 0; i < block && taken < n; i++, taken++) {
      const d = days[start + i];
      s.tn += d.tn;
      s.td += d.td;
      s.cn += d.cn;
      s.cd += d.cd;
    }
  }
  return s;
}

function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function bootstrapLifts(
  pre: Day[],
  post: Day[],
  samples: number,
  rng: () => number,
): number[] {
  const out: number[] = [];
  for (let b = 0; b < samples; b++) {
    const lift = ratioLift(blockResample(pre, rng), blockResample(post, rng));
    if (lift !== null && Number.isFinite(lift)) out.push(lift);
  }
  return out.sort((a, b) => a - b);
}

function empty(input: AnalysisInput, reason: string): AnalysisResult {
  return {
    metric: input.metric,
    pairs: input.pairs.length,
    preDays: input.preDates.length,
    postDays: input.postDates.length,
    lift: null,
    ci95: null,
    ciAdjusted: null,
    placeboP: null,
    placeboExact: false,
    totals: { treatmentPre: 0, controlPre: 0, treatmentPost: 0, controlPost: 0 },
    extraPerDay: null,
    daily: [],
    reason,
  };
}

export function analyzeExperiment(
  input: AnalysisInput,
  opts: AnalysisOptions = {},
): AnalysisResult {
  if (input.pairs.length < 2) return empty(input, "Fewer than two page pairs have usable data.");
  if (input.preDates.length < BOOTSTRAP_BLOCK_DAYS)
    return empty(input, "Not enough complete days before the change.");
  if (input.postDates.length < 1)
    return empty(input, "No complete days since the change went live.");

  const pre = armDays(input, input.preDates);
  const post = armDays(input, input.postDates);
  const preSum = sum(pre);
  const postSum = sum(post);
  const lift = ratioLift(preSum, postSum);

  const tPre = preSum.td > 0 ? preSum.tn / preSum.td : 0;
  const cPre = preSum.cd > 0 ? preSum.cn / preSum.cd : 0;
  const r = cPre > 0 ? tPre / cPre : null;
  const value = (n: number, d: number) => (d > 0 ? n / d : 0);
  const daily: DailyPoint[] = [
    ...pre.map((d, i) => ({ d, date: input.preDates[i], period: "pre" as const })),
    ...post.map((d, i) => ({ d, date: input.postDates[i], period: "post" as const })),
  ].map(({ d, date, period }) => ({
    date,
    period,
    treatment: value(d.tn, d.td),
    control: value(d.cn, d.cd),
    expected: r === null ? 0 : r * value(d.cn, d.cd),
  }));

  const totals = {
    treatmentPre: preSum.tn,
    controlPre: preSum.cn,
    treatmentPost: postSum.tn,
    controlPost: postSum.cn,
  };

  if (lift === null) {
    return {
      ...empty(input, "The arms had no traffic to compare in one of the periods."),
      totals,
      daily,
    };
  }

  const rng = mulberry32((opts.seed ?? 0x5eed) >>> 0);
  const lifts = bootstrapLifts(pre, post, opts.bootstrapSamples ?? BOOTSTRAP_SAMPLES, rng);
  const half = CHECKPOINT_ALPHA / 2;
  const ci95: [number, number] | null = lifts.length
    ? [quantile(lifts, 0.025), quantile(lifts, 0.975)]
    : null;
  const ciAdjusted: [number, number] | null = lifts.length
    ? [quantile(lifts, half), quantile(lifts, 1 - half)]
    : null;

  const placebo = placeboTest(
    pairSums(input),
    input.metric,
    opts.placeboDraws ?? PLACEBO_DRAWS,
    mulberry32(((opts.seed ?? 0x5eed) ^ 0x9e3779b9) >>> 0),
  );

  // Units the treatment gained over its counterfactual: T − T/(1 + lift).
  const extraPerDay = (postSum.tn - postSum.tn / (1 + lift)) / input.postDates.length;

  return {
    metric: input.metric,
    pairs: input.pairs.length,
    preDays: input.preDates.length,
    postDays: input.postDates.length,
    lift,
    ci95,
    ciAdjusted,
    placeboP: placebo.p,
    placeboExact: placebo.exact,
    totals,
    extraPerDay,
    daily,
    reason: null,
  };
}
