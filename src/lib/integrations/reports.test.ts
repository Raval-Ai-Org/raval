import { describe, expect, it } from "vitest";
import {
  appReportDue,
  changePercent,
  costPerConversion,
  ctrOf,
  googleAdsReportQuery,
  readAppReport,
  readGoogleAdsReport,
  reportWindow,
} from "./reports";
import { readKeywordIdeas, googleAdsKeywordArgs } from "./business";

const args = {
  customerId: "1234567890",
  from: "2026-10-11",
  to: "2026-11-09",
  measuredAt: "2026-11-10T00:00:00Z",
};

describe("Google Ads report", () => {
  it("builds dated GAQL and refuses anything else", () => {
    expect(googleAdsReportQuery("2026-10-11", "2026-11-09")).toContain(
      "BETWEEN '2026-10-11' AND '2026-11-09'",
    );
    expect(() => googleAdsReportQuery("x' OR 1=1", "2026-11-09")).toThrow();
  });

  it("windows end yesterday", () => {
    const w = reportWindow(Date.parse("2026-11-11T12:00:00Z"));
    expect(w.to).toBe("2026-11-10");
    expect(w.from).toBe("2026-10-12");
  });

  it("reads a JSON-string answer and folds rows per campaign", () => {
    const data = JSON.stringify({
      results: [
        {
          campaign: { id: "1", name: "Brand", status: "ENABLED" },
          customer: { currencyCode: "EUR" },
          metrics: { impressions: "1000", clicks: "50", costMicros: "25000000", conversions: 5 },
        },
        {
          campaign: { id: "1", name: "Brand", status: "ENABLED" },
          metrics: { impressions: "1000", clicks: "50", costMicros: "25000000", conversions: 5 },
        },
        { campaign: { id: "2", name: "New", status: "PAUSED" }, metrics: {} },
      ],
    });
    const r = readGoogleAdsReport({ data }, args)!;
    expect(r.currency).toBe("EUR");
    expect(r.campaignCount).toBe(2);
    expect(r.totals).toEqual({ impressions: 2000, clicks: 100, cost: 50, conversions: 10 });
    expect(r.campaigns[1].cost).toBeUndefined();
    expect(ctrOf(r.totals)).toBe(5);
    expect(costPerConversion(r.totals)).toBe(5);
  });

  it("an empty account is a report, garbage is not", () => {
    expect(
      readGoogleAdsReport({ data: JSON.stringify({ results: [] }) }, args)?.campaignCount,
    ).toBe(0);
    expect(readGoogleAdsReport({ data: "not json" }, args)).toBeNull();
  });

  it("stored reports round-trip and go stale", () => {
    const r = readGoogleAdsReport({ data: '{"results":[]}' }, args)!;
    expect(readAppReport({ report: r })).toEqual(r);
    expect(readAppReport({ report: { kind: "other" } })).toBeNull();
    expect(appReportDue(r, Date.parse("2026-11-10T01:00:00Z"))).toBe(false);
    expect(appReportDue(r, Date.parse("2026-11-10T07:00:00Z"))).toBe(true);
  });

  it("change needs a previous window", () => {
    expect(changePercent(15, 10)).toBe(50);
    expect(changePercent(15, 0)).toBeNull();
    expect(changePercent(15, null)).toBeNull();
  });
});

describe("Google Ads keywords", () => {
  it("keeps only Google's own ideas, cleaned and best first", () => {
    const ideas = readKeywordIdeas({
      data: JSON.stringify({
        results: [
          { text: "Running Shoes", keywordIdeaMetrics: { avgMonthlySearches: "100" } },
          { text: "trail shoes", keywordIdeaMetrics: { avgMonthlySearches: "900" } },
          { text: "shoes!!!", keywordIdeaMetrics: { avgMonthlySearches: "5000" } },
          { text: "running shoes" },
        ],
      }),
    });
    expect(ideas).toEqual(["trail shoes", "running shoes"]);
    const ops = googleAdsKeywordArgs("1", "customers/1/adGroups/2", ideas).operations as unknown[];
    expect(ops).toHaveLength(2);
  });
});
