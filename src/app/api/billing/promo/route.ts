import { z } from "zod";
import { defineRoute } from "@/server/route";

export const dynamic = "force-dynamic";

const Body = z.object({ code: z.string().trim().min(1).max(40) });

// "Have a code?" on /checkout: what a trial code gives this account. Nothing is
// claimed here; one use is counted only when Stripe says the trial started.
export const POST = defineRoute({
  name: "billing.promo.check",
  auth: "user",
  body: Body,
  rateLimit: "billing-promo",
  handler: async ({ body, userId }) => {
    const { accountForUser } = await import("@/server/billing/accounts.server");
    const { promoOfferFor } = await import("@/server/billing/promo.server");
    const account = await accountForUser(userId);
    const offer = await promoOfferFor(account, body.code);
    return { ok: true as const, code: offer.code, days: offer.days, credits: offer.credits };
  },
});
