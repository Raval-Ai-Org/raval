import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import xlsx from "xlsx";
import { describe, expect, it } from "vitest";
import { ADDONS, CREDIT_PACKS, PLANS, VIDEO_PACKS } from "./catalog";

// The attached v2.3 workbook changes only Add-ons & Packs!C5 copy from the
// checked-in source workbook. All numeric assertions therefore cover v2.3.
const workbook = xlsx.read(
  readFileSync(resolve(process.cwd(), "docs/pricing/v2/Mellox_AI_Pricing_Model_v2.xlsx")),
  { type: "buffer" },
);
const rows = (sheet: string) =>
  xlsx.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheet], { header: 1 });
const numberAt = (sheet: string, row: number, column: number) =>
  Number(rows(sheet)[row - 1]?.[column - 1]);

describe("billing catalog against the v2.3 workbook", () => {
  it("matches paid plan prices, grants and capacity", () => {
    for (const [column, id] of [
      [4, "starter"],
      [5, "growth"],
      [6, "agency"],
      [7, "scale"],
    ] as const) {
      const plan = PLANS[id];
      expect(plan.priceMonthlyUsd).toBe(numberAt("Plans", 6, column));
      expect(plan.priceAnnualUsd).toBe(plan.priceMonthlyUsd * 10);
      expect(plan.brands).toBe(numberAt("Plans", 8, column));
      expect(plan.seats ?? 9999).toBe(numberAt("Plans", 9, column));
      expect(plan.allowances.credits).toBe(numberAt("Plans", 10, column));
      expect(plan.allowances.videoUnits).toBe(numberAt("Plans", 11, column) * 100);
      expect(plan.allowances.proMessages).toBe(numberAt("Plans", 12, column));
      expect(plan.allowances.flashMessages).toBe(numberAt("Plans", 13, column));
      expect(plan.limits.trackedPrompts).toBe(numberAt("Plans", 15, column));
      expect(plan.limits.socialProfiles).toBe(numberAt("Plans", 28, column));
      expect(plan.limits.maxConcurrentRenders).toBe(numberAt("Plans", 30, column));
    }
  });

  it("matches paid pack value and separates AI-only bonuses", () => {
    for (const [row, pack] of CREDIT_PACKS.map((pack, i) => [15 + i, pack] as const)) {
      expect(pack.usd).toBe(numberAt("Add-ons & Packs", row, 2));
      expect(pack.credits + pack.bonusCredits).toBe(numberAt("Add-ons & Packs", row, 4));
      expect(pack.credits).toBe(pack.usd * 100);
    }
    for (const [row, pack] of VIDEO_PACKS.map((pack, i) => [21 + i, pack] as const)) {
      expect(pack.usd).toBe(numberAt("Add-ons & Packs", row, 2));
      expect(pack.videoUnits).toBe(numberAt("Add-ons & Packs", row, 3) * 100);
    }
  });

  it("matches add-on prices and extra-brand capacity", () => {
    for (const [row, key] of [
      [5, "extra_brand"],
      [6, "prompts_100"],
      [7, "daily_tracking_100"],
      [8, "ai_overviews_100"],
      [9, "daily_market_brain"],
      [10, "pro_200"],
      [11, "extra_seat"],
      [12, "white_label_domain"],
    ] as const) {
      expect(ADDONS[key].usdPerMonth).toBe(numberAt("Add-ons & Packs", row, 2));
    }
    expect(ADDONS.extra_brand.adds.socialProfiles).toBe(1);
    expect(ADDONS.extra_brand.adds.marketBrainWeeklyBrands).toBe(1);
  });
});
