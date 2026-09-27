import "server-only";

import { createHash } from "node:crypto";
import Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ADDONS,
  CREDIT_PACKS,
  PAUSE,
  PLANS,
  TRIAL,
  VIDEO_PACKS,
  planRank,
  type BillingInterval,
  type PaidPlanId,
} from "@/lib/billing/catalog";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getAppUrl } from "@/server/env";
import { HttpError } from "@/server/http-error";
import { accountForUser, invalidateBillingAccount, type BillingAccount } from "./accounts.server";
import {
  nextMonthlyWindow,
  grantPlanWindow,
  grantPlanUpgrade,
  grantAddonWindow,
  grantAddonUpgrade,
} from "./grants.server";
import { grantMeter, clawbackMeter } from "./meters.server";

const admin = supabaseAdmin as unknown as SupabaseClient;
let stripeInstance: Stripe | null = null;
let stripeInstanceKey: string | null = null;

export type PurchaseKind = "plan" | "credit_pack" | "video_pack";

function stripe(): Stripe {
  const secret = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secret || !process.env.STRIPE_WEBHOOK_SECRET?.trim()) {
    throw new HttpError(503, "Stripe billing is not configured yet.");
  }
  if (!stripeInstance || stripeInstanceKey !== secret) {
    stripeInstance = new Stripe(secret);
    stripeInstanceKey = secret;
  }
  return stripeInstance;
}

export function stripeAccountConfigured(): boolean {
  return Boolean(
    process.env.STRIPE_SECRET_KEY?.trim() && process.env.STRIPE_WEBHOOK_SECRET?.trim(),
  );
}

function credentialFingerprint(): string {
  return createHash("sha256")
    .update(`${process.env.STRIPE_SECRET_KEY?.trim()}:${process.env.STRIPE_WEBHOOK_SECRET?.trim()}`)
    .digest("hex");
}

export async function stripeAccountReady(): Promise<boolean> {
  if (!stripeAccountConfigured()) return false;
  const required = [
    ...(["starter", "growth", "agency", "scale"] as const).flatMap((key) =>
      (["month", "year"] as const).map((interval) => ({ kind: "plan" as const, key, interval })),
    ),
    ...CREDIT_PACKS.map((pack) => ({
      kind: "credit_pack" as const,
      key: pack.key,
      interval: null,
    })),
    ...VIDEO_PACKS.map((pack) => ({ kind: "video_pack" as const, key: pack.key, interval: null })),
  ];
  try {
    await Promise.all(required.map((item) => mappedPrice(item.kind, item.key, item.interval)));
    await Promise.all(
      Object.values(ADDONS)
        .filter((addon) => addon.availability === "launch")
        .flatMap((addon) =>
          (["month", "year"] as const).map((interval) => addonPrice(addon.key, interval)),
        ),
    );
    await pausePrice();
    const { data: health, error: healthError } = await admin
      .from("billing_provider_health")
      .select("webhook_verified_at,credential_fingerprint")
      .eq("environment", environment())
      .maybeSingle();
    if (
      healthError ||
      !health?.webhook_verified_at ||
      health.credential_fingerprint !== credentialFingerprint()
    )
      return false;
    return true;
  } catch {
    return false;
  }
}

function environment(): "sandbox" | "production" {
  const key = process.env.STRIPE_SECRET_KEY?.trim() ?? "";
  return key.startsWith("sk_live_") ? "production" : "sandbox";
}

function catalogItem(kind: PurchaseKind, key: string, interval: BillingInterval | null) {
  if (kind === "plan") {
    if (!interval || !(key in PLANS) || key === "free") throw new HttpError(400, "Invalid plan.");
    const plan = PLANS[key as PaidPlanId];
    return {
      cents: Math.round((interval === "year" ? plan.priceAnnualUsd : plan.priceMonthlyUsd) * 100),
      interval,
    };
  }
  if (interval) throw new HttpError(400, "Packs are one-time purchases.");
  const pack =
    kind === "credit_pack"
      ? CREDIT_PACKS.find((item) => item.key === key)
      : VIDEO_PACKS.find((item) => item.key === key);
  if (!pack) throw new HttpError(400, "Unknown pack.");
  return { cents: pack.usd * 100, interval: "one_time" as const };
}

async function mappedPrice(kind: PurchaseKind, key: string, interval: BillingInterval | null) {
  const expected = catalogItem(kind, key, interval);
  const { data, error } = await admin
    .from("billing_price_map")
    .select("provider_price_id,amount_cents")
    .eq("catalog_key", key)
    .eq("interval", expected.interval)
    .eq("environment", environment())
    .eq("active", true)
    .maybeSingle();
  if (
    error ||
    !data ||
    Number(data.amount_cents) !== expected.cents ||
    !String(data.provider_price_id).startsWith("price_")
  ) {
    throw new HttpError(503, "This purchase is not available yet.");
  }
  return String(data.provider_price_id);
}

