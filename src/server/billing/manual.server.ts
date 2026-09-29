import "server-only";

// Manual billing: "Upgrade now" before online checkout exists.
//
// Owners send a purchase request; a Mellox admin collects the payment offline
// and activates the plan or pack here. A manual plan is stored as a comp
// (`comped_plan_id` until a date), so entitlements, monthly grants from the
// billing cron and the fall back to Free when it ends all reuse the existing
// paths. Every activation is written once per operation id before anything is
// granted, so a replay or double click never grants twice.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CREDIT_PACKS,
  PLANS,
  VIDEO_PACKS,
  planRank,
  type BillingInterval,
  type PaidPlanId,
  type PlanId,
} from "@/lib/billing/catalog";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { HttpError } from "@/server/http-error";
import { accountForUser, invalidateBillingAccount, type BillingAccount } from "./accounts.server";
import { entitledPlanFor } from "./entitlements.server";
import { grantPlanUpgrade, grantPlanWindow, nextMonthlyWindow } from "./grants.server";
import { grantMeter } from "./meters.server";

const admin = supabaseAdmin as unknown as SupabaseClient;

export type PurchaseRequestKind = "plan" | "credit_pack" | "video_pack";

export type PurchaseRequest = {
  id: string;
  kind: PurchaseRequestKind | "addon";
  catalogKey: string;
  interval: BillingInterval | null;
  status: "pending" | "approved" | "declined" | "canceled";
  createdAt: string;
  handledAt: string | null;
  adminNote: string | null;
};

function isPaidPlan(key: string): key is PaidPlanId {
  return key in PLANS && key !== "free";
}

export function validPurchase(kind: PurchaseRequestKind, key: string): boolean {
  if (kind === "plan") return isPaidPlan(key);
  if (kind === "credit_pack") return CREDIT_PACKS.some((pack) => pack.key === key);
  return VIDEO_PACKS.some((pack) => pack.key === key);
}

function mapRequest(row: Record<string, unknown>): PurchaseRequest {
  return {
    id: String(row.id),
    kind: row.kind as PurchaseRequest["kind"],
    catalogKey: String(row.catalog_key),
    interval: (row.billing_interval as BillingInterval | null) ?? null,
    status: row.status as PurchaseRequest["status"],
    createdAt: String(row.created_at),
    handledAt: (row.handled_at as string | null) ?? null,
    adminNote: (row.admin_note as string | null) ?? null,
  };
}

/** Owner only: the caller's own account. Reuses an open request for the same item. */
export async function createPurchaseRequest(args: {
  userId: string;
  kind: PurchaseRequestKind;
  key: string;
  interval?: BillingInterval;
  contact?: string;
  note?: string;
}): Promise<{ request: PurchaseRequest; created: boolean }> {
  if (!validPurchase(args.kind, args.key)) throw new HttpError(400, "Unknown plan or pack.");
  const account = await accountForUser(args.userId);
  if (args.kind === "plan" && planRank(entitledPlanFor(account)) >= planRank(args.key as PlanId)) {
    throw new HttpError(409, "You're already on this plan or a higher one.");
  }
  const row = {
    account_id: account.id,
    requested_by: args.userId,
    kind: args.kind,
    catalog_key: args.key,
    billing_interval: args.kind === "plan" ? (args.interval ?? "month") : null,
    contact: args.contact?.trim() || null,
    note: args.note?.trim() || null,
  };
  const { data, error } = await admin
    .from("billing_purchase_requests")
    .insert(row)
    .select("*")
    .single();
  if (!error && data) {
    await tellAdmins(mapRequest(data), args.userId, row.contact, row.note);
    return { request: mapRequest(data), created: true };
  }
  if (error?.code !== "23505") throw new HttpError(503, "Could not send your request.");
  const { data: existing, error: existingError } = await admin
    .from("billing_purchase_requests")
    .select("*")
    .eq("account_id", account.id)
    .eq("kind", args.kind)
    .eq("catalog_key", args.key)
    .eq("status", "pending")
    .single();
  if (existingError || !existing) throw new HttpError(503, "Could not send your request.");
  // Keep the latest interval and contact details on the open request.
  await admin
    .from("billing_purchase_requests")
    .update({
      billing_interval: row.billing_interval,
      contact: row.contact ?? existing.contact,
      note: row.note ?? existing.note,
      updated_at: new Date().toISOString(),
    })
    .eq("id", existing.id)
    .eq("status", "pending");
  return {
    request: mapRequest({ ...existing, billing_interval: row.billing_interval }),
    created: false,
  };
}

