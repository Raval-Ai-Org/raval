import { defineRoute } from "@/server/route";

export const dynamic = "force-dynamic";

export const POST = defineRoute({
  name: "billing.portal",
  auth: "user",
  rateLimit: "billing-checkout",
  handler: async ({ userId }) => {
    const { createAccountBillingPortal } = await import("@/server/billing/stripe-account.server");
    return createAccountBillingPortal(userId);
  },
});
