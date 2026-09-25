import { describe, expect, it } from "vitest";
import { analyzeExperiment, type AnalysisInput } from "./analysis";
import { assignPages, replayAssignment } from "./assign";
import { CHECKPOINT_ALPHA, MAX_DURATION_DAYS, PRE_PERIOD_DAYS } from "./constants";
import { checkEligibility } from "./eligibility";
import { evaluateExperiment } from "./evaluate";
import { pairSums, placeboTest } from "./placebo";
import { mulberry32 } from "./random";
import { estimateMonthlyValue } from "./revenue";
import { pageTotal, type PageSeries } from "./series";
import { simulateSite, type SimulationSpec } from "./simulate";
import { decideAtCheckpoint, dueCheckpoint } from "./verdict";

const FAST = { bootstrapSamples: 400, placeboDraws: 400 };

/** A full simulated experiment: assign on the pre-period, inject, evaluate every checkpoint. */
function runExperiment(
  seed: number,
  spec: Partial<SimulationSpec> = {},
  opts = FAST,
): ReturnType<typeof evaluateExperiment> & { input: AnalysisInput } {
  const base: SimulationSpec = {
    pages: 30,
    preDays: PRE_PERIOD_DAYS,
    postDays: MAX_DURATION_DAYS,
    seed,
    ...spec,
  };
  const pre = simulateSite({ ...base, effect: 0 });
  const assignment = assignPages(
    pre.paths.map((path) => ({ path, value: pageTotal(pre.series, path, pre.preDates, "clicks") })),
    seed,
  );
  const treatmentPaths = new Set(assignment.pairs.map((p) => p.treatment));
  const site = simulateSite({ ...base, treatmentPaths });
  const input: AnalysisInput = {
    metric: "clicks",
    pairs: assignment.pairs,
    series: site.series,
    preDates: site.preDates,
    postDates: site.postDates,
  };
  return { ...evaluateExperiment(input, null, { ...opts, seed }), input };
}

describe("assignment", () => {
  const site = simulateSite({ pages: 31, preDays: 56, postDays: 0, seed: 7 });
  const pages = site.paths.map((path) => ({
    path,
    value: pageTotal(site.series, path, site.preDates, "clicks"),
  }));

  it("is a pure function of the pages and the seed", () => {
    const a = assignPages(pages, 1234);
    const b = assignPages([...pages].reverse(), 1234);
    expect(b.pairs).toEqual(a.pairs);
    expect(assignPages(pages, 999).pairs).not.toEqual(a.pairs);
  });

  it("pairs neighbours, excludes the odd page and balances within 5%", () => {
    const a = assignPages(pages, 42);
    expect(a.pairs).toHaveLength(15);
    expect(a.excluded).toHaveLength(1);
    expect(a.balanced).toBe(true);
    expect(a.imbalance).toBeLessThanOrEqual(0.05);
    const seen = new Set(a.pairs.flatMap((p) => [p.treatment, p.control]));
    expect(seen.size).toBe(30);
    expect(seen.has(a.excluded[0].path)).toBe(false);
  });

  it("re-draws with seed + k and records the attempts", () => {
    // Two big pages and many tiny ones: most draws are out of balance.
    const skewed = [
      { path: "/a", value: 1000 },
      { path: "/b", value: 900 },
      ...Array.from({ length: 10 }, (_, i) => ({ path: `/p${i}`, value: 10 + i * 20 })),
    ];
    let redraws = 0;
    for (let seed = 1; seed < 40; seed++) {
      const r = assignPages(skewed, seed);
      if (r.attempts > 1) redraws++;
      const replay = replayAssignment(skewed, r.seed, r.attempts);
      expect(replay.pairs).toEqual(r.pairs);
    }
    expect(redraws).toBeGreaterThan(0);
  });

  it("reports failure instead of pretending when no draw balances", () => {
    const r = assignPages(
      [
        { path: "/a", value: 1000 },
        { path: "/b", value: 1 },
      ],
      3,
    );
    expect(r.balanced).toBe(false);
    expect(r.imbalance).toBeGreaterThan(0.05);
    // `attempts` names the least-bad draw, so the stored split can be replayed.
    expect(
      replayAssignment(
        [
          { path: "/a", value: 1000 },
          { path: "/b", value: 1 },
        ],
        r.seed,
        r.attempts,
      ).pairs,
    ).toEqual(r.pairs);
  });
});

