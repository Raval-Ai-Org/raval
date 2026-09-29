import "server-only";

// Billing cron chores that are about people rather than money movement:
// "your free month ends in 3 days" and referral rewards.

import type { SupabaseClient } from "@supabase/supabase-js";
import { PLANS, REFERRAL, type PlanId } from "@/lib/billing/catalog";
import { formatNumber } from "@/lib/billing/present";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { appUrl } from "@/server/notify/email.server";
import { grantMeter } from "./meters.server";
import { notify } from "./notify.server";

const admin = supabaseAdmin as unknown as SupabaseClient;
const DAY = 86_400_000;

/** Manual plans and launch grace months ending within 3 days. */
export async function notifyEndingComps(now = new Date()): Promise<number> {
  const { data, error } = await admin
    .from("billing_accounts")
    .select("id,owner_user_id,comped_plan_id,comped_until")
    .not("comped_plan_id", "is", null)
    .gt("comped_until", now.toISOString())
    .lte("comped_until", new Date(now.getTime() + 3 * DAY).toISOString())
    .limit(100);
  if (error) throw new Error("Could not load ending plans.");
  let sent = 0;
  for (const row of data ?? []) {
    const plan =
      PLANS[(row.comped_plan_id as PlanId) in PLANS ? (row.comped_plan_id as PlanId) : "free"];
    const ends = new Date(String(row.comped_until)).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
    });
    if (
      await notify({
        accountId: String(row.id),
        userId: String(row.owner_user_id),
        kind: "comp_ending",
        windowKey: `comp:${row.comped_until}`,
        payload: { plan: plan.id, until: row.comped_until },
        email: {
          subject: `Your ${plan.label} plan ends on ${ends}`,
          text: `Your ${plan.label} plan ends on ${ends}. After that your account moves to Free: your work is kept, and brands beyond the Free plan become read-only.\n\nUpgrade to keep everything running.`,
          action: ["Keep my plan", appUrl("/projects?billing=plans")],
        },
      })
    )
      sent++;
  }
  return sent;
}

/** A referred account has paid, and its first payment is past the refund window. */
async function firstPaidAt(accountId: string): Promise<Date | null> {
  const [manual, card] = await Promise.all([
    admin
      .from("billing_manual_activations")
      .select("created_at")
      .eq("account_id", accountId)
      .in("kind", ["plan", "credit_pack", "video_pack"])
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    admin
      .from("billing_payment_records")
      .select("created_at,amount_cents,refunded_cents")
      .eq("account_id", accountId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);
  const dates = [manual.data?.created_at, card.data?.created_at]
    .filter(Boolean)
    .map((value) => new Date(String(value)));
  if (card.data && Number(card.data.refunded_cents) >= Number(card.data.amount_cents)) {
    return manual.data ? new Date(String(manual.data.created_at)) : null;
  }
  return dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null;
}

/** Referral eligibility (pure; exported for tests). */
export function referralEligible(args: {
  paidAt: Date | null;
  rewardedThisYear: number;
  now?: Date;
}): boolean {
  const now = args.now ?? new Date();
  if (!args.paidAt) return false;
  if (args.rewardedThisYear >= REFERRAL.maxRewardsPerYear) return false;
  return now.getTime() - args.paidAt.getTime() >= REFERRAL.rewardAfterDays * DAY;
}

export async function rewardReferrals(now = new Date()): Promise<number> {
  const { data, error } = await admin
    .from("referrals")
    .select("id,referrer_account_id,referred_account_id")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) throw new Error("Could not load referrals.");
  let rewarded = 0;
  for (const row of data ?? []) {
    const { count } = await admin
      .from("referrals")
      .select("id", { count: "exact", head: true })
      .eq("referrer_account_id", row.referrer_account_id)
      .eq("status", "rewarded")
      .gte("rewarded_at", new Date(now.getTime() - 365 * DAY).toISOString());
    const paidAt = await firstPaidAt(String(row.referred_account_id));
    if (!referralEligible({ paidAt, rewardedThisYear: count ?? 0, now })) continue;
    const expiresAt = new Date(now.getTime() + REFERRAL.expiresInDays * DAY).toISOString();
    for (const [side, accountId] of [
      ["referrer", row.referrer_account_id],
      ["referred", row.referred_account_id],
    ] as const) {
      for (const [meter, amount] of [
        ["credits", REFERRAL.credits],
        ["video", REFERRAL.videoUnits],
      ] as const) {
        await grantMeter({
          accountId: String(accountId),
          meter,
          amount,
          source: "referral",
          restriction: REFERRAL.restriction,
          expiresAt,
          idempotencyKey: `referral:${row.id}:${side}:${meter}`,
          reason: "Referral reward",
        });
      }
      const { data: owner } = await admin
        .from("billing_accounts")
        .select("owner_user_id")
        .eq("id", accountId)
        .maybeSingle();
      if (owner) {
        await notify({
          accountId: String(accountId),
          userId: String(owner.owner_user_id),
          kind: "referral_reward",
          windowKey: `referral:${row.id}`,
          email: {
            subject: "You earned a referral reward",
            text: `Thanks for spreading the word. ${formatNumber(REFERRAL.credits)} credits and ${REFERRAL.videoUnits / 100} videos were added to your balance.`,
            action: ["Open Mellox", appUrl("/projects")],
          },
        });
      }
    }
    await admin
      .from("referrals")
      .update({ status: "rewarded", rewarded_at: now.toISOString() })
      .eq("id", row.id)
      .eq("status", "pending");
    rewarded++;
  }
  return rewarded;
}
