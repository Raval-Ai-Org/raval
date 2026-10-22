import type { PaidPlanId } from "@/lib/billing/catalog";

export type StripeSubscriptionStatus =
  | "active"
  | "canceled"
  | "incomplete"
  | "incomplete_expired"
  | "past_due"
  | "paused"
  | "trialing"
  | "unpaid";

/**
 * Convert Stripe's payment state into the access state stored by Mellox.
 * Initial subscriptions that have not been paid never inherit plan access.
 * Existing past-due subscriptions keep their plan only for the separately
 * enforced grace window.
 */
export function projectStripeSubscription(
  providerStatus: string,
  catalogPlan: PaidPlanId | "pause",
): {
  localStatus: "active" | "canceled" | "free" | "past_due" | "paused" | "trialing";
  planId: PaidPlanId | "free" | "paused";
  entitledPlanId: PaidPlanId | "free";
  clearProviderSubscription: boolean;
} {
  const canceled = providerStatus === "canceled" || providerStatus === "incomplete_expired";
  const trialing = providerStatus === "trialing";
  const active = providerStatus === "active";
  const pastDue = providerStatus === "past_due" || providerStatus === "unpaid";
  const productPaused = catalogPlan === "pause" && active;
  const paidPlan = catalogPlan === "pause" ? null : catalogPlan;
  const hasPlanAccess = (active || trialing || pastDue) && paidPlan !== null;

  return {
    localStatus: canceled
      ? "canceled"
      : trialing
        ? "trialing"
        : pastDue
          ? "past_due"
          : productPaused
            ? "paused"
            : active
              ? "active"
              : "free",
    planId: hasPlanAccess ? paidPlan! : productPaused ? "paused" : "free",
    entitledPlanId: hasPlanAccess ? paidPlan! : "free",
    clearProviderSubscription: canceled,
  };
}

export function shouldPreserveFreeWindow(
  providerStatus: string,
  account: { status: string; lastPaidInvoiceId?: string | null; trialUsed: boolean },
): boolean {
  return (
    providerStatus === "incomplete" ||
    (providerStatus === "incomplete_expired" &&
      account.status === "free" &&
      !account.lastPaidInvoiceId &&
      !account.trialUsed)
  );
}
