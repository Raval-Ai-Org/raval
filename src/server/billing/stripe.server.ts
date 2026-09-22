// Buying credits with a card.
//
// Stripe is the only place a card is ever touched: Mellox never sees or stores
// a card number, and the browser never supplies an amount. A pack is chosen by
// id, the price is looked up here, and credits are granted only when Stripe's
// signed webhook says the payment succeeded.
import "server-only";

import Stripe from "stripe";

import type { Json } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { HttpError } from "@/server/http-error";
import { recordAudit } from "@/server/audit.server";
import { getAppUrl } from "@/server/env";
import { pricingConfig, recordTopUp } from "@/server/links/credits.server";

export type CreditPack = {
  id: string;
  /** What the card is charged. */
  usd: number;
  /** Spending power granted, in dollars. Never less than `usd`. */
  valueUsd: number;
  label: string;
};

/**
 * Fixed packs, priced server-side. The customer picks an id; the amount is
 * never accepted from the request.
 *
 * Both figures are dollars, because that is what people see everywhere in this
 * feature — a placement costs $16, not "1,600 credits". Credits remain the
 * ledger unit underneath and are derived from `valueUsd` at grant time.
 */
export const CREDIT_PACKS: CreditPack[] = [
  { id: "starter", usd: 50, valueUsd: 50, label: "Top up $50" },
  { id: "growth", usd: 200, valueUsd: 220, label: "Top up $200" },
  { id: "scale", usd: 500, valueUsd: 575, label: "Top up $500" },
];

export function findPack(id: string): CreditPack | null {
  return CREDIT_PACKS.find((pack) => pack.id === id) ?? null;
}

/** Ledger credits a pack grants, at the server's own rate. */
export function packCredits(pack: CreditPack): number {
  return Math.round(pack.valueUsd * pricingConfig().creditsPerUsd);
}

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim());
}

let client: Stripe | null = null;

function stripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) {
    // A missing credential is ours. The UI disables the button rather than
    // letting a user reach a broken checkout.
    throw new HttpError(503, "Buying credits isn't available right now.");
  }
  if (!client) client = new Stripe(key);
  return client;
}

async function customerFor(workspaceId: string, email: string | null): Promise<string> {
  const { data: existing } = await supabaseAdmin
    .from("billing_customers")
    .select("stripe_customer_id")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (existing?.stripe_customer_id) return existing.stripe_customer_id;

  const customer = await stripe().customers.create({
    email: email ?? undefined,
    metadata: { workspace_id: workspaceId },
  });

  // A race here would create a second Stripe customer, which is untidy but not
  // dangerous; the insert below decides which one Mellox uses from now on.
  const { data } = await supabaseAdmin
    .from("billing_customers")
    .upsert(
      { workspace_id: workspaceId, stripe_customer_id: customer.id },
      { onConflict: "workspace_id" },
    )
    .select("stripe_customer_id")
    .single();

  return data?.stripe_customer_id ?? customer.id;
}

export type CheckoutSession = { url: string; packId: string; valueUsd: number };

export async function createCheckoutSession(args: {
  workspaceId: string;
  userId: string;
  email: string | null;
  packId: string;
  returnPath: string;
}): Promise<CheckoutSession> {
  const pack = findPack(args.packId);
  if (!pack) throw new HttpError(400, "That credit pack doesn't exist.");

  const customer = await customerFor(args.workspaceId, args.email);
  const bonusUsd = Math.round((pack.valueUsd - pack.usd) * 100) / 100;
  const origin = getAppUrl();

  const session = await stripe().checkout.sessions.create({
    mode: "payment",
    customer,
    client_reference_id: args.workspaceId,
    // The webhook reads credits from here, but validates the pack id against
    // CREDIT_PACKS before granting anything — metadata is not trusted on its own.
    metadata: {
      workspace_id: args.workspaceId,
      user_id: args.userId,
      pack_id: pack.id,
    },
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "usd",
          unit_amount: Math.round(pack.usd * 100),
          product_data: {
            name: `Mellox balance — $${pack.valueUsd.toFixed(2)}`,
            description:
              bonusUsd > 0
                ? `$${pack.usd.toFixed(2)} of balance plus $${bonusUsd.toFixed(2)} free`
                : `$${pack.usd.toFixed(2)} of balance`,
          },
        },
      },
    ],
    success_url: `${origin}${args.returnPath}?credits=added`,
    cancel_url: `${origin}${args.returnPath}?credits=cancelled`,
  });

  if (!session.url) throw new HttpError(502, "We couldn't open the payment page.");

  await recordAudit({
    workspaceId: args.workspaceId,
    userId: args.userId,
    action: "billing.checkout.opened",
    entity: session.id,
    payload: { packId: pack.id, usd: pack.usd, valueUsd: pack.valueUsd },
  });

  return { url: session.url, packId: pack.id, valueUsd: pack.valueUsd };
}

