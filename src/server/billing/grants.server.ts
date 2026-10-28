import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { ADDONS, PLANS, SIGNUP_GRANT, type Meter, type PlanId } from "@/lib/billing/catalog";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { invalidateBillingAccount, type BillingAccount } from "./accounts.server";
import { entitledPlanFor } from "./entitlements.server";
import { clawbackMeter, grantMeter, rolloverMeter } from "./meters.server";
import { CREATION_PLANS, CREATION_POLICY } from "@/lib/billing/creation";
import { creationPolicyFor } from "./creation.server";

const admin = supabaseAdmin as unknown as SupabaseClient;

function monthlyAt(anchor: string, monthOffset: number): Date {
  const date = new Date(anchor);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + monthOffset;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(date.getUTCDate(), lastDay),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
    ),
  );
}

export function nextMonthlyWindow(anchor: string, after: string): string {
  const origin = new Date(anchor);
  const cursor = new Date(after);
  let months =
    (cursor.getUTCFullYear() - origin.getUTCFullYear()) * 12 +
    cursor.getUTCMonth() -
    origin.getUTCMonth();
  if (!Number.isFinite(months) || months < 0) months = 0;
  for (let i = 0; i < 3; i++) {
    const candidate = monthlyAt(anchor, months + i);
    if (candidate > cursor) return candidate.toISOString();
  }
  throw new Error("Could not calculate next billing grant window.");
}

export async function ensureSignupGrant(account: BillingAccount): Promise<void> {
  const expiresAt = new Date(
    new Date(account.created_at).getTime() + SIGNUP_GRANT.expiresInDays * 86_400_000,
  ).toISOString();
  if (new Date(expiresAt).getTime() <= Date.now()) return;
  // Only the Auth server's record qualifies for promotional credits. Browser
  // metadata and JWT email claims cannot establish confirmation or account status.
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      admin.auth.admin.getUserById(account.owner_user_id),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), 5000);
      }),
    ]);
    if (!result || result.error || !result.data?.user) {
      console.warn("[billing] signup eligibility temporarily unavailable");
      return;
    }
    const user = result.data.user;
    if (user.is_anonymous || (!user.email_confirmed_at && !user.phone_confirmed_at)) return;
  } catch {
    // Withhold the bonus for retry; existing paid balances remain usable.
    console.warn("[billing] signup eligibility temporarily unavailable");
    return;
  } finally {
    clearTimeout(timer);
  }
  await grantMeter({
    accountId: account.id,
    meter: "credits",
    amount: SIGNUP_GRANT.credits,
    source: "signup",
    restriction: SIGNUP_GRANT.restriction,
    idempotencyKey: `signup:${account.id}`,
    expiresAt,
  });
}

/** New Free users can use their Flash allowance before the first cron tick. */
export async function ensureInitialFreeGrant(account: BillingAccount): Promise<void> {
  if (
    account.status !== "free" ||
    account.plan_id !== "free" ||
    // A manual (comped) plan gets its grants from the billing cron.
    entitledPlanFor(account) !== "free" ||
    !account.next_grant_at ||
    new Date(account.next_grant_at) > new Date()
  ) {
    return;
  }
  const start = account.next_grant_at;
  const next = nextMonthlyWindow(account.grant_anchor ?? start, start);
  await grantPlanWindow({ account, plan: "free", windowStart: start, expiresAt: next });
  const { error } = await admin
    .from("billing_accounts")
    .update({ next_grant_at: next, updated_at: new Date().toISOString() })
    .eq("id", account.id)
    .eq("next_grant_at", start);
  if (error) throw new Error("Could not advance first Free grant window.");
  account.next_grant_at = next;
  invalidateBillingAccount(account.id);
}

