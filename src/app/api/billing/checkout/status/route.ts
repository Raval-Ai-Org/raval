import { z } from "zod";
import { defineRoute } from "@/server/route";

export const dynamic = "force-dynamic";

const SessionId = z
  .string()
  .min(10)
  .max(255)
  .regex(/^cs_(?:test_|live_)?[A-Za-z0-9_]+$/);

export const GET = defineRoute({
  name: "billing.checkout.status",
  auth: "user",
  query: z.object({ sessionId: SessionId }),
  rateLimit: "billing-read",
  handler: async ({ query, userId }) => {
    const { getAccountCheckoutStatus } = await import("@/server/billing/stripe-account.server");
    return getAccountCheckoutStatus(userId, query.sessionId);
  },
});

export const POST = defineRoute({
  name: "billing.checkout.cancel",
  auth: "user",
  body: z.object({ sessionId: SessionId }),
  rateLimit: "billing-checkout",
  handler: async ({ body, userId }) => {
    const { cancelAccountCheckout } = await import("@/server/billing/stripe-account.server");
    return cancelAccountCheckout(userId, body.sessionId);
  },
});
