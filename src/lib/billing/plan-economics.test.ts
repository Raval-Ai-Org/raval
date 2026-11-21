import { describe, expect, it } from "vitest";
import { PUBLIC_PLANS } from "./catalog";
import { MARGIN_RULES, planEconomics, planOutcomes, underpricedActions } from "./plan-economics";

describe("pricing v4 economics (pessimistic costs)", () => {
  it("prints the margin table", () => {
    const pct = (n: number) => `${Math.round(n * 100)}%`;
    const rows = PUBLIC_PLANS.map((plan) => {
      const row: Record<string, string> = { plan };
      for (const scenario of ["typical", "heavy", "stress"] as const)
        for (const interval of ["month", "year"] as const) {
          const e = planEconomics(plan, interval, scenario);
          row[`${scenario} ${interval}`] = `${pct(e.margin)} ($${e.cost.toFixed(2)})`;
        }
      return row;
    });
    console.table(rows);
    expect(rows).toHaveLength(3);
  });

  it.each(PUBLIC_PLANS)("%s keeps the margin rules", (plan) => {
    expect(planEconomics(plan, "year", "typical").margin).toBeGreaterThanOrEqual(
      MARGIN_RULES.typicalYearly,
    );
    expect(planEconomics(plan, "month", "heavy").margin).toBeGreaterThanOrEqual(
      MARGIN_RULES.heavyMonthly,
    );
  });

  it("prices every action and video at or under the per-credit guard", () => {
    expect(underpricedActions()).toEqual([]);
  });

  it("shows what each plan makes", () => {
    expect(planOutcomes("starter")).toEqual({ credits: 150, imagePosts: 150, videos: 5 });
    expect(planOutcomes("growth")).toEqual({ credits: 500, imagePosts: 500, videos: 16 });
    expect(planOutcomes("agency")).toEqual({ credits: 1500, imagePosts: 1500, videos: 50 });
    expect(planOutcomes("free").credits).toBe(0);
  });
});