export async function grantPlanWindow(args: {
  account: BillingAccount;
  plan: PlanId;
  windowStart: string;
  expiresAt: string;
  annualRollover?: boolean;
  providerRef?: string;
}): Promise<number> {
  const { account, plan, windowStart, expiresAt } = args;
  const allowances = PLANS[plan].allowances;
  let policy = "legacy";
  if (plan !== "free") {
    const { data, error } = await admin.rpc("creation_plan_window", {
      p: { account_id: account.id, window_start: windowStart, expires_at: expiresAt },
    });
    if (error || !["legacy", CREATION_POLICY].includes(String(data)))
      throw new Error("Could not prepare monthly creation allowance.");
    policy = String(data);
  }
  const creation = policy === CREATION_POLICY && plan !== "free";
  const amounts: Array<[Meter, number]> = [
    ["credits", creation ? CREATION_PLANS[plan].flexCredits : allowances.credits],
    ["creation", creation ? CREATION_PLANS[plan].points : 0],
    ["video", allowances.videoUnits],
    ["pro_messages", allowances.proMessages],
    ["flash_messages", allowances.flashMessages],
  ];
  if (args.annualRollover) {
    for (const [meter, cap] of amounts) {
      if ((meter === "credits" || meter === "video") && cap > 0) {
        let rolloverCap = cap;
        if (creation && meter === "credits") {
          const { data: old, error: oldError } = await admin
            .from("meter_grants")
            .select("id")
            .eq("account_id", account.id)
            .eq("source", "plan")
            .eq("meter", "credits")
            .gt("remaining", 0)
            .gte("expires_at", windowStart)
            .lt("period_start", windowStart)
            .like("idempotency_key", "plan:%")
            .limit(1);
          if (oldError) throw new Error("Could not preserve previous rollover terms.");
          if (old?.length) rolloverCap = allowances.credits;
        }
        await rolloverMeter({
          accountId: account.id,
          meter,
          windowStart,
          cap: rolloverCap,
          expiresAt,
        });
      }
    }
  }
  let issued = 0;
  for (const [meter, amount] of amounts) {
    if (amount <= 0) continue;
    const result = await grantMeter({
      accountId: account.id,
      meter,
      amount,
      source: "plan",
      restriction: "ai_only",
      periodStart: windowStart,
      expiresAt,
      idempotencyKey: `${creation ? CREATION_POLICY : "plan"}:${account.id}:${plan}:${meter}:${windowStart}`,
      providerRef: args.providerRef,
    });
    if (!result.replayed) issued++;
  }
  return issued;
}

/** An in-period paid upgrade receives only the unused share of the increase. */
export async function grantPlanUpgrade(args: {
  account: BillingAccount;
  from: PlanId;
  to: PlanId;
  paymentId: string;
  expiresAt: string;
  now?: Date;
}): Promise<void> {
  const now = args.now ?? new Date();
  const start = args.account.current_period_start
    ? new Date(args.account.current_period_start).getTime()
    : now.getTime();
  const end = new Date(args.expiresAt).getTime();
  const fraction = Math.max(0, Math.min(1, (end - now.getTime()) / Math.max(1, end - start)));
  const old = PLANS[args.from].allowances;
  const next = PLANS[args.to].allowances;
  const creation = await creationPolicyFor(args.account.id, now);
  for (const [meter, delta] of [
    [
      "credits",
      creation
        ? CREATION_PLANS[args.to].flexCredits - CREATION_PLANS[args.from].flexCredits
        : next.credits - old.credits,
    ],
    ["creation", creation ? CREATION_PLANS[args.to].points - CREATION_PLANS[args.from].points : 0],
    ["video", next.videoUnits - old.videoUnits],
    ["pro_messages", next.proMessages - old.proMessages],
    ["flash_messages", next.flashMessages - old.flashMessages],
  ] as const) {
    const amount = Math.ceil(Math.max(0, delta) * fraction);
    if (amount < 1) continue;
    await grantMeter({
      accountId: args.account.id,
      meter,
      amount,
      source: "plan",
      restriction: "ai_only",
      idempotencyKey: `upgrade:${args.paymentId}:${meter}`,
      expiresAt: args.expiresAt,
      providerRef: args.paymentId,
    });
  }
}

export async function grantAddonWindow(args: {
  accountId: string;
  items: Array<{ catalogKey: string; quantity: number }>;
  windowStart: string;
  expiresAt: string;
  providerRef?: string;
}): Promise<void> {
  for (const item of args.items) {
    const addon = ADDONS[item.catalogKey as keyof typeof ADDONS];
    if (!addon || addon.availability !== "launch") continue;
    for (const [meter, perUnit] of [
      ["credits", addon.adds.credits ?? 0],
      ["video", addon.adds.videoUnits ?? 0],
      ["pro_messages", addon.adds.proMessages ?? 0],
    ] as const) {
      const amount = perUnit * item.quantity;
      if (amount < 1) continue;
      await grantMeter({
        accountId: args.accountId,
        meter,
        amount,
        source: "addon",
        restriction: "ai_only",
        expiresAt: args.expiresAt,
        providerRef: args.providerRef,
        periodStart: args.windowStart,
        idempotencyKey: `addon:${args.accountId}:${item.catalogKey}:${meter}:${args.windowStart}`,
      });
    }
  }
}

