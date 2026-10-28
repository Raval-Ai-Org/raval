import { describe, expect, it } from "vitest";
import {
  fieldChangeSince,
  parseCruxHistory,
  parseCruxRecord,
  parsePsi,
  routeGroup,
  sampleLabPages,
  summarizeLab,
  vitalRating,
} from "./performance";

describe("route sampling", () => {
  it("groups pages that share a template", () => {
    expect(routeGroup("https://a.io/")).toBe("/");
    expect(routeGroup("https://a.io/pricing")).toBe("/pricing");
    expect(routeGroup("https://a.io/blog/how-to-invoice")).toBe("/blog/:slug");
    expect(routeGroup("https://a.io/blog/another-post")).toBe("/blog/:slug");
    expect(routeGroup("https://a.io/products/123/reviews")).toBe("/products/:id/:slug");
  });

  it("measures the homepage and one page per template, in importance order", () => {
    const picked = sampleLabPages(
      [
        "https://a.io/",
        "https://a.io/blog/one",
        "https://a.io/blog/two",
        "https://a.io/pricing",
        "https://a.io/docs/setup",
      ],
      3,
    );
    expect(picked.map((p) => p.url)).toEqual([
      "https://a.io/",
      "https://a.io/blog/one",
      "https://a.io/pricing",
    ]);
  });
});

describe("Chrome UX Report", () => {
  it("reads p75s and rates them on Google's thresholds", () => {
    const f = parseCruxRecord(
      {
        record: {
          key: { origin: "https://a.io" },
          metrics: {
            largest_contentful_paint: { percentiles: { p75: 3100 } },
            interaction_to_next_paint: { percentiles: { p75: 150 } },
            cumulative_layout_shift: { percentiles: { p75: "0.31" } },
          },
          collectionPeriod: { lastDate: { year: 2026, month: 10, day: 20 } },
        },
      },
      "origin",
    )!;
    expect(f.lcp).toEqual({ p75: 3100, rating: "needs_improvement" });
    expect(f.inp?.rating).toBe("good");
    expect(f.cls).toEqual({ p75: 0.31, rating: "poor" });
    expect(f.periodEnd).toBe("2026-10-20");
    expect(parseCruxRecord({}, "origin")).toBeNull();
    expect(vitalRating("lcp", 2500)).toBe("good");
  });

  it("turns history into weekly series and compares before/after a fix", () => {
    const dates = [
      "2026-06-01",
      "2026-06-08",
      "2026-06-15",
      "2026-08-10",
      "2026-08-17",
      "2026-08-24",
    ];
    const history = parseCruxHistory({
      record: {
        collectionPeriods: dates.map((d) => {
          const [year, month, day] = d.split("-").map(Number);
          return { lastDate: { year, month, day } };
        }),
        metrics: {
          largest_contentful_paint: {
            percentilesTimeseries: { p75s: [4000, 4100, 3900, 2600, 2500, 2550] },
          },
          cumulative_layout_shift: {
            percentilesTimeseries: { p75s: ["0.05", "0.05", "0.05", "0.05", "0.05", "0.05"] },
          },
        },
      },
    })!;
    expect(history.dates).toEqual(dates);
    const changes = fieldChangeSince(history, "2026-06-20T00:00:00Z");
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ metric: "lcp", before: 4000, after: 2550, improved: true });
    // Not enough settled weeks after the fix yet.
    expect(fieldChangeSince(history, "2026-08-01T00:00:00Z")).toEqual([]);
  });
});

describe("PageSpeed Insights", () => {
  it("keeps scores, vitals, the largest savings and failed SEO audits", () => {
    const run = parsePsi(
      {
        lighthouseResult: {
          categories: {
            performance: { score: 0.42 },
            accessibility: { score: 0.9 },
            "best-practices": { score: 1 },
            seo: {
              score: 0.83,
              auditRefs: [
                { id: "meta-description", weight: 1 },
                { id: "hreflang", weight: 1 },
              ],
            },
          },
          audits: {
            "largest-contentful-paint": { numericValue: 5234.6 },
            "cumulative-layout-shift": { numericValue: 0.1234 },
            "render-blocking-resources": {
              title: "Eliminate render-blocking resources",
              score: 0.2,
              details: { type: "opportunity", overallSavingsMs: 1200 },
            },
            "unused-css-rules": {
              title: "Reduce unused CSS",
              score: 0.5,
              details: { type: "opportunity", overallSavingsMs: 40 },
            },
            "meta-description": { title: "Document has a meta description", score: 0 },
            hreflang: { title: "Valid hreflang", score: null, scoreDisplayMode: "notApplicable" },
          },
        },
      },
      "https://a.io/",
      "/",
    );
    expect(run.ok).toBe(true);
    expect(run.scores).toEqual({ performance: 42, accessibility: 90, bestPractices: 100, seo: 83 });
    expect(run.metrics?.lcpMs).toBe(5235);
    expect(run.metrics?.cls).toBe(0.123);
    expect(run.opportunities).toEqual([
      {
        id: "render-blocking-resources",
        title: "Eliminate render-blocking resources",
        savingsMs: 1200,
      },
    ]);
    expect(run.failedAudits).toEqual([
      { id: "meta-description", title: "Document has a meta description", category: "seo" },
    ]);
    expect(summarizeLab([run, { url: "x", group: "/x", ok: false }])).toEqual({
      pages: 2,
      ok: 1,
      medianPerformance: 42,
    });
    expect(parsePsi({}, "u", "/").ok).toBe(false);
  });
});
