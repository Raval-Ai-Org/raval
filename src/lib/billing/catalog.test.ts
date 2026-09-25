import { describe, expect, it } from "vitest";
import {
  FEATURES,
  MAX_USD_PER_VC,
  PLAN_ORDER,
  PLANS,
  VIDEO_OPTIONS,
  annualMonthlyUsd,
  planRank,
  videoUnitsFor,
} from "./catalog";

describe("billing catalog invariants", () => {
  it("orders five plans with annual prices equal to ten monthly payments", () => {
    expect(PLAN_ORDER).toEqual(["free", "starter", "growth", "agency", "scale"]);
    for (const id of PLAN_ORDER) {
      expect(PLANS[id].priceAnnualUsd).toBe(10 * PLANS[id].priceMonthlyUsd);
      expect(annualMonthlyUsd(id)).toBe(Math.round((PLANS[id].priceAnnualUsd / 12) * 100) / 100);
    }
    expect(PLANS.free.priceMonthlyUsd).toBe(0);
    expect(PLANS.scale.priceMonthlyUsd).toBe(1199);
  });

  it("keeps account allowances and limits monotonic", () => {
    const ordered = PLAN_ORDER.map((id) => PLANS[id]);
    const values = [
      (p: (typeof ordered)[number]) => p.brands,
      (p: (typeof ordered)[number]) => p.allowances.credits,
      (p: (typeof ordered)[number]) => p.allowances.videoUnits,
      (p: (typeof ordered)[number]) => p.limits.socialProfiles,
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
