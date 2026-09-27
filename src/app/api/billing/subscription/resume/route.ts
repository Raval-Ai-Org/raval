import { defineRoute } from "@/server/route";

export const dynamic = "force-dynamic";
export const POST = defineRoute({
  name: "billing.subscription.resume",
  auth: "user",
  rateLimit: "billing-checkout",
  handler: async ({ userId }) => {
    const { resumeAccountPlan } = await import("@/server/billing/stripe-account.server");
    return resumeAccountPlan(userId);
  },
});
