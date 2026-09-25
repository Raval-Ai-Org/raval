// simulate.ts — seeded synthetic sites for the statistics tests only.
// Never used to show anything to a person: Proof Engine displays real data or
// says there is none.
import { mulberry32 } from "./random";
import { addDaysIso, dateRange, type MetricRow, type PageSeries } from "./series";

export type SimulationSpec = {
  pages: number;
  preDays: number;
  postDays: number;
  seed: number;
  /** Multiplier applied to treatment pages after the change (0.15 = +15%). */
  effect?: number;
  treatmentPaths?: Set<string>;
  /** Amplitude of a weekly cycle shared by every page (0.3 = ±30%). */
  weekly?: number;
  /** A site-wide multiplier on some post days, e.g. { day: 5, length: 3, factor: 2 }. */
  spike?: { day: number; length: number; factor: number };
  /** Typical clicks per page per day. */
  baseClicks?: number;
};

export const SIM_START = "2026-01-05";

function poisson(rng: () => number, lambda: number): number {
  if (lambda <= 0) return 0;
  if (lambda > 40) {
    // Normal approximation (Box–Muller) for large means.
    const u = Math.max(rng(), 1e-12);
    const v = rng();
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * z));
  }
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > limit);
  return k - 1;
}

export function simPaths(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `/products/item-${String(i).padStart(3, "0")}`);
}

export function simulateSite(spec: SimulationSpec): {
  series: PageSeries;
  paths: string[];
  preDates: string[];
  postDates: string[];
} {
  const master = mulberry32(spec.seed);
  const paths = simPaths(spec.pages);
  const preDates = dateRange(SIM_START, addDaysIso(SIM_START, spec.preDays - 1));
  const postStart = addDaysIso(SIM_START, spec.preDays);
  const postDates =
    spec.postDays > 0 ? dateRange(postStart, addDaysIso(postStart, spec.postDays - 1)) : [];
  const base = spec.baseClicks ?? 12;
  // Heavy-tailed page sizes, like real sites, capped so no page dominates.
  const scale = paths.map(() => Math.min(4, Math.exp((master() - 0.5) * 1.6)));
  const series: PageSeries = {};
  const all = [...preDates, ...postDates];
  paths.forEach((path, i) => {
    const days: Record<string, MetricRow> = {};
    // Separate streams per page and period, so the pre-period is identical
    // whatever effect is injected afterwards (assignment reads the pre-period).
    const preRng = mulberry32((spec.seed * 1_000_003 + i * 7_919 + 1) >>> 0);
    const postRng = mulberry32((spec.seed * 1_000_033 + i * 104_729 + 2) >>> 0);
    all.forEach((date, d) => {
      const postIndex = d - preDates.length;
      const rng = postIndex >= 0 ? postRng : preRng;
      let mult = 1 + (spec.weekly ?? 0) * Math.sin((2 * Math.PI * d) / 7);
      if (
        spec.spike &&
        postIndex >= spec.spike.day &&
        postIndex < spec.spike.day + spec.spike.length
      )
        mult *= spec.spike.factor;
      if (postIndex >= 0 && spec.effect && spec.treatmentPaths?.has(path)) mult *= 1 + spec.effect;
      const impressions = poisson(rng, base * scale[i] * 20 * mult);
      const clicks = poisson(rng, base * scale[i] * mult);
      const sessions = poisson(rng, base * scale[i] * 1.3 * mult);
      days[date] = {
        clicks,
        impressions: Math.max(impressions, clicks),
        position_weighted: impressions * 8,
        sessions,
        key_events: poisson(rng, sessions * 0.05),
        revenue: 0,
        ai_referral_sessions: 0,
      };
    });
    series[path] = days;
  });
  return { series, paths, preDates, postDates };
}
