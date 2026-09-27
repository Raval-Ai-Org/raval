import { z } from "zod";
import { defineRoute } from "@/server/route";
import { HttpError } from "@/server/http-error";

export const dynamic = "force-dynamic";

const Body = z.object({
  kind: z.enum(["plan", "credit_pack", "video_pack"]),
  key: z.string().min(1).max(50),
  quantity: z.number().int().min(1).max(20),
  interval: z.enum(["month", "year"]).optional(),
  trial: z.boolean().optional(),
  returnPath: z
    .string()
    .max(300)
    .regex(/^\/[A-Za-z0-9\-._~/]*$/, "returnPath must be a relative path")
    .optional(),
});

export const POST = defineRoute({
  name: "billing.checkout",
  auth: "user",
  body: Body,
  rateLimit: "billing-checkout",
  handler: async ({ body, userId, supabase }) => {
    const { createAccountCheckout, stripeAccountConfigured } =
      await import("@/server/billing/stripe-account.server");
    if (!stripeAccountConfigured())
      throw new HttpError(503, "Stripe billing is not configured yet.");

    const { data: auth } = await supabase.auth.getUser();
    const session = await createAccountCheckout({
      userId,
      email: auth.user?.email ?? null,
      kind: body.kind,
      key: body.key,
      quantity: body.quantity,
      interval: body.interval,
      trial: body.trial,
      returnPath: body.returnPath,
    });
    return { ok: true as const, url: session.url };
  },
});
