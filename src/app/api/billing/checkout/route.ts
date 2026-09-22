// POST /api/billing/checkout — opens a Stripe Checkout page for a credit pack.
//
// Only an owner or admin can spend the workspace's money. The request names a
// pack by id; the price is looked up on the server, so nothing a browser sends
// can change what is charged.
import { z } from "zod";

import { defineRoute } from "@/server/route";

export const dynamic = "force-dynamic";

const Body = z.object({
  workspaceId: z.string().uuid(),
  packId: z.string().min(1).max(40),
  returnPath: z
    .string()
    .max(300)
    // Relative paths only: an absolute URL here would be an open redirect off
    // the back of a payment.
    .regex(/^\/[A-Za-z0-9\-._~/]*$/, "returnPath must be a relative path")
    .optional(),
});

export const POST = defineRoute({
  name: "billing.checkout",
  auth: "workspace",
  body: Body,
  workspaceId: ({ body }) => body.workspaceId,
  minRole: "admin",
  rateLimit: "billing-checkout",
  handler: async ({ body, userId, supabase }) => {
    const { createCheckoutSession, stripeConfigured } =
      await import("@/server/billing/stripe.server");
    if (!stripeConfigured()) {
      return { ok: false as const, reason: "Buying credits isn't available right now." };
    }

    const { data: auth } = await supabase.auth.getUser();
    const session = await createCheckoutSession({
      workspaceId: body.workspaceId,
      userId,
      email: auth.user?.email ?? null,
      packId: body.packId,
      returnPath: body.returnPath ?? "/projects",
    });

    return { ok: true as const, url: session.url, valueUsd: session.valueUsd };
  },
});