describe("A/A: no effect", () => {
  it("gives a false win or loss in at most 5.5% of 2,000 experiments", () => {
    let falseVerdicts = 0;
    const runs = 2000;
    for (let i = 0; i < runs; i++) {
      const r = runExperiment(10_000 + i, {}, { bootstrapSamples: 300, placeboDraws: 300 });
      if (r.final?.verdict === "win" || r.final?.verdict === "loss") falseVerdicts++;
    }
    expect(falseVerdicts / runs).toBeLessThanOrEqual(0.055);
  }, 600_000);

  it("a weekly cycle and a site-wide spike produce no false win", () => {
    let wins = 0;
    let meanAbsLift = 0;
    const runs = 200;
    for (let i = 0; i < runs; i++) {
      const r = runExperiment(50_000 + i, {
        weekly: 0.4,
        spike: { day: 3, length: 4, factor: 3 },
      });
      if (r.final?.verdict === "win" || r.final?.verdict === "loss") wins++;
      meanAbsLift += Math.abs(r.early.lift ?? 0) / runs;
    }
    expect(wins / runs).toBeLessThanOrEqual(0.08);
    expect(meanAbsLift).toBeLessThan(0.05);
  }, 120_000);
});

describe("a known +15% effect", () => {
  it("is recovered, with the 95% interval containing 15%", () => {
    const runs = 200;
    let contains = 0;
    let wins = 0;
    let sum = 0;
    for (let i = 0; i < runs; i++) {
      const r = runExperiment(90_000 + i, { effect: 0.15 });
      const [lo, hi] = r.early.ci95!;
      if (lo <= 0.15 && hi >= 0.15) contains++;
      if (r.final?.verdict === "win") wins++;
      sum += r.early.lift!;
    }
    expect(Math.abs(sum / runs - 0.15)).toBeLessThan(0.015);
    expect(contains / runs).toBeGreaterThanOrEqual(0.85);
    expect(wins / runs).toBeGreaterThanOrEqual(0.8);
  }, 120_000);

  it("is found despite a site-wide spike", () => {
    const r = runExperiment(4242, { effect: 0.15, spike: { day: 2, length: 5, factor: 2.5 } });
    expect(r.early.lift!).toBeGreaterThan(0.08);
    expect(r.early.lift!).toBeLessThan(0.22);
  });

  it("a -15% effect is a loss", () => {
    const r = runExperiment(777, { effect: -0.15 });
    expect(r.final?.verdict).toBe("loss");
  });
});

describe("data quality", () => {
  it("drops incomplete days from both arms", () => {
    const r = runExperiment(1, { effect: 0.15 });
    const missing = new Set(r.input.postDates.filter((_, i) => i % 5 === 0));
    const input = { ...r.input, postDates: r.input.postDates.filter((d) => !missing.has(d)) };
    const res = analyzeExperiment(input, FAST);
    expect(res.postDays).toBe(r.input.postDates.length - missing.size);
    expect(res.lift!).toBeGreaterThan(0.05);
  });

  it("keeps zero-traffic pages in the analysis", () => {
    const r = runExperiment(2);
    const series: PageSeries = { ...r.input.series };
    const quiet = r.input.pairs[0];
    for (const path of [quiet.treatment, quiet.control]) {
      series[path] = Object.fromEntries(
        Object.keys(series[path]).map((d) => [d, { ...series[path][d], clicks: 0 }]),
      );
    }
    const res = analyzeExperiment({ ...r.input, series }, FAST);
    expect(res.pairs).toBe(r.input.pairs.length);
    expect(res.lift).not.toBeNull();
  });

  it("a page that 404s mid-run is excluded with its pair", () => {
    const r = runExperiment(3, { effect: 0.15 });
    const [gone, ...rest] = r.input.pairs;
    void gone;
    const res = analyzeExperiment({ ...r.input, pairs: rest }, FAST);
    expect(res.pairs).toBe(r.input.pairs.length - 1);
    expect(res.lift!).toBeGreaterThan(0.05);
  });

  it("refuses an estimate without data rather than inventing one", () => {
    const r = runExperiment(4);
    expect(analyzeExperiment({ ...r.input, postDates: [] }).lift).toBeNull();
    expect(analyzeExperiment({ ...r.input, pairs: r.input.pairs.slice(0, 1) }).reason).toMatch(
      /two page pairs/,
    );
  });
});

