import { describe, expect, it } from "vitest";
import { compareMetric, ga4Totals, gscTotals, pctChange } from "./compare";
import { formatMetric, METRIC_KEYS, METRICS } from "./metrics";
import { computeMovers } from "./movers";
import {
  addDays,
  alignToData,
  covers,
  daysInclusive,
  eachDay,
  RangeInputSchema,
  resolveRange,
  todayIn,
} from "./ranges";
import { buildSignals, fingerprintSignals } from "./signals";
import { DATA_SOURCE_IDS } from "./sources";

describe("ranges", () => {
  it("resolves presets ending yesterday with an equal previous window", () => {
    const r = resolveRange({ preset: "28d" }, "2026-09-18");
    expect(r.current).toEqual({ from: "2026-08-21", to: "2026-09-17", days: 28 });
    expect(r.previous).toEqual({ from: "2026-07-24", to: "2026-08-20", days: 28 });
    expect(r.key).toBe("28d:2026-09-17");
  });

  it("handles month and year boundaries", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2024-03-01", -1)).toBe("2024-02-29");
    expect(daysInclusive("2025-12-30", "2026-01-02")).toBe(4);
    expect(eachDay("2025-12-31", "2026-01-02")).toEqual(["2025-12-31", "2026-01-01", "2026-01-02"]);
  });

  it("clamps custom ranges to today and computes the previous window", () => {
    const r = resolveRange({ from: "2026-09-01", to: "2026-09-30" }, "2026-09-18");
    expect(r.current).toEqual({ from: "2026-09-01", to: "2026-09-18", days: 18 });
    expect(r.previous.to).toBe("2026-08-31");
    expect(r.previous.days).toBe(18);
    expect(r.preset).toBeNull();
  });

  it("validates custom ranges", () => {
    expect(RangeInputSchema.safeParse({ from: "2026-09-10", to: "2026-09-01" }).success).toBe(
      false,
    );
    expect(RangeInputSchema.safeParse({ from: "2026-01-01", to: "2026-09-01" }).success).toBe(
      false,
    );
    expect(RangeInputSchema.safeParse({ from: "2026-02-30", to: "2026-03-01" }).success).toBe(
      false,
    );
    expect(RangeInputSchema.safeParse({ preset: "28d" }).success).toBe(true);
    expect(RangeInputSchema.safeParse({ preset: "365d" }).success).toBe(false);
  });

  it("aligns preset windows to the last day with data (Search Console lag)", () => {
    const r = resolveRange({ preset: "7d" }, "2026-09-18");
    const aligned = alignToData(r, "2026-09-15");
    expect(aligned.current).toEqual({ from: "2026-09-09", to: "2026-09-15", days: 7 });
    expect(aligned.previous.to).toBe("2026-09-08");
    // Custom ranges and fresh data are left alone.
    expect(alignToData(r, "2026-09-17")).toBe(r);
    const custom = resolveRange({ from: "2026-09-01", to: "2026-09-10" }, "2026-09-18");
    expect(alignToData(custom, "2026-09-05")).toBe(custom);
  });

  it("reports coverage for previous-period comparisons", () => {
    const r = resolveRange({ preset: "90d" }, "2026-09-18");
    expect(covers("2026-03-22", r.previous)).toBe(true);
    expect(covers("2026-06-01", r.previous)).toBe(false);
    expect(covers(null, r.previous)).toBe(false);
  });

  it("computes today in a time zone", () => {
    const at = new Date("2026-09-18T03:00:00Z");
    expect(todayIn("America/Los_Angeles", at)).toBe("2026-09-17");
    expect(todayIn("Asia/Karachi", at)).toBe("2026-09-18");
    expect(todayIn("Not/AZone", at)).toBe("2026-09-18");
  });
});

describe("compareMetric", () => {
  it("computes deltas, direction and significance", () => {
    const c = compareMetric("gsc.clicks", 150, 100);
    expect(c).toMatchObject({
      abs: 50,
      pct: 50,
      direction: "up",
      favorable: true,
      significant: true,
      status: "ok",
    });
  });

  it("treats a lower search position as favorable", () => {
    const c = compareMetric("gsc.position", 8.2, 12.4, { volume: 5000 });
    expect(c.direction).toBe("down");
    expect(c.favorable).toBe(true);
    expect(c.significant).toBe(true);
  });

  it("requires volume for ratio metrics and a base for counts", () => {
    expect(compareMetric("gsc.ctr", 0.05, 0.02, { volume: 100 }).significant).toBe(false);
    expect(compareMetric("gsc.ctr", 0.05, 0.02, { volume: 5000 }).significant).toBe(true);
    expect(compareMetric("gsc.clicks", 4, 2).significant).toBe(false);
    expect(compareMetric("gsc.clicks", 105, 100).significant).toBe(false);
  });

  it("refuses to compare without history, and never divides by zero", () => {
    expect(compareMetric("ga4.sessions", 120, 80, { previousCovered: false })).toMatchObject({
      status: "insufficient_history",
      pct: null,
      significant: false,
    });
    expect(compareMetric("ga4.sessions", null, 80).status).toBe("no_data");
    const fromZero = compareMetric("ga4.keyEvents", 12, 0);
    expect(fromZero.pct).toBeNull();
    expect(fromZero.significant).toBe(true);
    expect(pctChange(5, 0)).toBeNull();
  });

  it("reports flat changes as neither good nor bad", () => {
    expect(compareMetric("ga4.sessions", 1000, 1002)).toMatchObject({
      direction: "flat",
      favorable: null,
      significant: false,
    });
  });
});