function itemName(kind: string, key: string, interval: string | null): string {
  if (kind === "plan" && key in PLANS) {
    return `${PLANS[key as PlanId].label} plan (${interval === "year" ? "yearly" : "monthly"})`;
  }
  const credit = CREDIT_PACKS.find((pack) => pack.key === key);
  if (credit) return `${credit.credits + credit.bonusCredits} credits pack`;
  const video = VIDEO_PACKS.find((pack) => pack.key === key);
  if (video) return `${video.videoUnits / 100} videos pack`;
  return key;
}

function itemPriceUsd(kind: string, key: string, interval: string | null): number | null {
  if (kind === "plan" && key in PLANS) {
    const plan = PLANS[key as PlanId];
    return interval === "year" ? plan.priceAnnualUsd : plan.priceMonthlyUsd;
  }
  return (
    CREDIT_PACKS.find((pack) => pack.key === key)?.usd ??
    VIDEO_PACKS.find((pack) => pack.key === key)?.usd ??
    null
  );
}

/** Email Mellox staff about a new Upgrade now request (reply goes to the customer). */
async function tellAdmins(
  request: PurchaseRequest,
  userId: string,
  contact: string | null,
  note: string | null,
): Promise<void> {
  try {
    const { data } = await admin.auth.admin.getUserById(userId);
    const email = data?.user?.email ?? undefined;
    const price = itemPriceUsd(request.kind, request.catalogKey, request.interval);
    const { notifyAdmins } = await import("./notify.server");
    const { appUrl } = await import("@/server/notify/email.server");
    await notifyAdmins({
      subject: `Upgrade request: ${itemName(request.kind, request.catalogKey, request.interval)}`,
      text: [
        `${email ?? "A customer"} wants ${itemName(request.kind, request.catalogKey, request.interval)}${price !== null ? ` (${price})` : ""}.`,
        contact ? `Phone / WhatsApp: ${contact}` : "",
        note ? `Note: ${note}` : "",
        "Collect payment, then activate it in the admin console.",
      ]
        .filter(Boolean)
        .join("\n\n"),
      replyTo: email,
      action: ["Open requests", appUrl("/admin")],
    });
  } catch (cause) {
    console.error("[billing] admin request email failed", cause);
  }
}

/** Tell the owner their plan or pack is on. */
async function tellOwner(
  account: BillingAccount,
  kind: string,
  key: string,
  interval: string | null,
  activeUntil?: string,
) {
  try {
    const { notify } = await import("./notify.server");
    const { appUrl } = await import("@/server/notify/email.server");
    const name = itemName(kind, key, interval);
    await notify({
      accountId: account.id,
      userId: account.owner_user_id,
      kind: "plan_activated",
      windowKey: `${kind}:${key}:${Date.now()}`,
      payload: { kind, key, activeUntil: activeUntil ?? null },
      email: {
        subject: kind === "plan" ? `Your ${name} is active` : `Your ${name} was added`,
        text:
          kind === "plan" && activeUntil
            ? `Thanks for your payment. Your ${name} is active until ${new Date(activeUntil).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.`
            : `Thanks for your payment. Your ${name} is in your balance now.`,
        action: ["Open Mellox", appUrl("/projects")],
      },
    });
  } catch (cause) {
    console.error("[billing] activation notice failed", cause);
  }
}

export async function listOwnPurchaseRequests(userId: string): Promise<PurchaseRequest[]> {
  const account = await accountForUser(userId);
  const { data, error } = await admin
    .from("billing_purchase_requests")
    .select("*")
    .eq("account_id", account.id)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw new HttpError(503, "Could not load your requests.");
  return (data ?? []).map(mapRequest);
}

export async function cancelOwnPurchaseRequest(userId: string, requestId: string): Promise<void> {
  const account = await accountForUser(userId);
  const { error } = await admin
    .from("billing_purchase_requests")
    .update({ status: "canceled", updated_at: new Date().toISOString() })
    .eq("id", requestId)
    .eq("account_id", account.id)
    .eq("status", "pending");
  if (error) throw new HttpError(503, "Could not cancel the request.");
}

