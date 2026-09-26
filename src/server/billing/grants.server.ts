import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { PLANS, SIGNUP_GRANT, type Meter, type PlanId } from "@/lib/billing/catalog";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { invalidateBillingAccount, type BillingAccount } from "./accounts.server";
import { entitledPlanFor } from "./entitlements.server";
import { grantMeter, rolloverMeter } from "./meters.server";

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
  await grantMeter({
    accountId: account.id,
    meter: "credits",
    amount: SIGNUP_GRANT.credits,
    source: "signup",
    restriction: SIGNUP_GRANT.restriction,
    idempotencyKey: `signup:${account.id}`,
    expiresAt: new Date(
      new Date(account.created_at).getTime() + SIGNUP_GRANT.expiresInDays * 86_400_000,
    ).toISOString(),
  });
}

/** New Free users can use their Flash allowance before the first cron tick. */
export async function ensureInitialFreeGrant(account: BillingAccount): Promise<void> {
  if (
    account.status !== "free" ||
    account.plan_id !== "free" ||
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
}): Promise<number> {
  const { account, plan, windowStart, expiresAt } = args;
  const allowances = PLANS[plan].allowances;
  const amounts: Array<[Meter, number]> = [
    ["credits", allowances.credits],
    ["video", allowances.videoUnits],
    ["pro_messages", allowances.proMessages],
    ["flash_messages", allowances.flashMessages],
  ];
  if (args.annualRollover) {
    for (const [meter, cap] of amounts) {
      if ((meter === "credits" || meter === "video") && cap > 0) {
        await rolloverMeter({ accountId: account.id, meter, windowStart, cap, expiresAt });
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
      idempotencyKey: `plan:${account.id}:${meter}:${windowStart}`,
    });
    if (!result.replayed) issued++;
  }
  return issued;
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
      });
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