export async function grantAddonUpgrade(args: {
  account: BillingAccount;
  before: Array<{ catalogKey: string; quantity: number }>;
  after: Array<{ catalogKey: string; quantity: number }>;
  paymentId: string;
  expiresAt: string;
}): Promise<void> {
  const now = Date.now();
  const start = args.account.current_period_start
    ? new Date(args.account.current_period_start).getTime()
    : now;
  const end = new Date(args.expiresAt).getTime();
  const fraction = Math.max(0, Math.min(1, (end - now) / Math.max(1, end - start)));
  const old = new Map(args.before.map((item) => [item.catalogKey, item.quantity]));
  for (const item of args.after) {
    const addon = ADDONS[item.catalogKey as keyof typeof ADDONS];
    if (!addon || addon.availability !== "launch") continue;
    const extra = Math.max(0, item.quantity - (old.get(item.catalogKey) ?? 0));
    for (const [meter, perUnit] of [
      ["credits", addon.adds.credits ?? 0],
      ["video", addon.adds.videoUnits ?? 0],
      ["pro_messages", addon.adds.proMessages ?? 0],
    ] as const) {
      const amount = Math.ceil(extra * perUnit * fraction);
      if (amount < 1) continue;
      await grantMeter({
        accountId: args.account.id,
        meter,
        amount,
        source: "addon",
        restriction: "ai_only",
        expiresAt: args.expiresAt,
        providerRef: args.paymentId,
        idempotencyKey: `addon-upgrade:${args.paymentId}:${item.catalogKey}:${meter}`,
      });
    }
  }
}

/** Called by the guarded billing cron; payment webhooks call grantPlanWindow directly. */
export async function issueDueGrants(
  now = new Date(),
): Promise<{ accounts: number; grants: number }> {
  const { data, error } = await admin
    .from("billing_accounts")
    .select("*")
    .lte("next_grant_at", now.toISOString())
    .order("next_grant_at", { ascending: true })
    .limit(100);
  if (error) throw new Error("Could not load due billing accounts.");
  let accounts = 0;
  let grants = 0;
  for (const account of (data ?? []) as BillingAccount[]) {
    const start = account.next_grant_at;
    if (!start) continue;
    const next = nextMonthlyWindow(account.grant_anchor ?? start, start);
    const plan = entitledPlanFor(account, now);
    const withinPaidYear =
      account.status === "active" &&
      account.billing_interval === "year" &&
      account.current_period_start &&
      account.current_period_end &&
      new Date(start) >= new Date(account.current_period_start) &&
      new Date(start) < new Date(account.current_period_end);
    const comped =
      account.comped_plan_id && account.comped_until && new Date(account.comped_until) > now;
    if (plan === "free" && account.status !== "paused") {
      grants += await grantPlanWindow({
        account,
        plan: "free",
        windowStart: start,
        expiresAt: next,
      });
    } else if (withinPaidYear || comped) {
      grants += await grantPlanWindow({
        account,
        plan,
        windowStart: start,
        expiresAt: next,
        annualRollover: Boolean(withinPaidYear),
        providerRef: account.last_paid_invoice_id ?? undefined,
      });
      const { data: addonItems, error: addonError } = await admin
        .from("billing_subscription_items")
        .select("catalog_key,quantity")
        .eq("account_id", account.id)
        .eq("status", "active");
      if (addonError) throw new Error("Could not load due add-on grants.");
      await grantAddonWindow({
        accountId: account.id,
        items: (addonItems ?? []).map((item) => ({
          catalogKey: item.catalog_key,
          quantity: item.quantity,
        })),
        windowStart: start,
        expiresAt: next,
        providerRef: account.last_paid_invoice_id ?? undefined,
      });
      if (withinPaidYear && account.last_paid_invoice_id) {
        const { data: payment, error: paymentError } = await admin
          .from("billing_payment_records")
          .select("amount_cents,refunded_cents")
          .eq("provider_invoice_id", account.last_paid_invoice_id)
          .maybeSingle();
        if (paymentError) throw new Error("Could not check annual payment status.");
        if (payment && Number(payment.refunded_cents) > 0) {
          const { data: windowGrants, error: grantsError } = await admin
            .from("meter_grants")
            .select("id,amount,clawed_back")
            .eq("account_id", account.id)
            .eq("provider_ref", account.last_paid_invoice_id)
            .eq("period_start", start);
          if (grantsError) throw new Error("Could not check refunded annual grants.");
          for (const grant of windowGrants ?? []) {
            const due =
              Math.floor(
                (Number(grant.amount) * Number(payment.refunded_cents)) /
                  Math.max(1, Number(payment.amount_cents)),
              ) - Number(grant.clawed_back);
            if (due > 0)
              await clawbackMeter({
                accountId: account.id,
                grantId: String(grant.id),
                amount: due,
                idempotencyKey: `annual-refund:${account.last_paid_invoice_id}:${start}:${grant.id}`,
                reason: "Refunded annual subscription",
              });
          }
        }
      }
    }
    const { error: updateError } = await admin
      .from("billing_accounts")
      .update({ next_grant_at: next, updated_at: now.toISOString() })
      .eq("id", account.id)
      .eq("next_grant_at", start);
    if (updateError) throw new Error("Could not advance billing grant window.");
    invalidateBillingAccount(account.id);
    accounts++;
  }
  return { accounts, grants };
}
