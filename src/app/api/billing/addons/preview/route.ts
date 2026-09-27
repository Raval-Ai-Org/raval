import { z } from "zod";
import { defineRoute } from "@/server/route";

export const dynamic = "force-dynamic";
const Body = z.object({
  key: z.enum([
    "extra_brand",
    "prompts_100",
    "daily_tracking_100",
    "daily_market_brain",
    "pro_200",
    "extra_seat",
  ]),
  quantity: z.number().int().min(0).max(100),
});
export const POST = defineRoute({
  name: "billing.addons.preview",
  auth: "user",
  body: Body,
  rateLimit: "billing-checkout",
  handler: async ({ body, userId }) => {
    const { previewAddonChange } = await import("@/server/billing/stripe-account.server");
    return previewAddonChange({ userId, ...body });
  },
});
