import { describe, expect, it, vi } from "vitest";
import type { BillingAccount } from "./accounts.server";

vi.mock("server-only", () => ({}));
vi.mock("./schema.server", () => ({ billingSchemaReady: async () => false }));
const { entitledPlanFor, onTrialTier, resolveEntitlements } = await import("./entitlements.server");

const NOW = new Date("2026-11-18T12:00:00Z");
const later = (days: number) => new Date(NOW.getTime() + days * 86_400_000).toISOString();

function account(patch: Partial<BillingAccount> = {}): BillingAccount {
  return {
    id: "account-1",
    owner_user_id: "owner-1",
    plan_id: "starter",
    entitled_plan_id: "starter",
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
    enforcement_override: "on",
    pro_overage_mode: "credits",
    created_at: "2026-01-01T00:00:00.000Z",
    ...patch,
  };
}

const resolve = (a: BillingAccount) =>
  resolveEntitlements({ account: a, userId: "owner-1", role: "owner", now: NOW });

describe("trial tier", () => {
  it("a code's trial gets free features only: posts yes, video and Autopilot no", () => {
    const ent = resolve(
      account({
        status: "trialing",
        trial_tier: "promo",
        trial_ends_at: later(3),
        trial_used: true,
      }),
    );
    expect(ent.trialTier).toBe(true);
    expect(ent.features.studio.allowed).toBe(true);
    expect(ent.features.publishing.allowed).toBe(true);
    expect(ent.features.ugc.allowed).toBe(false);
    expect(ent.features.video_premium.allowed).toBe(false);
    expect(ent.features.autopilot.allowed).toBe(false);
    expect(ent.features.competitors.allowed).toBe(false);
    expect(ent.limits.brands).toBe(1);
    expect(ent.limits.seats).toBe(1);
  });

  it("the paid plan opens everything once the trial converts", () => {
    const ent = resolve(
      account({ status: "active", trial_tier: null, last_paid_invoice_id: "in_1" }),
    );
    expect(ent.trialTier).toBe(false);
    expect(ent.features.ugc.allowed).toBe(true);
  });

  it("a staff trial pass is the trial tier until it ends", () => {
    const pass = account({
      plan_id: "free",
      entitled_plan_id: "free",
      status: "free",
      comped_plan_id: "starter",
      comped_until: later(5),
      comped_tier: "trial",
    });
    expect(onTrialTier(pass, NOW)).toBe(true);
    expect(entitledPlanFor(pass, NOW)).toBe("starter");
    expect(resolve(pass).features.ugc.allowed).toBe(false);
    const ended = { ...pass, comped_until: later(-1) };
    expect(onTrialTier(ended, NOW)).toBe(false);
    expect(entitledPlanFor(ended, NOW)).toBe("free");
  });

  it("a staff plan pass opens the whole plan", () => {
    const pass = account({
      plan_id: "free",
      entitled_plan_id: "free",
      status: "free",
      comped_plan_id: "growth",
      comped_until: later(5),
      comped_tier: null,
    });
    expect(resolve(pass).features.ugc.allowed).toBe(true);
  });

  it("a trial whose first charge failed gets no grace on the plan", () => {
    const failed = account({
      status: "past_due",
      trial_tier: "promo",
      trial_used: true,
      grace_until: later(7),
      last_paid_invoice_id: null,
    });
    expect(entitledPlanFor(failed, NOW)).toBe("free");
    const paying = { ...failed, trial_tier: null, last_paid_invoice_id: "in_9" };
    expect(entitledPlanFor(paying, NOW)).toBe("starter");
  });
});
