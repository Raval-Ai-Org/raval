import { z } from "zod";
import { defineRoute } from "@/server/route";

export const dynamic = "force-dynamic";

const Body = z.object({
  action: z.enum(["manage", "payment_method_update"]).default("manage"),
  returnPath: z
    .string()
    .max(300)
    .regex(/^\/[A-Za-z0-9\-._~/]*$/, "returnPath must be a relative path")
    .default("/projects"),
});

export const POST = defineRoute({
  name: "billing.portal",
  auth: "user",
  body: Body,
  rateLimit: "billing-checkout",
  handler: async ({ userId, body }) => {
    const { createAccountBillingPortal } = await import("@/server/billing/stripe-account.server");
    return createAccountBillingPortal(userId, body);
  },
});