async function customerFor(account: BillingAccount, email: string | null): Promise<string> {
  if (account.provider !== "stripe" && account.provider_customer_id) {
    throw new HttpError(409, "This account uses another billing provider.");
  }
  if (account.provider_customer_id) return account.provider_customer_id;
  const customer = await stripe().customers.create(
    {
      email: email ?? undefined,
      metadata: { mellox_account_id: account.id },
    },
    { idempotencyKey: `mellox-customer:${account.id}` },
  );
  const { data, error } = await admin
    .from("billing_accounts")
    .update({
      provider: "stripe",
      provider_customer_id: customer.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", account.id)
    .is("provider_customer_id", null)
    .select("provider_customer_id")
    .maybeSingle();
  if (error) throw new HttpError(503, "Could not link the billing customer.");
  if (data?.provider_customer_id) return String(data.provider_customer_id);
  const { data: winner, error: winnerError } = await admin
    .from("billing_accounts")
    .select("provider_customer_id")
    .eq("id", account.id)
    .single();
  if (winnerError || !winner?.provider_customer_id)
    throw new HttpError(503, "Could not link the billing customer.");
  return String(winner.provider_customer_id);
}

export async function createAccountCheckout(args: {
  userId: string;
  email: string | null;
  kind: PurchaseKind;
  key: string;
  quantity: number;
  interval?: BillingInterval;
  trial?: boolean;
  returnPath?: string;
}): Promise<{ url: string }> {
  if (!(await stripeAccountReady()))
    throw new HttpError(503, "Purchases open after Stripe webhook and prices are verified.");
  const account = await accountForUser(args.userId);
  if (account.provider_subscription_id && args.kind === "plan") {
    throw new HttpError(409, "Change your existing plan from Plan & billing.");
  }
  if (args.kind === "plan" && args.quantity !== 1) {
    throw new HttpError(400, "A subscription has one plan.");
  }
  if (args.trial && (args.kind !== "plan" || args.key !== TRIAL.plan || account.trial_used)) {
    throw new HttpError(409, "This trial is not available.");
  }
  if (!Number.isInteger(args.quantity) || args.quantity < 1 || args.quantity > 20) {
    throw new HttpError(400, "Invalid purchase quantity.");
  }
  const interval = args.interval ?? null;
  const priceId = await mappedPrice(args.kind, args.key, interval);
  const customer = await customerFor(account, args.email);
  if (args.kind === "plan") {
    const { data: current, error: currentError } = await admin
      .from("billing_accounts")
      .select("provider_subscription_id,trial_used")
      .eq("id", account.id)
      .single();
    if (currentError || !current) throw new HttpError(503, "Could not check current subscription.");
    if (current.provider_subscription_id || (args.trial && current.trial_used)) {
      throw new HttpError(409, "This account already has a subscription or used its trial.");
    }
    const { error: expireError } = await admin
      .from("checkout_intents")
      .update({ consumed_at: new Date().toISOString() })
      .eq("account_id", account.id)
      .eq("kind", "plan")
      .is("consumed_at", null)
      .lte("expires_at", new Date().toISOString());
    if (expireError) throw new HttpError(503, "Could not check open plan checkout.");
  }
  const expiresAt = new Date(Date.now() + 35 * 60_000);
  const { data: intent, error } = await admin
    .from("checkout_intents")
    .insert({
      account_id: account.id,
      created_by: args.userId,
      kind: args.kind,
      catalog_key: args.key,
      interval,
      quantity: args.quantity,
      provider_price_id: priceId,
      expires_at: expiresAt.toISOString(),
    })
    .select("id")
    .single();
  if (error?.code === "23505")
    throw new HttpError(409, "A plan checkout is already open. Finish or wait for it to expire.");
  if (error || !intent) throw new HttpError(503, "Could not begin checkout.");
  const intentId = String(intent.id);
  const origin = getAppUrl();
  const returnPath = args.returnPath ?? "/projects";
  const mode = args.kind === "plan" ? "subscription" : "payment";
  const session = await stripe().checkout.sessions.create(
    {
      mode,
      customer,
      client_reference_id: intentId,
      metadata: { mellox_checkout_intent: intentId },
      ...(mode === "subscription"
        ? {
            subscription_data: {
              metadata: { mellox_checkout_intent: intentId },
              ...(args.trial ? { trial_period_days: TRIAL.days } : {}),
            },
          }
        : {}),
      line_items: [{ price: priceId, quantity: args.quantity }],
      expires_at: Math.floor(expiresAt.getTime() / 1000),
      success_url: `${origin}${returnPath}${returnPath.includes("?") ? "&" : "?"}billing=return`,
      cancel_url: `${origin}${returnPath}${returnPath.includes("?") ? "&" : "?"}billing=cancel`,
    },
    { idempotencyKey: `mellox-checkout:${intentId}` },
  );
  if (!session.url) throw new HttpError(502, "Stripe did not return a checkout URL.");
  const { error: linkError } = await admin
    .from("checkout_intents")
    .update({ provider_session_id: session.id })
    .eq("id", intentId);
  if (linkError) throw new HttpError(503, "Could not finish checkout setup.");
  return { url: session.url };
}

export async function createAccountBillingPortal(userId: string): Promise<{ url: string }> {
  const account = await accountForUser(userId);
  if (account.provider !== "stripe" || !account.provider_customer_id) {
    throw new HttpError(409, "There is no Stripe billing account to manage yet.");
  }
  const session = await stripe().billingPortal.sessions.create({
    customer: account.provider_customer_id,
    return_url: `${getAppUrl()}/projects`,
  });
  return { url: session.url };
}

async function ownedSubscription(userId: string) {
  const account = await accountForUser(userId);
  if (
    account.provider !== "stripe" ||
    !account.provider_subscription_id ||
    !account.provider_customer_id
  ) {
    throw new HttpError(409, "There is no active Stripe subscription.");
  }
  const subscription = await stripe().subscriptions.retrieve(account.provider_subscription_id);
  if (subscription.customer !== account.provider_customer_id)
    throw new Error("Stripe customer mismatch.");
  return { account, subscription, details: await planForSubscription(subscription) };
}

function ensureNoPendingSchedule(subscription: Stripe.Subscription): void {
  if (subscription.schedule) {
    throw new HttpError(
      409,
      "A billing change is already scheduled. Manage it in Stripe before scheduling another.",
    );
  }
}

async function replacementItems(
  subscription: Stripe.Subscription,
  details: Awaited<ReturnType<typeof planForSubscription>>,
  target: PaidPlanId | "pause",
  interval: BillingInterval,
) {
  const items = [];
  for (const item of subscription.items.data) {
    const current = details.items.find((entry) => entry.providerItemId === item.id);
    if (!current) throw new Error("Subscription item mismatch.");
    if (current.catalogKey === details.plan) {
      const price =
        target === "pause" ? await pausePrice() : await mappedPrice("plan", target, interval);
      items.push({ id: item.id, price, quantity: 1 });
    } else if (
      target !== "pause" &&
      ADDONS[current.catalogKey as keyof typeof ADDONS]?.plans.includes(target)
    ) {
      const price = await addonPrice(current.catalogKey, interval);
      items.push({ id: item.id, price, quantity: current.quantity });
    } else items.push({ id: item.id, deleted: true as const });
  }
  return items;
}

async function addonPrice(key: string, interval: BillingInterval): Promise<string> {
  const addon = ADDONS[key as keyof typeof ADDONS];
  if (!addon || addon.availability !== "launch") throw new HttpError(400, "Invalid add-on.");
  const expected = addon.usdPerMonth * (interval === "year" ? 1200 : 100);
  const { data, error } = await admin
    .from("billing_price_map")
    .select("provider_price_id,amount_cents")
    .eq("catalog_key", key)
    .eq("interval", interval)
    .eq("environment", environment())
    .eq("active", true)
    .single();
  if (
    error ||
    !data ||
    Number(data.amount_cents) !== expected ||
    !String(data.provider_price_id).startsWith("price_")
  ) {
    throw new HttpError(503, "This add-on is not available yet.");
  }
  return String(data.provider_price_id);
}

async function pausePrice(): Promise<string> {
  const { data, error } = await admin
    .from("billing_price_map")
    .select("provider_price_id,amount_cents")
    .eq("catalog_key", "pause")
    .eq("interval", "month")
    .eq("environment", environment())
    .eq("active", true)
    .single();
  if (
    error ||
    !data ||
    Number(data.amount_cents) !== PAUSE.usdPerMonth * 100 ||
    !String(data.provider_price_id).startsWith("price_")
  ) {
    throw new HttpError(503, "Pause billing is not configured yet.");
  }
  return String(data.provider_price_id);
}

export async function previewPlanChange(args: {
  userId: string;
  plan: PaidPlanId;
  interval: BillingInterval;
}): Promise<{ amountDueNowCents: number; effectiveAt: string; scheduled: boolean }> {
  const { account, subscription, details } = await ownedSubscription(args.userId);
  if (details.plan === args.plan && details.interval === args.interval) {
    throw new HttpError(400, "This is already your current plan.");
  }
  const scheduled =
    details.plan !== "pause" &&
    (planRank(args.plan) < planRank(details.plan) ||
      (details.interval === "year" && args.interval === "month"));
  if (scheduled) return { amountDueNowCents: 0, effectiveAt: details.end, scheduled: true };
  const items = await replacementItems(subscription, details, args.plan, args.interval);
  const preview = await stripe().invoices.createPreview({
    customer: account.provider_customer_id!,
    subscription: subscription.id,
    subscription_details: {
      items,
      proration_behavior: "always_invoice",
      proration_date: Math.floor(Date.now() / 1000),
    },
  });
  const prorated = preview.lines.data
    .filter((line) => {
      const parent = line.parent as unknown as {
        subscription_item_details?: { proration?: boolean };
      } | null;
      return parent?.subscription_item_details?.proration;
    })
    .reduce((sum, line) => sum + line.amount, 0);
  return {
    amountDueNowCents: Math.max(0, prorated),
    effectiveAt: new Date().toISOString(),
    scheduled: false,
  };
}

export async function changeAccountPlan(args: {
  userId: string;
  plan: PaidPlanId;
  interval: BillingInterval;
}): Promise<{ scheduled: boolean; effectiveAt: string }> {
  if (!(await stripeAccountReady()))
    throw new HttpError(503, "Stripe billing is not ready for plan changes.");
  const { account, subscription, details } = await ownedSubscription(args.userId);
  if (details.plan === args.plan && details.interval === args.interval) {
    throw new HttpError(400, "This is already your current plan.");
  }
  const scheduled =
    details.plan !== "pause" &&
    (planRank(args.plan) < planRank(details.plan) ||
      (details.interval === "year" && args.interval === "month"));
  const items = await replacementItems(subscription, details, args.plan, args.interval);
  if (scheduled) {
    ensureNoPendingSchedule(subscription);
    const planItems = items.filter(
      (item): item is { id: string; price: string; quantity: number } => "price" in item,
    );
    const scheduleId = subscription.schedule
      ? typeof subscription.schedule === "string"
        ? subscription.schedule
        : subscription.schedule.id
      : (await stripe().subscriptionSchedules.create({ from_subscription: subscription.id })).id;
    const currentItems = subscription.items.data.map((item) => ({
      price: item.price.id,
      quantity: item.quantity ?? 1,
    }));
    await stripe().subscriptionSchedules.update(scheduleId, {
      end_behavior: "release",
      proration_behavior: "none",
      phases: [
        {
          start_date: Math.floor(new Date(details.start).getTime() / 1000),
          end_date: Math.floor(new Date(details.end).getTime() / 1000),
          items: currentItems,
        },
        {
          start_date: Math.floor(new Date(details.end).getTime() / 1000),
          duration: { interval: args.interval, interval_count: 1 },
          items: planItems.map(({ price, quantity }) => ({ price, quantity })),
        },
      ],
    });
    const { error } = await admin
      .from("billing_accounts")
      .update({
        downgrade_to: args.plan,
        downgrade_at: details.end,
        updated_at: new Date().toISOString(),
      })
      .eq("id", account.id);
    if (error) throw new Error("Could not save the scheduled plan change.");
    invalidateBillingAccount(account.id);
    return { scheduled: true, effectiveAt: details.end };
  }
  await stripe().subscriptions.update(
    subscription.id,
    {
      items,
      proration_behavior: "always_invoice",
      payment_behavior: "error_if_incomplete",
    },
    {
      idempotencyKey: `mellox-plan:${account.id}:${args.plan}:${args.interval}:${details.start}:${subscriptionId(subscription.latest_invoice) ?? "none"}`,
    },
  );
  const updated = await stripe().subscriptions.retrieve(subscription.id);
  const invoiceId = subscriptionId(updated.latest_invoice);
  if (invoiceId) {
    const invoice = await stripe().invoices.retrieve(invoiceId);
    if (invoice.status !== "paid") throw new HttpError(409, "The plan payment has not completed.");
    await syncSubscription(subscription.id, invoiceId);
  } else await syncSubscription(subscription.id);
  return { scheduled: false, effectiveAt: new Date().toISOString() };
}

export async function previewAddonChange(args: {
  userId: string;
  key: keyof typeof ADDONS;
  quantity: number;
}): Promise<{ amountDueNowCents: number; effectiveAt: string; scheduled: boolean }> {
  const { account, subscription, details } = await ownedSubscription(args.userId);
  const addon = ADDONS[args.key];
  if (
    !addon ||
    addon.availability !== "launch" ||
    details.plan === "pause" ||
    !addon.plans.includes(details.plan)
  )
    throw new HttpError(400, "Add-on is not available on this plan.");
  const current = details.items.find((item) => item.catalogKey === args.key);
  const currentQuantity = current?.quantity ?? 0;
  if (args.quantity === currentQuantity) throw new HttpError(400, "Quantity has not changed.");
  if (args.quantity < currentQuantity)
    return { amountDueNowCents: 0, effectiveAt: details.end, scheduled: true };
  const price = await addonPrice(args.key, details.interval);
  const items = current
    ? [{ id: current.providerItemId, price, quantity: args.quantity }]
    : [{ price, quantity: args.quantity }];
  const preview = await stripe().invoices.createPreview({
    customer: account.provider_customer_id!,
    subscription: subscription.id,
    subscription_details: {
      items,
      proration_behavior: "always_invoice",
      proration_date: Math.floor(Date.now() / 1000),
    },
  });
  const amountDueNowCents = preview.lines.data
    .filter((line) => {
      const parent = line.parent as unknown as {
        subscription_item_details?: { proration?: boolean };
      } | null;
      return parent?.subscription_item_details?.proration;
    })
    .reduce((sum, line) => sum + line.amount, 0);
  return {
    amountDueNowCents: Math.max(0, amountDueNowCents),
    effectiveAt: new Date().toISOString(),
    scheduled: false,
  };
}

export async function changeAddon(args: {
  userId: string;
  key: keyof typeof ADDONS;
  quantity: number;
}): Promise<{ scheduled: boolean; effectiveAt: string }> {
  if (!(await stripeAccountReady()))
    throw new HttpError(503, "Stripe billing is not ready for add-on changes.");
  const { account, subscription, details } = await ownedSubscription(args.userId);
  const addon = ADDONS[args.key];
  if (
    !addon ||
    addon.availability !== "launch" ||
    details.plan === "pause" ||
    !addon.plans.includes(details.plan)
  )
    throw new HttpError(400, "Add-on is not available on this plan.");
  const current = details.items.find((item) => item.catalogKey === args.key);
  const currentQuantity = current?.quantity ?? 0;
  if (args.quantity === currentQuantity) throw new HttpError(400, "Quantity has not changed.");
  if (args.quantity < currentQuantity) {
    ensureNoPendingSchedule(subscription);
    const scheduleId = subscription.schedule
      ? typeof subscription.schedule === "string"
        ? subscription.schedule
        : subscription.schedule.id
      : (await stripe().subscriptionSchedules.create({ from_subscription: subscription.id })).id;
    const nextItems = subscription.items.data.flatMap((item) => {
      if (item.id !== current?.providerItemId)
        return [{ price: item.price.id, quantity: item.quantity ?? 1 }];
      return args.quantity > 0 ? [{ price: item.price.id, quantity: args.quantity }] : [];
    });
    await stripe().subscriptionSchedules.update(scheduleId, {
      end_behavior: "release",
      proration_behavior: "none",
      phases: [
        {
          start_date: Math.floor(new Date(details.start).getTime() / 1000),
          end_date: Math.floor(new Date(details.end).getTime() / 1000),
          items: subscription.items.data.map((item) => ({
            price: item.price.id,
            quantity: item.quantity ?? 1,
          })),
        },
        {
          start_date: Math.floor(new Date(details.end).getTime() / 1000),
          duration: { interval: details.interval, interval_count: 1 },
          items: nextItems,
        },
      ],
    });
    return { scheduled: true, effectiveAt: details.end };
  }
  const price = await addonPrice(args.key, details.interval);
  await stripe().subscriptions.update(
    subscription.id,
    {
      items: current
        ? [{ id: current.providerItemId, price, quantity: args.quantity }]
        : [{ price, quantity: args.quantity }],
      proration_behavior: "always_invoice",
      payment_behavior: "error_if_incomplete",
    },
    {
      idempotencyKey: `mellox-addon:${account.id}:${args.key}:${args.quantity}:${details.start}:${subscriptionId(subscription.latest_invoice) ?? "none"}`,
    },
  );
  const updated = await stripe().subscriptions.retrieve(subscription.id);
  const invoiceId = subscriptionId(updated.latest_invoice);
  if (invoiceId) {
    const invoice = await stripe().invoices.retrieve(invoiceId);
    if (invoice.status !== "paid")
      throw new HttpError(409, "The add-on payment has not completed.");
    await syncSubscription(subscription.id, invoiceId);
  }
  return { scheduled: false, effectiveAt: new Date().toISOString() };
}

export async function cancelAccountPlan(userId: string): Promise<{ endsAt: string }> {
  const { subscription, details } = await ownedSubscription(userId);
  await stripe().subscriptions.update(subscription.id, { cancel_at_period_end: true });
  await syncSubscription(subscription.id);
  return { endsAt: details.end };
}

export async function pauseAccountPlan(
  userId: string,
): Promise<{ scheduled: boolean; effectiveAt: string }> {
  if (!(await stripeAccountReady()))
    throw new HttpError(503, "Stripe billing is not ready for plan changes.");
  const { account, subscription, details } = await ownedSubscription(userId);
  if (details.plan === "pause") throw new HttpError(400, "This account is already paused.");
  const pausePriceId = await pausePrice();
  const { error } = await admin
    .from("billing_accounts")
    .update({ resume_plan_id: details.plan })
    .eq("id", account.id);
  if (error) throw new Error("Could not save the resume plan.");
  if (details.interval === "year") {
    ensureNoPendingSchedule(subscription);
    const scheduleId = subscription.schedule
      ? typeof subscription.schedule === "string"
        ? subscription.schedule
        : subscription.schedule.id
      : (await stripe().subscriptionSchedules.create({ from_subscription: subscription.id })).id;
    await stripe().subscriptionSchedules.update(scheduleId, {
      end_behavior: "cancel",
      proration_behavior: "none",
      phases: [
        {
          start_date: Math.floor(new Date(details.start).getTime() / 1000),
          end_date: Math.floor(new Date(details.end).getTime() / 1000),
          items: subscription.items.data.map((item) => ({
            price: item.price.id,
            quantity: item.quantity ?? 1,
          })),
        },
        {
          start_date: Math.floor(new Date(details.end).getTime() / 1000),
          duration: { interval: "month", interval_count: PAUSE.maxMonths },
          items: [{ price: pausePriceId, quantity: 1 }],
        },
      ],
    });
    return { scheduled: true, effectiveAt: details.end };
  }
  const pauseEnd = new Date();
  pauseEnd.setUTCMonth(pauseEnd.getUTCMonth() + PAUSE.maxMonths);
  await stripe().subscriptions.update(subscription.id, {
    items: subscription.items.data.map((item, index) =>
      index === 0
        ? { id: item.id, price: pausePriceId, quantity: 1 }
        : { id: item.id, deleted: true },
    ),
    proration_behavior: "always_invoice",
    payment_behavior: "error_if_incomplete",
    cancel_at: Math.floor(pauseEnd.getTime() / 1000),
  });
  await syncSubscription(subscription.id);
  return { scheduled: false, effectiveAt: new Date().toISOString() };
}

export async function resumeAccountPlan(userId: string): Promise<{ effectiveAt: string }> {
  if (!(await stripeAccountReady()))
    throw new HttpError(503, "Stripe billing is not ready for plan changes.");
  const { account, subscription, details } = await ownedSubscription(userId);
  if (details.plan !== "pause" || !account.resume_plan_id || !(account.resume_plan_id in PLANS)) {
    throw new HttpError(409, "This account cannot be resumed yet.");
  }
  const plan = account.resume_plan_id as PaidPlanId;
  const price = await mappedPrice("plan", plan, "month");
  if (subscription.schedule) {
    await stripe().subscriptionSchedules.release(subscriptionId(subscription.schedule)!);
  }
  await stripe().subscriptions.update(subscription.id, {
    items: [{ id: subscription.items.data[0].id, price, quantity: 1 }],
    proration_behavior: "always_invoice",
    payment_behavior: "error_if_incomplete",
    cancel_at: null,
  });
  await syncSubscription(subscription.id);
  return { effectiveAt: new Date().toISOString() };
}

type CheckoutIntent = {
  id: string;
  account_id: string;
  kind: PurchaseKind;
  catalog_key: string;
  interval: BillingInterval | null;
  quantity: number;
  provider_price_id: string;
  provider_session_id: string | null;
  expires_at: string;
  consumed_at: string | null;
};

async function intentForSession(session: Stripe.Checkout.Session): Promise<CheckoutIntent> {
  const id = session.client_reference_id;
  if (!id || session.metadata?.mellox_checkout_intent !== id)
    throw new Error("Missing checkout intent.");
  const { data, error } = await admin.from("checkout_intents").select("*").eq("id", id).single();
  if (error || !data || data.provider_session_id !== session.id)
    throw new Error("Checkout intent mismatch.");
  if (!data.consumed_at && new Date(data.expires_at) < new Date(session.created * 1000)) {
    throw new Error("Expired checkout intent.");
  }
  const intent = data as CheckoutIntent;
  if (session.expires_at && session.expires_at * 1000 > new Date(intent.expires_at).getTime()) {
    throw new Error("Checkout session outlives its reservation.");
  }
  const { data: account, error: accountError } = await admin
    .from("billing_accounts")
    .select("provider_customer_id")
    .eq("id", intent.account_id)
    .single();
  if (accountError || !account || account.provider_customer_id !== session.customer) {
    throw new Error("Checkout customer mismatch.");
  }
  const lines = await stripe().checkout.sessions.listLineItems(session.id, { limit: 5 });
  if (
    lines.data.length !== 1 ||
    lines.data[0].price?.id !== intent.provider_price_id ||
    lines.data[0].quantity !== intent.quantity
  ) {
    throw new Error("Checkout price mismatch.");
  }
  return intent;
}

async function grantPack(intent: CheckoutIntent, session: Stripe.Checkout.Session): Promise<void> {
  if (session.payment_status !== "paid") return;
  const expected = catalogItem(intent.kind, intent.catalog_key, intent.interval);
  if (session.currency !== "usd" || session.amount_total !== expected.cents * intent.quantity) {
    throw new Error("Checkout total mismatch.");
  }
  const paymentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id;
  if (!paymentId) throw new Error("Paid checkout lacks a payment intent.");
  const { data: existing, error: existingError } = await admin
    .from("billing_payment_records")
    .select("provider_payment_id,account_id,checkout_intent_id,kind")
    .eq("provider_payment_id", paymentId)
    .maybeSingle();
  if (existingError) throw new Error("Could not check Stripe payment attribution.");
  if (existing) {
    if (
      existing.account_id !== intent.account_id ||
      existing.checkout_intent_id !== intent.id ||
      existing.kind !== intent.kind
    )
      throw new Error("Stripe payment was already attributed elsewhere.");
    return;
  }
  const grantIds: string[] = [];
  if (intent.kind === "credit_pack") {
    const pack = CREDIT_PACKS.find((item) => item.key === intent.catalog_key);
    if (!pack) throw new Error("Unknown paid credit pack.");
    const paid = await grantMeter({
      accountId: intent.account_id,
      meter: "credits",
      amount: pack.credits * intent.quantity,
      source: "pack",
      restriction: "any",
      idempotencyKey: `stripe:${paymentId}:paid`,
      providerRef: paymentId,
    });
    if (!paid.ok || !paid.grant_id) throw new Error("Could not grant paid credits.");
    grantIds.push(paid.grant_id);
    if (pack.bonusCredits > 0) {
      const bonus = await grantMeter({
        accountId: intent.account_id,
        meter: "credits",
        amount: pack.bonusCredits * intent.quantity,
        source: "pack_bonus",
        restriction: "ai_only",
        idempotencyKey: `stripe:${paymentId}:bonus`,
        providerRef: paymentId,
      });
      if (!bonus.ok || !bonus.grant_id) throw new Error("Could not grant bonus credits.");
      grantIds.push(bonus.grant_id);
    }
  } else {
    const pack = VIDEO_PACKS.find((item) => item.key === intent.catalog_key);
    if (!pack) throw new Error("Unknown paid video pack.");
    const grant = await grantMeter({
      accountId: intent.account_id,
      meter: "video",
      amount: pack.videoUnits * intent.quantity,
      source: "pack",
      restriction: "any",
      idempotencyKey: `stripe:${paymentId}:video`,
      providerRef: paymentId,
    });
    if (!grant.ok || !grant.grant_id) throw new Error("Could not grant video credits.");
    grantIds.push(grant.grant_id);
  }
  const { error } = await admin.from("billing_payment_records").insert({
    provider_payment_id: paymentId,
    account_id: intent.account_id,
    checkout_intent_id: intent.id,
    kind: intent.kind,
    catalog_key: intent.catalog_key,
    amount_cents: expected.cents * intent.quantity,
    grant_ids: grantIds,
  });
  if (error) throw new Error("Could not record Stripe payment.");
  await admin
    .from("checkout_intents")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", intent.id);
  invalidateBillingAccount(intent.account_id);
}

function subscriptionId(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "id" in value && typeof value.id === "string")
    return value.id;
  return null;
}

async function accountForSubscription(
  subscription: Stripe.Subscription,
): Promise<BillingAccount | null> {
  const { data: linked } = await admin
    .from("billing_accounts")
    .select("*")
    .eq("provider_subscription_id", subscription.id)
    .maybeSingle();
  if (linked) return linked as BillingAccount;
  const intentId = subscription.metadata.mellox_checkout_intent;
  if (!intentId) return null;
  const { data: intent, error } = await admin
    .from("checkout_intents")
    .select("account_id,kind")
    .eq("id", intentId)
    .single();
  if (error || !intent || intent.kind !== "plan") throw new Error("Unknown subscription intent.");
  const { data: account, error: accountError } = await admin
    .from("billing_accounts")
    .select("*")
    .eq("id", intent.account_id)
    .single();
  if (
    accountError ||
    !account ||
    account.provider_customer_id !== subscription.customer ||
    (account.provider_subscription_id && account.provider_subscription_id !== subscription.id)
  ) {
    throw new Error("Stripe subscription account mismatch.");
  }
  return account as BillingAccount;
}

async function planForSubscription(subscription: Stripe.Subscription): Promise<{
  plan: PaidPlanId | "pause";
  interval: BillingInterval;
  start: string;
  end: string;
  items: Array<{ catalogKey: string; quantity: number; providerItemId: string; priceId: string }>;
}> {
  const stripeItems = subscription.items.data;
  if (stripeItems.length < 1) throw new Error("Subscription has no items.");
  const { data: mappings, error } = await admin
    .from("billing_price_map")
    .select("provider_price_id,catalog_key,interval")
    .in(
      "provider_price_id",
      stripeItems.map((item) => item.price.id),
    )
    .eq("environment", environment())
    .eq("active", true);
  if (error || !mappings || mappings.length !== stripeItems.length)
    throw new Error("Unmapped Stripe price.");
  const byPrice = new Map(mappings.map((row) => [String(row.provider_price_id), row]));
  if (
    new Set(stripeItems.map((entry) => byPrice.get(entry.price.id)?.catalog_key)).size !==
    stripeItems.length
  ) {
    throw new Error("Duplicate subscription catalog items.");
  }
  const planItems = stripeItems.filter((item) => {
    const key = byPrice.get(item.price.id)?.catalog_key;
    return key && ((key in PLANS && key !== "free") || key === "pause");
  });
  if (planItems.length !== 1) throw new Error("Subscription requires exactly one plan.");
  const item = planItems[0];
  if (item.quantity !== 1) throw new Error("Subscription plan quantity must be one.");
  const planMap = byPrice.get(item.price.id);
  if (!planMap || !["month", "year"].includes(planMap.interval))
    throw new Error("Invalid plan interval.");
  for (const other of stripeItems) {
    if (other.id === item.id) continue;
    const map = byPrice.get(other.price.id);
    if (
      !map ||
      !(map.catalog_key in ADDONS) ||
      map.interval !== planMap.interval ||
      ADDONS[map.catalog_key as keyof typeof ADDONS].availability !== "launch" ||
      planMap.catalog_key === "pause" ||
      !ADDONS[map.catalog_key as keyof typeof ADDONS].plans.includes(
        planMap.catalog_key as PaidPlanId,
      ) ||
      !Number.isInteger(other.quantity) ||
      (other.quantity ?? 0) < 1 ||
      (other.quantity ?? 0) > 100
    ) {
      throw new Error("Unsupported subscription item.");
    }
  }
  return {
    plan: planMap.catalog_key as PaidPlanId | "pause",
    interval: planMap.interval as BillingInterval,
    start: new Date(item.current_period_start * 1000).toISOString(),
    end: new Date(item.current_period_end * 1000).toISOString(),
    items: stripeItems.map((entry) => ({
      catalogKey: String(byPrice.get(entry.price.id)?.catalog_key),
      quantity: entry.quantity ?? 1,
      providerItemId: entry.id,
      priceId: entry.price.id,
    })),
  };
}

async function syncSubscription(
  subscriptionIdValue: string,
  paidInvoiceId?: string,
): Promise<void> {
  const subscription = await stripe().subscriptions.retrieve(subscriptionIdValue, {
    expand: ["items.data.price"],
  });
  const account = await accountForSubscription(subscription);
  if (!account) return;
  const details = await planForSubscription(subscription);
  const active = subscription.status === "active";
  const trialing = subscription.status === "trialing";
  const pastDue = subscription.status === "past_due" || subscription.status === "unpaid";
  const canceled =
    subscription.status === "canceled" || subscription.status === "incomplete_expired";
  const paused = details.plan === "pause" && active;
  const status = canceled
    ? "canceled"
    : trialing
      ? "trialing"
      : pastDue
        ? "past_due"
        : paused
          ? "paused"
          : active
            ? "active"
            : "free";
  if (active && !paused && !paidInvoiceId) {
    const latestId = subscriptionId(subscription.latest_invoice);
    if (!latestId) return;
    const latest = await stripe().invoices.retrieve(latestId);
    if (latest.status !== "paid") return;
    paidInvoiceId = latestId;
  }
  const now = new Date();
  const nextGrant =
    details.interval === "year"
      ? account.current_period_start === details.start &&
        account.next_grant_at &&
        new Date(account.next_grant_at) > new Date(details.start)
        ? account.next_grant_at
        : nextMonthlyWindow(details.start, details.start)
      : details.end;
  const changes: Record<string, unknown> = {
    provider: "stripe",
    provider_subscription_id: canceled ? null : subscription.id,
    status,
    plan_id: canceled ? "free" : paused ? "paused" : details.plan,
    entitled_plan_id: canceled || paused ? "free" : details.plan,
    billing_interval: details.interval,
    current_period_start: details.start,
    current_period_end: details.end,
    grant_anchor: details.start,
    next_grant_at: canceled
      ? account.status === "canceled" && account.next_grant_at
        ? account.next_grant_at
        : now.toISOString()
      : nextGrant,
    cancel_at: subscription.cancel_at
      ? new Date(subscription.cancel_at * 1000).toISOString()
      : null,
    updated_at: now.toISOString(),
  };
  if (canceled) {
    changes.grant_anchor =
      account.status === "canceled" && account.grant_anchor
        ? account.grant_anchor
        : now.toISOString();
  }
  if (trialing) {
    changes.trial_used = true;
    changes.trial_ends_at = subscription.trial_end
      ? new Date(subscription.trial_end * 1000).toISOString()
      : details.end;
  }
  if (pastDue)
    changes.grace_until =
      account.grace_until ?? new Date(now.getTime() + 7 * 86_400_000).toISOString();
  if (active) changes.grace_until = null;
  changes.pause_started_at = paused
    ? account.status === "paused" && account.pause_started_at
      ? account.pause_started_at
      : now.toISOString()
    : null;
  if (trialing) {
    const expiry = changes.trial_ends_at as string;
    for (const [meter, amount] of [
      ["credits", TRIAL.credits],
      ["video", TRIAL.videoUnits],
      ["pro_messages", TRIAL.proMessages],
      ["flash_messages", TRIAL.flashMessages],
    ] as const) {
      await grantMeter({
        accountId: account.id,
        meter,
        amount,
        source: "trial",
        restriction: "ai_only",
        idempotencyKey: `trial:${subscription.id}:${meter}`,
        expiresAt: expiry,
        providerRef: subscription.id,
      });
    }
  }
  if (active && !paused && paidInvoiceId) {
    const refreshed = { ...account, ...changes } as BillingAccount;
    const expiresAt = details.interval === "year" ? nextGrant : details.end;
    const invoice = await stripe().invoices.retrieve(paidInvoiceId);
    if (invoice.status !== "paid") throw new Error("Subscription invoice is not paid.");
    const parent = invoice.parent as { subscription_details?: { subscription?: unknown } } | null;
    if (
      subscriptionId(parent?.subscription_details?.subscription) !== subscription.id ||
      subscriptionId(invoice.customer) !== subscriptionId(subscription.customer) ||
      invoice.currency !== "usd"
    )
      throw new Error("Subscription invoice ownership mismatch.");
    // Stripe can deliver a paid invoice after a newer renewal or plan change.
    // Only the current invoice may authorize the current subscription items.
    if (paidInvoiceId !== subscriptionId(subscription.latest_invoice)) return;
    const { data: recordedPayment, error: recordError } = await admin
      .from("billing_payment_records")
      .select("amount_cents,refunded_cents")
      .eq("provider_invoice_id", invoice.id)
      .maybeSingle();
    if (recordError) throw new Error("Could not check subscription payment record.");
    const fullyRefunded =
      recordedPayment &&
      Number(recordedPayment.amount_cents) > 0 &&
      Number(recordedPayment.refunded_cents) >= Number(recordedPayment.amount_cents);
    if (fullyRefunded) {
      changes.status = "past_due";
      changes.entitled_plan_id = "free";
      changes.grace_until = now.toISOString();
      changes.next_grant_at = null;
    }
    if (!fullyRefunded) {
      changes.last_paid_invoice_id = invoice.id;
      if (invoice.billing_reason === "subscription_update") {
        const previous =
          account.plan_id in PLANS ? (account.plan_id as keyof typeof PLANS) : "free";
        await grantPlanUpgrade({
          account,
          from: previous,
          to: details.plan as PaidPlanId,
          paymentId: paidInvoiceId,
          expiresAt: account.next_grant_at ?? expiresAt,
        });
        const { data: previousItems, error: oldItemsError } = await admin
          .from("billing_subscription_items")
          .select("catalog_key,quantity")
          .eq("account_id", account.id)
          .eq("status", "active");
        if (oldItemsError) throw new Error("Could not load previous add-ons.");
        await grantAddonUpgrade({
          account,
          before: (previousItems ?? []).map((item) => ({
            catalogKey: item.catalog_key,
            quantity: item.quantity,
          })),
          after: details.items,
          paymentId: paidInvoiceId,
          expiresAt: account.next_grant_at ?? expiresAt,
        });
      } else {
        await grantPlanWindow({
          account: refreshed,
          plan: details.plan as PaidPlanId,
          windowStart: details.start,
          expiresAt,
          providerRef: invoice.id,
        });
        await grantAddonWindow({
          accountId: account.id,
          items: details.items,
          windowStart: details.start,
          expiresAt,
          providerRef: paidInvoiceId,
        });
      }
      if (invoice.amount_paid > 0) {
        const payments = await stripe().invoicePayments.list({
          invoice: invoice.id,
          status: "paid",
          limit: 10,
        });
        const paid = payments.data.find(
          (entry) => entry.payment.type === "payment_intent" && entry.payment.payment_intent,
        );
        const paymentId = subscriptionId(paid?.payment.payment_intent);
        if (!paymentId) throw new Error("Paid invoice has no payment intent.");
        const { error: paymentError } = await admin.from("billing_payment_records").upsert(
          {
            provider_payment_id: paymentId,
            provider_invoice_id: invoice.id,
            account_id: account.id,
            kind: "subscription",
            catalog_key: details.plan,
            amount_cents: invoice.amount_paid,
          },
          { onConflict: "provider_payment_id", ignoreDuplicates: true },
        );
        if (paymentError) throw new Error("Could not record subscription payment.");
      }
    }
  }
  const { error } = await admin.from("billing_accounts").update(changes).eq("id", account.id);
  if (error) throw new Error("Could not sync Stripe subscription.");
  if ((active || trialing) && subscription.metadata.mellox_checkout_intent) {
    const { error: consumeError } = await admin
      .from("checkout_intents")
      .update({ consumed_at: now.toISOString() })
      .eq("id", subscription.metadata.mellox_checkout_intent)
      .is("consumed_at", null);
    if (consumeError) throw new Error("Could not close plan checkout.");
  }
  const { error: inactivateError } = await admin
    .from("billing_subscription_items")
    .update({ status: "inactive", updated_at: now.toISOString() })
    .eq("account_id", account.id);
  if (inactivateError) throw new Error("Could not sync subscription items.");
  if (!canceled) {
    for (const item of details.items) {
      const { error: itemError } = await admin.from("billing_subscription_items").upsert(
        {
          account_id: account.id,
          catalog_key: item.catalogKey,
          quantity: item.quantity,
          provider_price_id: item.priceId,
          provider_item_id: item.providerItemId,
          status: "active",
          updated_at: now.toISOString(),
        },
        { onConflict: "provider_item_id" },
      );
      if (itemError) throw new Error("Could not store subscription item.");
    }
  }
  invalidateBillingAccount(account.id);
  const { reconcileBillingCapacity } = await import("./capacity.server");
  await reconcileBillingCapacity({ ownerUserId: account.owner_user_id });
}

async function clawbackPayment(paymentId: string, refundedCents: number): Promise<void> {
  const { data, error } = await admin
    .from("billing_payment_records")
    .select("*")
    .eq("provider_payment_id", paymentId)
    .maybeSingle();
  if (error) throw new Error("Could not load Stripe payment record.");
  if (!data) throw new Error("Stripe payment has not been recorded yet.");
  if (refundedCents <= Number(data.refunded_cents)) return;
  const total = Number(data.amount_cents);
  if (total <= 0 || refundedCents > total) throw new Error("Invalid refund amount.");
  let grantIds = data.grant_ids as string[];
  if (data.kind === "subscription" && data.provider_invoice_id) {
    const { data: grants, error: grantsError } = await admin
      .from("meter_grants")
      .select("id")
      .eq("account_id", data.account_id)
      .eq("provider_ref", data.provider_invoice_id);
    if (grantsError) throw new Error("Could not load refunded subscription grants.");
    grantIds = (grants ?? []).map((grant) => String(grant.id));
  }
  for (const grantId of grantIds) {
    const { data: grant, error: grantError } = await admin
      .from("meter_grants")
      .select("amount,clawed_back")
      .eq("id", grantId)
      .single();
    if (grantError || !grant) throw new Error("Refund grant missing.");
    const target = Math.floor((Number(grant.amount) * refundedCents) / total);
    const delta = target - Number(grant.clawed_back);
    if (delta > 0) {
      await clawbackMeter({
        accountId: String(data.account_id),
        grantId,
        amount: delta,
        idempotencyKey: `stripe-refund:${paymentId}:${refundedCents}:${grantId}`,
        reason: "Stripe refund or dispute",
      });
    }
  }
  const { error: updateError } = await admin
    .from("billing_payment_records")
    .update({ refunded_cents: refundedCents })
    .eq("provider_payment_id", paymentId)
    .lt("refunded_cents", refundedCents);
  if (updateError) throw new Error("Could not record Stripe refund.");
  if (data.kind === "subscription" && refundedCents === total) {
    const { error: restrictError } = await admin
      .from("billing_accounts")
      .update({
        status: "past_due",
        grace_until: new Date().toISOString(),
        next_grant_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.account_id);
    if (restrictError) throw new Error("Could not restrict refunded subscription.");
  }
  invalidateBillingAccount(String(data.account_id));
}

export async function handleAccountStripeWebhook(
  rawBody: string,
  signature: string,
): Promise<void> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) throw new HttpError(503, "Stripe webhook is not configured.");
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(rawBody, signature, secret);
  } catch {
    throw new HttpError(400, "Invalid Stripe signature.");
  }
  if (event.livemode !== (environment() === "production")) {
    throw new HttpError(400, "Stripe event mode does not match billing environment.");
  }
  const { error: insertError } = await admin.from("billing_events").insert({
    id: event.id,
    type: event.type,
    occurred_at: new Date(event.created * 1000).toISOString(),
    payload: event as unknown as Record<string, unknown>,
  });
  if (insertError && insertError.code !== "23505")
    throw new Error("Could not record Stripe event.");
  if (insertError?.code === "23505") {
    const { data } = await admin
      .from("billing_events")
      .select("processed_at")
      .eq("id", event.id)
      .single();
    if (data?.processed_at) {
      await recordWebhookHealth(event.id);
      return;
    }
  }
  await processStripeEvent(event, rawBody, signature);
  await recordWebhookHealth(event.id);
}

