import { describe, expect, it, vi } from "vitest";
import type { BillingAccount } from "./accounts.server";
import { entitledPlanFor, resolveEntitlements } from "./entitlements.server";
import { addMonths, validPurchase } from "./manual.server";

vi.mock("./schema.server", () => ({ billingSchemaReady: async () => false }));

const base: BillingAccount = {
  id: "acct",
  owner_user_id: "owner",
  plan_id: "free",
  entitled_plan_id: "free",
  billing_interval: null,
  status: "free",
  trial_ends_at: null,
  trial_used: false,
  current_period_start: null,
  current_period_end: null,
  grant_anchor: null,
  next_grant_at: null,
  grace_until: null,
  comped_plan_id: null,
  comped_until: null,
  enforcement_override: null,
  pro_overage_mode: "credits",
  created_at: "2026-09-01T00:00:00.000Z",
};

describe("manual (paid offline) plans", () => {
  it("adds calendar months and clamps to the month's last day", () => {
    expect(addMonths(new Date("2026-01-31T10:00:00Z"), 1).toISOString()).toBe(
      "2026-02-28T10:00:00.000Z",
    );
    expect(addMonths(new Date("2026-09-29T00:00:00Z"), 12).toISOString()).toBe(
      "2027-09-29T00:00:00.000Z",
    );
  });

  it("only accepts real catalog items", () => {
    expect(validPurchase("plan", "growth")).toBe(true);
    expect(validPurchase("plan", "free")).toBe(false);
    expect(validPurchase("credit_pack", "credits_100")).toBe(true);
    expect(validPurchase("video_pack", "credits_100")).toBe(false);
  });

  it("entitles the manual plan until its date, then falls back to Free", () => {
    const now = new Date("2026-10-10T00:00:00Z");
    const manual = { ...base, comped_plan_id: "growth", comped_until: "2026-11-10T00:00:00Z" };
    expect(entitledPlanFor(manual, now)).toBe("growth");
    const view = resolveEntitlements({ account: manual, userId: "owner", role: "owner", now });
    expect(view.manual).toEqual({ plan: "growth", until: "2026-11-10T00:00:00Z" });
    expect(view.features.campaigns.allowed).toBe(true);
    const later = new Date("2026-11-11T00:00:00Z");
    expect(entitledPlanFor(manual, later)).toBe("free");
    expect(
      resolveEntitlements({ account: manual, userId: "owner", role: "owner", now: later }).manual,
    ).toBeNull();
  });

  it("gives Free accounts publishing with a fair-use cap and no paid features", () => {
    const view = resolveEntitlements({ account: base, userId: "owner", role: "owner" });
    expect(view.features.publishing.allowed).toBe(true);
    expect(view.features.campaigns.allowed).toBe(false);
    expect(view.limits.postsFairUse).toBe(100);
  });
});
