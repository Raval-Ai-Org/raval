import { describe, expect, it, vi } from "vitest";
import { outcomeFor } from "./async-charges.server";
import { lowBalanceLevel, monthlyAllowance } from "./notify.server";
import { referralEligible } from "./lifecycle.server";

vi.mock("./schema.server", () => ({ billingSchemaReady: async () => false }));

const HOUR = 3_600_000;

describe("background job charges settle from the job's own status", () => {
  it("charges a GEO Engineer run once it has a fix to review", () => {
    expect(outcomeFor("geo_agent_run", { status: "running" }, HOUR)).toEqual({ final: false });
    expect(outcomeFor("geo_agent_run", { status: "awaiting_patch_approval" }, HOUR)).toEqual({
      final: true,
      ok: true,
    });
    // Failed after a fix was already written: the paid work was done.
    expect(
      outcomeFor("geo_agent_run", { status: "failed", proposal_id: "p1" }, HOUR),
    ).toMatchObject({ final: true, ok: true });
    expect(outcomeFor("geo_agent_run", { status: "not_fixable" }, HOUR)).toEqual({
      final: true,
      ok: false,
    });
  });

  it("charges Fix all only for the findings it fixed", () => {
    const items = [{ status: "generated" }, { status: "skipped" }, { status: "generated" }];
    expect(outcomeFor("fix_batch", { status: "draft", items }, HOUR)).toEqual({
      final: true,
      ok: true,
      units: 2,
    });
    expect(outcomeFor("fix_batch", { status: "failed", items }, HOUR)).toEqual({
      final: true,
      ok: false,
    });
    expect(outcomeFor("fix_batch", { status: "generating", items: [] }, HOUR)).toEqual({
      final: false,
    });
    // Stuck generating for hours: give the credits back.
    expect(outcomeFor("fix_batch", { status: "generating", items: [] }, 3 * HOUR)).toMatchObject({
      ok: false,
    });
  });

  it("releases reports and analyses that fail or never finish", () => {
    expect(outcomeFor("competitor_intel", { status: "succeeded" }, 0)).toMatchObject({ ok: true });
    expect(outcomeFor("competitor_intel", { status: "running" }, 10 * 60_000)).toEqual({
      final: false,
    });
    expect(outcomeFor("competitor_intel", { status: "running" }, HOUR)).toMatchObject({
      ok: false,
    });
    expect(outcomeFor("competitor_profile", { profile_status: "ready" }, 0)).toMatchObject({
      ok: true,
    });
    expect(outcomeFor("brand_voice", { analysis_status: "failed" }, 0)).toMatchObject({
      ok: false,
    });
    // The job row disappeared (deleted brand): release after an hour.
    expect(outcomeFor("brand_voice", null, 2 * HOUR)).toMatchObject({ ok: false });
  });

  it("waits for fresh profile research before charging a full refresh", () => {
    const linkedAt = "2026-10-01T12:00:00Z";
    expect(
      outcomeFor(
        "competitor_profile",
        { profile_status: "ready", updated_at: "2026-09-30T12:00:00Z" },
        0,
        linkedAt,
      ),
    ).toEqual({ final: false });
    expect(
      outcomeFor(
        "competitor_profile",
        { profile_status: "failed", updated_at: "2026-09-30T12:00:00Z" },
        0,
        linkedAt,
      ),
    ).toEqual({ final: false });
    expect(
      outcomeFor(
        "competitor_profile",
        { profile_status: "ready", updated_at: "2026-10-01T12:01:00Z" },
        60_000,
        linkedAt,
      ),
    ).toEqual({ final: true, ok: true });
    expect(
      outcomeFor(
        "competitor_profile",
        { profile_status: "ready", updated_at: "2026-09-30T12:00:00Z" },
        25 * HOUR,
        linkedAt,
      ),
    ).toEqual({ final: true, ok: false });
  });
});

describe("billing notices", () => {
  it("warns at 80% used and at empty, once there is an allowance", () => {
    expect(lowBalanceLevel(2000, 2000)).toBeNull();
    expect(lowBalanceLevel(401, 2000)).toBeNull();
    expect(lowBalanceLevel(400, 2000)).toBe("meter_80");
    expect(lowBalanceLevel(0, 2000)).toBe("meter_100");
    expect(lowBalanceLevel(0, 0)).toBeNull();
    expect(monthlyAllowance("free", "credits")).toBe(100);
    expect(monthlyAllowance("growth", "video")).toBe(1200);
  });

  it("rewards referrals only after the refund window and under the yearly cap", () => {
    const now = new Date("2026-10-30T00:00:00Z");
    const paid = (days: number) => new Date(now.getTime() - days * 86_400_000);
    expect(referralEligible({ paidAt: null, rewardedThisYear: 0, now })).toBe(false);
    expect(referralEligible({ paidAt: paid(3), rewardedThisYear: 0, now })).toBe(false);
    expect(referralEligible({ paidAt: paid(15), rewardedThisYear: 0, now })).toBe(true);
    expect(referralEligible({ paidAt: paid(15), rewardedThisYear: 20, now })).toBe(false);
  });
});