describe("ratio aggregation", () => {
  it("recomputes CTR and weighted position from totals", () => {
    const t = gscTotals([
      { clicks: 10, impressions: 100, position_weighted: 100 * 2 },
      { clicks: 0, impressions: 900, position_weighted: 900 * 20 },
    ]);
    expect(t.ctr).toBeCloseTo(0.01);
    // Weighted: (200 + 18000) / 1000 = 18.2 — not the naive (2 + 20) / 2 = 11.
    expect(t.position).toBeCloseTo(18.2);
    expect(gscTotals([]).ctr).toBeNull();
  });

  it("session-weights GA4 rates", () => {
    const t = ga4Totals([
      {
        sessions: 100,
        new_users: 40,
        engaged_sessions: 50,
        screen_page_views: 300,
        key_events: 3,
        session_duration_seconds: 100 * 60,
      },
      {
        sessions: 300,
        new_users: 60,
        engaged_sessions: 250,
        screen_page_views: 900,
        key_events: 9,
        session_duration_seconds: 300 * 120,
      },
    ]);
    expect(t.sessions).toBe(400);
    expect(t.engagementRate).toBeCloseTo(0.75);
    expect(t.avgSessionDuration).toBeCloseTo(105);
  });
});

describe("movers", () => {
  it("finds risers, fallers, new and lost rows with thresholds", () => {
    const cur = new Map([
      ["/a", 100],
      ["/b", 20],
      ["/new", 40],
      ["/tiny", 3],
    ]);
    const prev = new Map([
      ["/a", 50],
      ["/b", 80],
      ["/lost", 30],
      ["/tiny", 1],
    ]);
    const m = computeMovers(cur, prev, { minBase: 10, minAbs: 5 });
    expect(m.risers.map((r) => r.value)).toEqual(["/a", "/new"]);
    expect(m.fallers.map((r) => r.value)).toEqual(["/b", "/lost"]);
    expect(m.risers[1].isNew).toBe(true);
    expect(m.fallers[1].isLost).toBe(true);
  });
});

describe("signals + fingerprint", () => {
  const metrics = {
    "gsc.clicks": compareMetric("gsc.clicks", 170, 100),
    "ga4.sessions": compareMetric("ga4.sessions", 1000, 1002),
    "geo.score": compareMetric("geo.score", 72, 60),
  };

  it("keeps only significant, source-tagged changes", () => {
    const s = buildSignals({ metrics });
    expect(s.map((x) => x.id)).toEqual(["metric:gsc.clicks", "metric:geo.score"]);
    expect(s[0].source).toBe("gsc");
    expect(s[1].source).toBe("geo");
    expect(s[0].fact).toContain("100");
    expect(s[0].fact).toContain("170");
  });

  it("is stable under noise and changes when the story changes", () => {
    const a = fingerprintSignals(buildSignals({ metrics }));
    const noisy = fingerprintSignals(
      buildSignals({
        metrics: { ...metrics, "gsc.clicks": compareMetric("gsc.clicks", 162, 100) },
      }),
    );
    expect(noisy).toBe(a);
    const flipped = fingerprintSignals(
      buildSignals({ metrics: { ...metrics, "gsc.clicks": compareMetric("gsc.clicks", 50, 100) } }),
    );
    expect(flipped).not.toBe(a);
    expect(fingerprintSignals([])).toBe(fingerprintSignals([]));
  });
});

describe("metric catalogue", () => {
  it("assigns every metric exactly one known source", () => {
    for (const key of METRIC_KEYS) {
      expect(DATA_SOURCE_IDS).toContain(METRICS[key].source);
      expect(key.startsWith(`${METRICS[key].source}.`)).toBe(true);
    }
  });

  it("formats values by kind", () => {
    expect(formatMetric("gsc.ctr", 0.0345)).toBe("3.5%");
    expect(formatMetric("gsc.position", 7.26)).toBe("7.3");
    expect(formatMetric("ga4.avgSessionDuration", 125)).toBe("2m 05s");
    expect(formatMetric("geo.score", 71.6)).toBe("72/100");
    expect(formatMetric("ga4.sessions", 12_345)).toBe("12.3k");
    expect(formatMetric("ga4.sessions", null)).toBe("—");
  });
});
