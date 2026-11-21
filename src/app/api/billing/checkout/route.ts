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
  /** A trial code from Mellox (checked again on the server and at the webhook). */
  promoCode: z.string().trim().min(4).max(40).optional(),
  returnPath: z
    .string()
    .max(300)
    .regex(/^\/[A-Za-z0-9\-._~/]*$/, "returnPath must be a relative path")
    .optional(),
  /** "elements": Mellox's own /checkout page renders the payment form. */
  ui: z.enum(["hosted", "elements"]).optional(),
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
      promoCode: body.promoCode,
      returnPath: body.returnPath,
      ui: body.ui,
    });
    // A publishable key is public by design; the page needs it to load Stripe.js.
    const publishableKey = process.env.STRIPE_PUBLISHABLE_KEY?.trim() || null;
    if (body.ui === "elements" && !publishableKey)
      throw new HttpError(503, "Stripe billing is not configured yet.");
    return {
      ok: true as const,
      sessionId: session.sessionId,
      url: session.url ?? null,
      clientSecret: session.clientSecret ?? null,
      publishableKey,
    };
  },
});