async function recordWebhookHealth(eventId: string): Promise<void> {
  const { error: healthError } = await admin.from("billing_provider_health").upsert(
    {
      environment: environment(),
      webhook_verified_at: new Date().toISOString(),
      credential_fingerprint: credentialFingerprint(),
      last_event_id: eventId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "environment" },
  );
  if (healthError) throw new Error("Could not record Stripe webhook verification.");
}

/** Replays only events that entered the inbox after a valid Stripe signature. */
export async function replayFailedBillingEvents(
  limit = 25,
): Promise<{ replayed: number; failed: number }> {
  if (!stripeAccountConfigured()) return { replayed: 0, failed: 0 };
  const { data, error } = await admin
    .from("billing_events")
    .select("payload")
    .is("processed_at", null)
    .order("received_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error("Could not load pending Stripe events.");
  let replayed = 0;
  let failed = 0;
  for (const row of data ?? []) {
    const rawBody = JSON.stringify(row.payload);
    const signature = stripe().webhooks.generateTestHeaderString({
      payload: rawBody,
      secret: process.env.STRIPE_WEBHOOK_SECRET!,
    });
    try {
      await processStripeEvent(row.payload as Stripe.Event, rawBody, signature);
      replayed++;
    } catch {
      failed++;
    }
  }
  return { replayed, failed };
}

async function processStripeEvent(
  event: Stripe.Event,
  rawBody: string,
  signature: string,
): Promise<void> {
  try {
    if (
      event.type === "checkout.session.completed" ||
      event.type === "checkout.session.async_payment_succeeded"
    ) {
      const eventSession = event.data.object as Stripe.Checkout.Session;
      const session = await stripe().checkout.sessions.retrieve(eventSession.id);
      // Historical workspace Stripe sessions have no account intent and are
      // processed only by the legacy webhook handler.
      if (session.metadata?.mellox_checkout_intent) {
        const intent = await intentForSession(session);
        if (intent.kind === "plan") {
          const id = subscriptionId(session.subscription);
          if (!id) throw new Error("Checkout subscription is missing.");
          if (session.payment_status === "paid") {
            const invoiceId = subscriptionId(session.invoice);
            if (!invoiceId) throw new Error("Paid subscription checkout lacks an invoice.");
            const invoice = await stripe().invoices.retrieve(invoiceId);
            if (invoice.status !== "paid") throw new Error("Subscription invoice is not paid.");
            await syncSubscription(id, invoiceId);
          } else {
            await syncSubscription(id);
          }
        } else await grantPack(intent, session);
      } else if (event.type === "checkout.session.completed") {
        const workspaceId = session.metadata?.workspace_id ?? session.client_reference_id;
        if (!workspaceId || session.metadata?.workspace_id !== workspaceId) {
          throw new Error("Unknown historical checkout.");
        }
        const { data: workspace, error: workspaceError } = await admin
          .from("workspaces")
          .select("billing_account_id")
          .eq("id", workspaceId)
          .single();
        if (workspaceError || !workspace?.billing_account_id)
          throw new Error("Historical checkout workspace missing.");
        const { data: legacyAccount, error: legacyError } = await admin
          .from("billing_accounts")
          .select("created_at")
          .eq("id", workspace.billing_account_id)
          .single();
        // Account records were created when the new ledger was installed. A
        // workspace checkout created later is never allowed to mint value.
        if (
          legacyError ||
          !legacyAccount ||
          session.created * 1000 >= new Date(legacyAccount.created_at).getTime()
        ) {
          throw new Error("Legacy workspace checkout is no longer eligible.");
        }
        const { handleWebhook } = await import("./stripe.server");
        await handleWebhook(rawBody, signature);
      }
    } else if (event.type === "invoice.paid") {
      const invoice = event.data.object as Stripe.Invoice;
      const parent = invoice.parent as unknown as {
        subscription_details?: { subscription?: unknown };
      } | null;
      const id = subscriptionId(parent?.subscription_details?.subscription);
      if (id && invoice.status === "paid") await syncSubscription(id, invoice.id);
    } else if (
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.deleted"
    ) {
      await syncSubscription((event.data.object as Stripe.Subscription).id);
    } else if (event.type === "invoice.payment_failed") {
      const invoice = event.data.object as Stripe.Invoice;
      const parent = invoice.parent as unknown as {
        subscription_details?: { subscription?: unknown };
      } | null;
      const id = subscriptionId(parent?.subscription_details?.subscription);
      if (id) await syncSubscription(id);
    } else if (event.type === "charge.refunded" || event.type === "charge.dispute.created") {
      const charge = event.data.object as Stripe.Charge | Stripe.Dispute;
      const id = charge.payment_intent;
      const paymentId = subscriptionId(id);
      if (paymentId) {
        const payment =
          event.type === "charge.refunded"
            ? (charge as Stripe.Charge)
            : await stripe().charges.retrieve(
                subscriptionId((charge as Stripe.Dispute).charge) ?? "",
              );
        const customerId = subscriptionId((payment as Stripe.Charge).customer);
        if (customerId) {
          const { data: account, error: accountError } = await admin
            .from("billing_accounts")
            .select("id")
            .eq("provider_customer_id", customerId)
            .maybeSingle();
          if (accountError) throw new Error("Could not resolve refunded billing account.");
          if (account)
            await clawbackPayment(
              paymentId,
              event.type === "charge.refunded"
                ? (payment as Stripe.Charge).amount_refunded
                : (payment as Stripe.Charge).amount,
            );
        }
      }
    }
    const { error } = await admin
      .from("billing_events")
      .update({ processed_at: new Date().toISOString(), error: null })
      .eq("id", event.id);
    if (error) throw new Error("Could not mark Stripe event processed.");
  } catch (error) {
    await admin
      .from("billing_events")
      .update({ error: String(error).slice(0, 500) })
      .eq("id", event.id);
    throw error;
  }
}
