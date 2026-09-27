import { defineRoute } from "@/server/route";

export const dynamic = "force-dynamic";
export const POST = defineRoute({
  name: "billing.subscription.cancel",
  auth: "user",
  rateLimit: "billing-checkout",
  handler: async ({ userId }) => {
    const { cancelAccountPlan } = await import("@/server/billing/stripe-account.server");
    return cancelAccountPlan(userId);
  },
});
