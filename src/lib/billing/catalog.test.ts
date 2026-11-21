import { describe, expect, it } from "vitest";
import {
  FEATURES,
  MAX_USD_PER_VC,
  PLAN_ORDER,
  PLANS,
  PUBLIC_PLANS,
  UNITS_PER_CREDIT,
  hasActivePlan,
  VIDEO_OPTIONS,
  annualMonthlyUsd,
  planRank,
  videoUnitsFor,
} from "./catalog";

describe("billing catalog invariants", () => {
  it("sells three public plans at $49 / $149 / $399, yearly at $39 / $119 / $319 a month", () => {
    expect(PLAN_ORDER).toEqual(["free", "starter", "growth", "agency", "scale"]);
    expect(PUBLIC_PLANS).toEqual(["starter", "growth", "agency"]);
    const expected = { starter: [49, 39, 150], growth: [149, 119, 500], agency: [399, 319, 1500] };
    for (const [id, [monthly, yearly, credits]] of Object.entries(expected)) {
      const plan = PLANS[id as keyof typeof expected];
      expect(plan.priceMonthlyUsd).toBe(monthly);
      expect(plan.priceAnnualUsd).toBe(yearly * 12);
      expect(annualMonthlyUsd(id as keyof typeof expected)).toBe(yearly);
      expect(plan.allowances.credits).toBe(credits * UNITS_PER_CREDIT);
    }
    // No Free plan: "free" is only the locked, no-plan state.
    expect(PLANS.free.priceMonthlyUsd).toBe(0);
    expect(PLANS.free.allowances.credits).toBe(0);
    expect(hasActivePlan("free")).toBe(false);
    expect(hasActivePlan("starter")).toBe(true);
  });

  it("keeps account allowances and limits monotonic", () => {
    const ordered = PLAN_ORDER.map((id) => PLANS[id]);
    const values = [
      (p: (typeof ordered)[number]) => p.brands,
      (p: (typeof ordered)[number]) => p.allowances.credits,
      (p: (typeof ordered)[number]) => p.allowances.videoUnits,
      (p: (typeof ordered)[number]) => p.limits.postsFairUse,
      (p: (typeof ordered)[number]) => p.limits.trackedPrompts,
    ];
    for (const value of values) {
      for (let i = 1; i < ordered.length; i++) {
        expect(value(ordered[i])).toBeGreaterThanOrEqual(value(ordered[i - 1]));
      }
    }
    for (const feature of Object.values(FEATURES)) {
      expect(planRank(feature.minPlan)).toBeGreaterThanOrEqual(0);
    }
  });

  it("has one provider route per video option and never prices below the cost floor", () => {
    const keys = VIDEO_OPTIONS.map((v) => `${v.ugcKey}:${v.seconds}:${v.resolution}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const option of VIDEO_OPTIONS) {
      for (const providerCostUsd of [0, 0.5, 1, 2, 5]) {
        const units = videoUnitsFor({ ...option, providerCostUsd });
        expect(units).toBeGreaterThanOrEqual(option.videoUnits);
        expect((units / 100) * MAX_USD_PER_VC).toBeGreaterThanOrEqual(providerCostUsd);
      }
      if (option.provider === "kie") expect(option.fallback).toMatch(/^openrouter /);
    }
    for (const option of VIDEO_OPTIONS.filter((v) => v.ugcKey === "variation")) {
      expect(option.fallback).not.toContain("grok");
    }
  });
});

describe("premium video on Starter", () => {
  it("opens Premium and Cinematic video on every paid plan", async () => {
    const { planAllows } = await import("./catalog");
    // Credits price every video, so every plan can make every kind.
    expect(planAllows("starter", "video_premium")).toBe(true);
    expect(planAllows("free", "video_premium")).toBe(false);
    expect(planAllows("starter", "video_cinematic")).toBe(true);
  });
});