export type WebhookOutcome = { handled: boolean; reason: string };

/**
 * Verifies Stripe's signature and grants credits.
 *
 * Two independent guards stop a replay from granting twice: the stripe_events
 * primary key, and the credit ledger's idempotency key, which is derived from
 * the payment intent. Either alone would do; both is cheap.
 */
export async function handleWebhook(rawBody: string, signature: string): Promise<WebhookOutcome> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) throw new HttpError(503, "Webhook not configured.");

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(rawBody, signature, secret);
  } catch {
    throw new HttpError(400, "Invalid signature.");
  }

  const { error: insertError } = await supabaseAdmin.from("stripe_events").insert({
    id: event.id,
    type: event.type,
    // Stored verbatim so an operator can reconstruct what Stripe actually sent.
    payload: event.data.object as unknown as Json,
  });
  // A duplicate primary key means this event was already taken in.
  if (insertError && insertError.code === "23505") {
    return { handled: false, reason: "already received" };
  }

  if (event.type !== "checkout.session.completed") {
    await supabaseAdmin
      .from("stripe_events")
      .update({ processed_at: new Date().toISOString() })
      .eq("id", event.id);
    return { handled: false, reason: `ignored ${event.type}` };
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const workspaceId = session.metadata?.workspace_id ?? session.client_reference_id ?? null;
  const packId = session.metadata?.pack_id ?? null;
  const pack = packId ? findPack(packId) : null;

  if (!workspaceId || !pack) {
    await supabaseAdmin
      .from("stripe_events")
      .update({
        processed_at: new Date().toISOString(),
        error: "missing workspace or unknown pack",
      })
      .eq("id", event.id);
    return { handled: false, reason: "missing workspace or unknown pack" };
  }

  if (session.payment_status !== "paid") {
    await supabaseAdmin
      .from("stripe_events")
      .update({
        processed_at: new Date().toISOString(),
        workspace_id: workspaceId,
        error: `payment_status=${session.payment_status}`,
      })
      .eq("id", event.id);
    return { handled: false, reason: "not paid" };
  }

  // Credits come from the pack definition, never from the session amount, so a
  // tampered metadata field cannot mint credits.
  const credits = packCredits(pack);
  const paymentIntent =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : (session.payment_intent?.id ?? session.id);

  const result = await recordTopUp({
    workspaceId,
    credits,
    paymentIntentId: paymentIntent,
    reason: `Credit purchase — ${pack.label}`,
  });

  await supabaseAdmin
    .from("stripe_events")
    .update({
      processed_at: new Date().toISOString(),
      workspace_id: workspaceId,
      error: result.ok ? null : result.reason,
    })
    .eq("id", event.id);

  await recordAudit({
    workspaceId,
    userId: session.metadata?.user_id ?? null,
    action: "billing.credits.purchased",
    entity: paymentIntent,
    payload: {
      packId: pack.id,
      credits,
      usd: pack.usd,
      valueUsd: pack.valueUsd,
      replayed: result.ok && result.replayed,
    },
  });

  return { handled: result.ok, reason: result.ok ? "credits added" : result.reason };
}
