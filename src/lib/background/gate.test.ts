import { describe, expect, it } from "vitest";
import {
  communityGate,
  competitorSweepGate,
  DAY_MS,
  laterOf,
  marketBrainGate,
  type BackgroundAccount,
} from "./gate";

const now = Date.parse("2026-11-12T12:00:00Z");
const daysAgo = (d: number) => new Date(now - d * DAY_MS).toISOString();

function account(patch: Partial<BackgroundAccount> = {}): BackgroundAccount {
  return {
    plan: "starter",
    frozen: false,
    paused: false,
    limits: { marketBrainWeeklyBrands: 1, competitorSweepsPerWeek: 1, competitors: 3 },
    lastActiveAt: daysAgo(1),
    ...patch,
  };
}

describe("background gate", () => {
  it("runs Market Brain weekly, never daily", () => {
    expect(marketBrainGate(account(), now)).toEqual({ run: true, intervalMs: 7 * DAY_MS });
  });

  it("spends nothing for frozen, paused, unknown or abandoned accounts", () => {
    expect(marketBrainGate(account({ frozen: true }), now)).toMatchObject({
      run: false,
      reason: "frozen",
    });
    expect(marketBrainGate(account({ paused: true }), now)).toMatchObject({
      run: false,
      reason: "paused",
    });
    expect(marketBrainGate(null, now)).toMatchObject({ run: false, reason: "unknown_account" });
    expect(marketBrainGate(account({ lastActiveAt: daysAgo(15) }), now)).toMatchObject({
      run: false,
      reason: "inactive",
    });
    expect(marketBrainGate(account({ lastActiveAt: null }), now)).toMatchObject({
      run: false,
      reason: "inactive",
    });
  });

  it("leaves out work the plan doesn't include", () => {
    const free = account({
      plan: "free",
      limits: { marketBrainWeeklyBrands: 0, competitorSweepsPerWeek: 0, competitors: 0 },
    });
    expect(marketBrainGate(free, now)).toMatchObject({ run: false, reason: "not_in_plan" });
    expect(competitorSweepGate(free, now)).toMatchObject({ run: false, reason: "not_in_plan" });
    expect(communityGate(account(), now)).toMatchObject({ run: false, reason: "not_in_plan" });
  });

  it("spaces competitor sweeps by the plan's sweeps per week", () => {
    expect(competitorSweepGate(account(), now)).toEqual({ run: true, intervalMs: 7 * DAY_MS });
    const growth = account({
      plan: "growth",
      limits: { marketBrainWeeklyBrands: 3, competitorSweepsPerWeek: 2, competitors: 10 },
    });
    expect(competitorSweepGate(growth, now)).toEqual({ run: true, intervalMs: 3.5 * DAY_MS });
    expect(communityGate(growth, now)).toEqual({ run: true, intervalMs: 7 * DAY_MS });
  });

  it("never shortens a longer back-off", () => {
    const longer = new Date(now + 10 * DAY_MS).toISOString();
    expect(laterOf(longer, 7 * DAY_MS, now)).toBe(longer);
    expect(laterOf(new Date(now + DAY_MS).toISOString(), 7 * DAY_MS, now)).toBe(
      new Date(now + 7 * DAY_MS).toISOString(),
    );
  });
});