async function loadAccount(accountId: string): Promise<BillingAccount> {
  const { data, error } = await admin
    .from("billing_accounts")
    .select("*")
    .eq("id", accountId)
    .maybeSingle();
  if (error) throw new HttpError(503, "Could not load the billing account.");
  if (!data) throw new HttpError(404, "Billing account not found.");
  return data as BillingAccount;
}

/** Record the operation first. Returns false when this id was already applied. */
async function recordActivation(row: {
  id: string;
  account_id: string;
  actor_user_id: string;
  kind: "plan" | "credit_pack" | "video_pack" | "end_plan";
  catalog_key: string;
  billing_interval?: BillingInterval | null;
  months?: number | null;
  active_until?: string | null;
  request_id?: string | null;
  reference?: string | null;
  reason: string;
}): Promise<boolean> {
  const { error } = await admin.from("billing_manual_activations").insert(row);
  if (!error) return true;
  if (error.code === "23505") return false;
  throw new HttpError(503, "Could not record the activation.");
}

async function closeRequest(requestId: string | undefined, actor: string, note?: string) {
  if (!requestId) return;
  const { error } = await admin
    .from("billing_purchase_requests")
    .update({
      status: "approved",
      handled_by: actor,
      handled_at: new Date().toISOString(),
      admin_note: note?.slice(0, 500) ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", requestId)
    .eq("status", "pending");
  if (error) console.error("[billing] could not close purchase request", error.code);
}

export function addMonths(from: Date, months: number): Date {
  const date = new Date(from);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, last));
  return date;
}

/**
 * Activate a paid plan that was paid offline. An upgrade inside a live manual
 * window grants only the prorated difference; otherwise a fresh monthly window
 * starts today. Monthly grants continue from the billing cron until the date.
 */
export async function activateManualPlan(args: {
  operationId: string;
  accountId: string;
  plan: PaidPlanId;
  interval: BillingInterval;
  months: number;
  actor: string;
  reason: string;
  reference?: string;
  requestId?: string;
  now?: Date;
}): Promise<{ replayed: boolean; activeUntil: string }> {
  const now = args.now ?? new Date();
  const account = await loadAccount(args.accountId);
  if (
    account.provider_subscription_id &&
    ["active", "trialing", "past_due"].includes(account.status)
  ) {
    throw new HttpError(
      409,
      "This account pays by card. Change the plan through its subscription.",
    );
  }
  const activeUntil = addMonths(now, args.months).toISOString();
  const fresh = await recordActivation({
    id: args.operationId,
    account_id: account.id,
    actor_user_id: args.actor,
    kind: "plan",
    catalog_key: args.plan,
    billing_interval: args.interval,
    months: args.months,
    active_until: activeUntil,
    request_id: args.requestId ?? null,
    reference: args.reference ?? null,
    reason: args.reason,
  });
  if (!fresh) return { replayed: true, activeUntil };

  const previous = entitledPlanFor(account, now);
  const liveWindow =
    previous !== "free" &&
    Boolean(account.comped_until && new Date(account.comped_until) > now) &&
    Boolean(account.next_grant_at && new Date(account.next_grant_at) > now);
  const changes: Record<string, unknown> = {
    comped_plan_id: args.plan,
    comped_until: activeUntil,
    billing_interval: args.interval,
    current_period_end: activeUntil,
    downgrade_to: null,
    downgrade_at: null,
    capacity_reconciled_at: null,
    updated_at: now.toISOString(),
  };
  if (liveWindow && planRank(args.plan) > planRank(previous)) {
    await grantPlanUpgrade({
      account,
      from: previous,
      to: args.plan,
      paymentId: `manual:${args.operationId}`,
      expiresAt: account.next_grant_at!,
      now,
    });
  } else if (!liveWindow) {
    // Same or lower plan inside a live window: the new plan applies from the
    // next monthly grant, so nothing is granted twice this month.
    const windowStart = now.toISOString();
    const next = nextMonthlyWindow(windowStart, windowStart);
    await grantPlanWindow({
      account,
      plan: args.plan,
      windowStart,
      expiresAt: next,
      providerRef: `manual:${args.operationId}`,
    });
    changes.current_period_start = windowStart;
    changes.grant_anchor = windowStart;
    changes.next_grant_at = next;
  }
  const { error } = await admin.from("billing_accounts").update(changes).eq("id", account.id);
  if (error) throw new HttpError(503, "Plan granted, but the account could not be updated.");
  await closeRequest(args.requestId, args.actor, args.reference);
  invalidateBillingAccount(account.id);
  await tellOwner(account, "plan", args.plan, args.interval, activeUntil);
  return { replayed: false, activeUntil };
}

