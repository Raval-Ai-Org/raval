import { z } from "zod";
import { defineRoute } from "@/server/route";

export const dynamic = "force-dynamic";
const Body = z.object({
  plan: z.enum(["starter", "growth", "agency", "scale"]),
  interval: z.enum(["month", "year"]),
});

export const POST = defineRoute({
  name: "billing.subscription.change",
  auth: "user",
  body: Body,
  rateLimit: "billing-checkout",
  handler: async ({ body, userId }) => {
    const { changeAccountPlan } = await import("@/server/billing/stripe-account.server");
    return changeAccountPlan({ userId, ...body });
  },
});
