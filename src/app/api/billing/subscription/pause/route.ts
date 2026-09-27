import { defineRoute } from "@/server/route";

export const dynamic = "force-dynamic";
export const POST = defineRoute({
  name: "billing.subscription.pause",
  auth: "user",
  rateLimit: "billing-checkout",
  handler: async ({ userId }) => {
    const { pauseAccountPlan } = await import("@/server/billing/stripe-account.server");
    return pauseAccountPlan(userId);
  },
});
