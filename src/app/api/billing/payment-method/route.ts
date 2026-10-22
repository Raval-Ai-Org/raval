import { defineRoute } from "@/server/route";

export const dynamic = "force-dynamic";

export const GET = defineRoute({
  name: "billing.payment-method",
  auth: "user",
  rateLimit: "billing-read",
  handler: async ({ userId }) => {
    const { getAccountPaymentMethod } = await import("@/server/billing/stripe-account.server");
    return getAccountPaymentMethod(userId);
  },
});
