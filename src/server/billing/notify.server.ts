import "server-only";

// Billing notices: stored in account_notifications (shown in Plan & billing)
// and emailed once. The table's unique (account, user, kind, window_key) is
// the dedupe, so "80% of credits used" is sent once per monthly window no
// matter how many actions cross it.

import type { SupabaseClient } from "@supabase/supabase-js";
import { PLANS, SIGNUP_GRANT, SOFT_LIMIT_RATIO, type Meter } from "@/lib/billing/catalog";
import { formatMeter } from "@/lib/billing/present";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { appUrl, sendEmail, type EmailMessage } from "@/server/notify/email.server";
import type { BillingAccount } from "./accounts.server";
import { entitledPlanFor } from "./entitlements.server";

const admin = supabaseAdmin as unknown as SupabaseClient;

export type NoticeKind =
  | "meter_80"
  | "meter_100"
  | "upgrade_request"
  | "purchase_request"
  | "plan_activated"
  | "comp_ending"
  | "brand_frozen"
  | "referral_reward";

async function emailOf(userId: string): Promise<string | null> {
  const { data } = await admin.auth.admin.getUserById(userId);
  return data?.user?.email ?? null;
}

/**
 * Record a notice for one person and email it the first time. Returns false
 * when the same notice was already recorded for this window.
 */
export async function notify(args: {
  accountId: string;
  userId: string;
  kind: NoticeKind;
  windowKey: string;
  payload?: Record<string, unknown>;
  email?: Omit<EmailMessage, "to">;
}): Promise<boolean> {
  const { error } = await admin.from("account_notifications").insert({
    account_id: args.accountId,
    user_id: args.userId,
    kind: args.kind,
    window_key: args.windowKey,
    payload: { ...(args.payload ?? {}), title: args.email?.subject ?? null },
  });
  if (error?.code === "23505") return false;
  if (error) {
    console.error("[billing] notice not stored", args.kind, error.code);
    return false;
  }
  if (args.email) {
    const to = await emailOf(args.userId);
    if (to) await sendEmail({ ...args.email, to });
  }
  return true;
}

/** Mellox staff inbox for purchase requests (BILLING_ADMIN_EMAILS). */
export async function notifyAdmins(message: Omit<EmailMessage, "to">): Promise<void> {
  const to = (process.env.BILLING_ADMIN_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.includes("@"));
  if (to.length) await sendEmail({ ...message, to });
}

/** This month's allowance for a meter (Free credits are the one-time signup grant). */
export function monthlyAllowance(plan: keyof typeof PLANS, meter: Meter): number {
  const a = PLANS[plan].allowances;
  if (meter === "credits") return plan === "free" ? SIGNUP_GRANT.credits : a.credits;
  if (meter === "video") return a.videoUnits;
  if (meter === "pro_messages") return a.proMessages;
  return a.flashMessages;
}

/** "meter_100" when empty, "meter_80" when at or past the soft limit, else null. */
export function lowBalanceLevel(
  available: number,
  allowance: number,
): "meter_80" | "meter_100" | null {
  if (allowance <= 0) return null;
  if (available <= 0) return "meter_100";
  // Compare as a ratio with a small tolerance: 0.2 * 2000 is not exactly 400.
  if (available / allowance <= 1 - SOFT_LIMIT_RATIO + 1e-9) return "meter_80";
  return null;
}

const METER_WORDS: Record<Meter, string> = {
  credits: "credits",
  video: "videos",
  pro_messages: "Pro messages",
  flash_messages: "chat messages",
};

/** After a charge: tell the owner once per window at 80% and at 100% used. */
export async function checkLowBalance(accountId: string): Promise<void> {
  const [{ data: account }, { data: wallet }] = await Promise.all([
    admin.from("billing_accounts").select("*").eq("id", accountId).maybeSingle(),
    admin.rpc("account_wallet", { p_account: accountId }),
  ]);
  if (!account) return;
  const typed = account as BillingAccount;
  const plan = entitledPlanFor(typed);
  const windowId = typed.next_grant_at ?? "once";
  for (const row of (Array.isArray(wallet) ? wallet : []) as Array<Record<string, unknown>>) {
    const meter = String(row.meter) as Meter;
    if (meter === "flash_messages") continue;
    const available = Number(row.available ?? 0);
    const level = lowBalanceLevel(available, monthlyAllowance(plan, meter));
    if (!level) continue;
    const empty = level === "meter_100";
    await notify({
      accountId,
      userId: typed.owner_user_id,
      kind: level,
      windowKey: `${meter}:${windowId}`,
      payload: { meter, available },
      email: {
        subject: empty
          ? `You're out of ${METER_WORDS[meter]}`
          : `You've used most of your ${METER_WORDS[meter]}`,
        text: empty
          ? `Your Mellox ${METER_WORDS[meter]} for this month are used up. Top up or upgrade to keep going.`
          : `You have ${formatMeter(meter, available)} left this month. Top up or upgrade so your work doesn't stop.`,
        action: ["See options", appUrl("/projects?billing=topup")],
      },
    });
  }
}

/** Fire and forget after a charge. */
export function checkLowBalanceSoon(accountId: string): void {
  void checkLowBalance(accountId).catch((cause) =>
    console.error("[billing] low balance check failed", cause),
  );
}
