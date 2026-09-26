import { afterEach, describe, expect, it, vi } from "vitest";
import { PLAN_ORDER, PLANS } from "@/lib/billing/catalog";
import type { BillingAccount } from "./accounts.server";
import { entitledPlanFor, limitsFor, resolveEntitlements } from "./entitlements.server";
import { nextMonthlyWindow } from "./grants.server";

function account(patch: Partial<BillingAccount> = {}): BillingAccount {
  return {
    id: "account-1",
    owner_user_id: "owner-1",
    plan_id: "growth",
    entitled_plan_id: null,
    billing_interval: "month",
    status: "active",
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
    created_at: "2026-01-01T00:00:00.000Z",
    ...patch,
  };
}

afterEach(() => vi.unstubAllEnvs());

describe("billing entitlements", () => {
  it.each(PLAN_ORDER)("resolves the %s plan's features and base limits", (plan) => {
    const ent = resolveEntitlements({
      account: account({ plan_id: plan }),
      userId: "owner-1",
      role: "owner",
    });
    expect(ent.entitledPlan).toBe(plan);
    expect(ent.limits.brands).toBe(PLANS[plan].brands);
    expect(ent.isOwner).toBe(true);
  });

  it("uses a live comp, then expires it at the specified instant", () => {
    const row = account({
      plan_id: "free",
      comped_plan_id: "agency",
      comped_until: "2026-02-01T00:00:00Z",
    });
    expect(entitledPlanFor(row, new Date("2026-01-31T23:59:59Z"))).toBe("agency");
    expect(entitledPlanFor(row, new Date("2026-02-01T00:00:00Z"))).toBe("free");
  });

  it("applies past-due grace and paused limits", () => {
    const row = account({ status: "past_due", grace_until: "2026-02-01T00:00:00Z" });
    expect(entitledPlanFor(row, new Date("2026-01-31T00:00:00Z"))).toBe("growth");
    expect(entitledPlanFor(row, new Date("2026-02-02T00:00:00Z"))).toBe("free");
    const paused = resolveEntitlements({
      account: account({ status: "paused" }),
      userId: "owner-1",
      role: "owner",
    });
    expect(paused.limits.trackedPrompts).toBe(10);
    expect(paused.features.studio.allowed).toBe(false);
  });

  it("applies only live, eligible add-ons", () => {
    const limits = limitsFor("growth", [
      { catalog_key: "extra_brand", quantity: 2 },
      { catalog_key: "extra_seat", quantity: 1 },
      { catalog_key: "white_label_domain", quantity: 100 },
    ]);
    expect(limits.brands).toBe(PLANS.growth.brands + 2);
    expect(limits.socialProfiles).toBe(PLANS.growth.limits.socialProfiles + 2);
    expect(limits.seats).toBe((PLANS.growth.seats ?? 0) + 1);
  });

  it("uses the account override before the global mode", () => {
    vi.stubEnv("BILLING_ENFORCEMENT", "shadow");
    const ent = resolveEntitlements({
      account: account({ enforcement_override: "on" }),
      userId: "member-1",
      role: "editor",
      frozen: true,
    });
    expect(ent.enforcement).toBe("on");
    expect(ent.frozen).toBe(true);
    expect(ent.isOwner).toBe(false);
  });
});

describe("monthly grant anniversaries", () => {
  it("clamps the 31st without drifting to the 28th forever", () => {
    const anchor = "2026-01-31T12:00:00Z";
    const february = nextMonthlyWindow(anchor, anchor);
    expect(february).toBe("2026-02-28T12:00:00.000Z");
    expect(nextMonthlyWindow(anchor, february)).toBe("2026-03-31T12:00:00.000Z");
  });
});
