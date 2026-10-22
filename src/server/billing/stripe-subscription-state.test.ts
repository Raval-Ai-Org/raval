import { describe, expect, it } from "vitest";

import { projectStripeSubscription, shouldPreserveFreeWindow } from "./stripe-subscription-state";

describe("Stripe subscription access projection", () => {
  it("activates paid and trial subscriptions", () => {
    expect(projectStripeSubscription("active", "growth")).toMatchObject({
      localStatus: "active",
      planId: "growth",
      entitledPlanId: "growth",
      clearProviderSubscription: false,
    });
    expect(projectStripeSubscription("trialing", "starter")).toMatchObject({
      localStatus: "trialing",
      planId: "starter",
      entitledPlanId: "starter",
    });
  });

  it("never grants paid access to an unpaid initial subscription", () => {
    expect(projectStripeSubscription("incomplete", "scale")).toMatchObject({
      localStatus: "free",
      planId: "free",
      entitledPlanId: "free",
      clearProviderSubscription: false,
    });
    expect(projectStripeSubscription("future_unrecognized_status", "scale")).toMatchObject({
      localStatus: "free",
      planId: "free",
      entitledPlanId: "free",
    });
    expect(projectStripeSubscription("incomplete_expired", "scale")).toMatchObject({
      localStatus: "canceled",
      planId: "free",
      entitledPlanId: "free",
      clearProviderSubscription: true,
    });
  });

  it("preserves the Free allowance cycle while an initial payment is unresolved", () => {
    const free = { status: "free", lastPaidInvoiceId: null, trialUsed: false };
    expect(shouldPreserveFreeWindow("incomplete", free)).toBe(true);
    expect(shouldPreserveFreeWindow("incomplete_expired", free)).toBe(true);
    expect(
      shouldPreserveFreeWindow("incomplete_expired", {
        status: "active",
        lastPaidInvoiceId: "in_paid",
        trialUsed: false,
      }),
    ).toBe(false);
  });

  it("retains existing access only through the past-due grace policy", () => {
    expect(projectStripeSubscription("past_due", "agency")).toMatchObject({
      localStatus: "past_due",
      planId: "agency",
      entitledPlanId: "agency",
    });
    expect(projectStripeSubscription("unpaid", "agency")).toMatchObject({
      localStatus: "past_due",
      planId: "agency",
      entitledPlanId: "agency",
    });
  });

  it("removes feature access for cancellation and the Mellox pause product", () => {
    expect(projectStripeSubscription("canceled", "growth")).toMatchObject({
      localStatus: "canceled",
      planId: "free",
      entitledPlanId: "free",
      clearProviderSubscription: true,
    });
    expect(projectStripeSubscription("active", "pause")).toMatchObject({
      localStatus: "paused",
      planId: "paused",
      entitledPlanId: "free",
    });
  });
});