/** End a manual plan now. Remaining plan credits expire with their window. */
export async function endManualPlan(args: {
  operationId: string;
  accountId: string;
  actor: string;
  reason: string;
}): Promise<{ replayed: boolean }> {
  const account = await loadAccount(args.accountId);
  if (!account.comped_plan_id) throw new HttpError(409, "This account has no manual plan.");
  const fresh = await recordActivation({
    id: args.operationId,
    account_id: account.id,
    actor_user_id: args.actor,
    kind: "end_plan",
    catalog_key: account.comped_plan_id,
    reason: args.reason,
  });
  if (!fresh) return { replayed: true };
  const now = new Date().toISOString();
  const { error } = await admin
    .from("billing_accounts")
    .update({ comped_until: now, capacity_reconciled_at: null, updated_at: now })
    .eq("id", account.id);
  if (error) throw new HttpError(503, "Could not end the plan.");
  invalidateBillingAccount(account.id);
  return { replayed: false };
}

/** Paid packs never expire. Paid credits may buy backlinks; the bonus is AI only. */
export async function grantManualPack(args: {
  operationId: string;
  accountId: string;
  kind: "credit_pack" | "video_pack";
  key: string;
  actor: string;
  reason: string;
  reference?: string;
  requestId?: string;
}): Promise<{ replayed: boolean }> {
  const account = await loadAccount(args.accountId);
  const credit = CREDIT_PACKS.find((pack) => pack.key === args.key);
  const video = VIDEO_PACKS.find((pack) => pack.key === args.key);
  if ((args.kind === "credit_pack" && !credit) || (args.kind === "video_pack" && !video)) {
    throw new HttpError(400, "Unknown pack.");
  }
  const fresh = await recordActivation({
    id: args.operationId,
    account_id: account.id,
    actor_user_id: args.actor,
    kind: args.kind,
    catalog_key: args.key,
    request_id: args.requestId ?? null,
    reference: args.reference ?? null,
    reason: args.reason,
  });
  if (!fresh) return { replayed: true };
  const ref = `manual:${args.operationId}`;
  if (credit) {
    await grantMeter({
      accountId: account.id,
      meter: "credits",
      amount: credit.credits,
      source: "pack",
      restriction: "any",
      idempotencyKey: `${ref}:credits`,
      providerRef: ref,
      reason: `${credit.key} (manual)`,
      actor: args.actor,
    });
    if (credit.bonusCredits > 0) {
      await grantMeter({
        accountId: account.id,
        meter: "credits",
        amount: credit.bonusCredits,
        source: "pack_bonus",
        restriction: "ai_only",
        idempotencyKey: `${ref}:bonus`,
        providerRef: ref,
        reason: `${credit.key} bonus (manual)`,
        actor: args.actor,
      });
    }
  } else if (video) {
    await grantMeter({
      accountId: account.id,
      meter: "video",
      amount: video.videoUnits,
      source: "pack",
      restriction: "any",
      idempotencyKey: `${ref}:video`,
      providerRef: ref,
      reason: `${video.key} (manual)`,
      actor: args.actor,
    });
  }
  await closeRequest(args.requestId, args.actor, args.reference);
  invalidateBillingAccount(account.id);
  await tellOwner(account, args.kind, args.key, null);
  return { replayed: false };
}

export async function declinePurchaseRequest(args: {
  requestId: string;
  actor: string;
  note?: string;
}): Promise<void> {
  const { error } = await admin
    .from("billing_purchase_requests")
    .update({
      status: "declined",
      handled_by: args.actor,
      handled_at: new Date().toISOString(),
      admin_note: args.note?.slice(0, 500) ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", args.requestId)
    .eq("status", "pending");
  if (error) throw new HttpError(503, "Could not decline the request.");
}