describe("placebo test", () => {
  it("enumerates every swap pattern when there are few pairs", () => {
    const r = runExperiment(5, { pages: 16, effect: 0.5 });
    const input = { ...r.input, pairs: r.input.pairs.slice(0, 8) };
    const out = placeboTest(pairSums(input), "clicks", 1000, mulberry32(1));
    expect(out.exact).toBe(true);
    // With 8 pairs the smallest possible p is 1/256 (observed and one mirror at most).
    expect(out.p!).toBeGreaterThanOrEqual(1 / 256);
    expect(out.p!).toBeLessThan(0.05);
  });
});

describe("verdict rules", () => {
  it("only evaluates fixed checkpoints, in order", () => {
    expect(dueCheckpoint(20, null)).toBeNull();
    expect(dueCheckpoint(21, null)).toBe(21);
    expect(dueCheckpoint(30, 21)).toBe(28);
    expect(dueCheckpoint(30, 28)).toBeNull();
    expect(dueCheckpoint(60, 35)).toBe(42);
  });

  it("a positive estimate that isn't significant is not a win", () => {
    const r = runExperiment(6, { effect: 0.15 });
    const weak = { ...r.early, placeboP: CHECKPOINT_ALPHA * 2 };
    expect(decideAtCheckpoint(weak, 21).verdict).toBeNull();
    expect(decideAtCheckpoint(weak, 42).verdict).toBe("inconclusive");
  });

  it("stops at the first checkpoint with a verdict", () => {
    const r = runExperiment(8, { effect: 0.4 });
    expect(r.final?.day).toBe(21);
    expect(r.checkpoints).toHaveLength(1);
  });
});

describe("eligibility", () => {
  const good = simulateSite({ pages: 40, preDays: 56, postDays: 0, seed: 11 });

  it("accepts a healthy group and reports the detectable effect", () => {
    const e = checkEligibility({
      metric: "clicks",
      paths: good.paths,
      series: good.series,
      dates: good.preDates,
    });
    expect(e.reasons).toEqual([]);
    expect(e.eligible).toBe(true);
    expect(e.mde["28"]!).toBeGreaterThan(0);
    expect(e.mde["28"]!).toBeLessThan(e.mde["21"]!);
  });

  it("refuses too few pages and a short history", () => {
    const e = checkEligibility({
      metric: "clicks",
      paths: good.paths.slice(0, 12),
      series: good.series,
      dates: good.preDates.slice(0, 30),
    });
    expect(e.eligible).toBe(false);
    expect(e.reasons.map((r) => r.code)).toEqual(["short_history", "too_few_pages"]);
  });

  it("refuses when one page dominates", () => {
    const series = { ...good.series };
    const big = good.paths[0];
    series[big] = Object.fromEntries(
      Object.entries(series[big]).map(([d, row]) => [d, { ...row, clicks: row.clicks + 2000 }]),
    );
    const e = checkEligibility({
      metric: "clicks",
      paths: good.paths,
      series,
      dates: good.preDates,
    });
    expect(e.reasons.map((r) => r.code)).toContain("one_page_dominates");
    expect(e.topPath).toBe(big);
  });

  it("refuses when traffic is too thin to detect 25% in 28 days", () => {
    const thin = simulateSite({ pages: 32, preDays: 56, postDays: 0, seed: 12, baseClicks: 0.15 });
    const e = checkEligibility({
      metric: "clicks",
      paths: thin.paths,
      series: thin.series,
      dates: thin.preDates,
    });
    expect(e.eligible).toBe(false);
    expect(e.reasons[0].code).toMatch(/not_enough_traffic|no_power_estimate/);
  });
});

describe("estimated value", () => {
  it("prices extra units at the pre-period revenue per unit", () => {
    const v = estimateMonthlyValue({
      metric: "clicks",
      extraPerDay: 10,
      preRevenue: 5000,
      preUnits: 10000,
      currency: "USD",
    });
    expect(v.monthlyUnits).toBeCloseTo(304);
    expect(v.monthlyValue).toBeCloseTo(152);
    expect(v.basis.valuePerUnit).toBe(0.5);
  });

  it("says why when there is no revenue to price with", () => {
    const v = estimateMonthlyValue({
      metric: "clicks",
      extraPerDay: 10,
      preRevenue: 0,
      preUnits: 1000,
      currency: "USD",
    });
    expect(v.monthlyValue).toBeNull();
    expect(v.reason).toMatch(/No GA4 revenue/);
  });
});
