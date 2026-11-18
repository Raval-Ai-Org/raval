// Gifts to one person from their admin page: credits on their own wallet, or
// a plan for a number of months. Both reuse the billing module's own paths
// (grantMeter, activateManualPlan), keyed by an operation id made when the
// form opened, so a double click is a replay. Each is audited on the person,
// success and failure alike, the same way as the workspace credit grant.
import "server-only";
import { HttpError } from "@/server/http-error";
import { accountForUser } from "@/server/billing/accounts.server";
import { grantMeter } from "@/server/billing/meters.server";
import { UNITS_PER_CREDIT } from "@/lib/billing/catalog";
import { recordAdminAudit, type AuditContext } from "./audit.server";
import { adminDb } from "./db.server";

/** Whole credits in one gift (the person sees credits; the ledger keeps units). */
export const USER_CREDIT_GIFT_MAX = 1000;
export const USER_PLAN_MONTHS_MAX = 12;
export const GIFT_PLANS = ["starter", "growth", "agency"] as const;
export type GiftPlan = (typeof GIFT_PLANS)[number];

type Actor = { actorId: string; actorRole: string; audit: AuditContext };

export const ACCESS_DAYS_MAX = 90;
export const CREDIT_EXPIRY_DAYS_MAX = 365;
export const ACCESS_TIERS = ["trial", "starter", "growth", "agency"] as const;
export type AccessTier = (typeof ACCESS_TIERS)[number];

export async function giftUserCredits(
  actor: Actor,
  input: {
    userId: string;
    credits: number;
    reason: string;
    operationId: string;
    /** Credits disappear after this many days; none = they last. */
    expiresInDays?: number | null;
  },
): Promise<{ replayed: boolean; credits: number }> {
  if (input.userId === actor.actorId)
    throw new HttpError(403, "You can't gift credits to yourself.");
  const entry = {
    actorUserId: actor.actorId,
    actorRole: actor.actorRole,
    action: "credits.gifted",
    targetType: "user",
    targetId: input.userId,
    reason: input.reason,
  };
  try {
    const account = await accountForUser(input.userId);
    const result = await grantMeter({
      accountId: account.id,
      meter: "credits",
      amount: input.credits * UNITS_PER_CREDIT,
      source: "adjustment",
      restriction: "ai_only",
      idempotencyKey: `admin-gift:${input.operationId}`,
      reason: input.reason,
      actor: actor.actorId,
      ...(input.expiresInDays
        ? { expiresAt: new Date(Date.now() + input.expiresInDays * 86_400_000).toISOString() }
        : {}),
    });
    const replayed = Boolean(result.replayed);
    if (!replayed)
      await recordAdminAudit(
        {
          ...entry,
          after: {
            credits: input.credits,
            accountId: account.id,
            expiresInDays: input.expiresInDays ?? null,
          },
        },
        actor.audit,
      );
    return { replayed, credits: input.credits };
  } catch (error) {
    await recordAdminAudit(
      {
        ...entry,
        after: { credits: input.credits },
        success: false,
        error: error instanceof Error ? error.message : "Gift failed",
      },
      actor.audit,
    );
    throw error;
  }
}

export async function giftUserPlan(
  actor: Actor,
  input: { userId: string; plan: GiftPlan; months: number; reason: string; operationId: string },
): Promise<{ replayed: boolean; activeUntil: string }> {
  if (input.userId === actor.actorId) throw new HttpError(403, "You can't change your own plan.");
  const entry = {
    actorUserId: actor.actorId,
    actorRole: actor.actorRole,
    action: "plan.gifted",
    targetType: "user",
    targetId: input.userId,
    reason: input.reason,
  };
  try {
    const account = await accountForUser(input.userId);
    const { activateManualPlan } = await import("@/server/billing/manual.server");
    const result = await activateManualPlan({
      operationId: input.operationId,
      accountId: account.id,
      plan: input.plan,
      interval: "month",
      months: input.months,
      actor: actor.actorId,
      reason: input.reason,
      reference: "admin gift",
    });
    if (!result.replayed)
      await recordAdminAudit(
        {
          ...entry,
          before: { planId: account.plan_id, status: account.status },
          after: { plan: input.plan, months: input.months, activeUntil: result.activeUntil },
        },
        actor.audit,
      );
    return result;
  } catch (error) {
    await recordAdminAudit(
      {
        ...entry,
        after: { plan: input.plan, months: input.months },
        success: false,
        error: error instanceof Error ? error.message : "Plan gift failed",
      },
      actor.audit,
    );
    throw error;
  }
}

/**
 * Access for a number of days, no card: a plan (Starter, Growth, Agency) or
 * the trial tier (free features only, one brand, no video), with its own
 * credits that end with the pass. Nothing renews and no monthly grant runs
 * (next_grant_at is cleared); when the days end the account is back to no
 * plan by itself (entitledPlanFor reads comped_until). A card subscription is
 * never overwritten: change that one in its own billing.
 */
export async function giftAccessPass(
  actor: Actor,
  input: {
    userId: string;
    tier: AccessTier;
    days: number;
    credits: number;
    reason: string;
    operationId: string;
  },
): Promise<{ replayed: boolean; activeUntil: string }> {
  if (input.userId === actor.actorId) throw new HttpError(403, "You can't change your own access.");
  const entry = {
    actorUserId: actor.actorId,
    actorRole: actor.actorRole,
    action: "access.granted",
    targetType: "user",
    targetId: input.userId,
    reason: input.reason,
  };
  try {
    const account = await accountForUser(input.userId);
    if (
      account.provider_subscription_id &&
      ["active", "trialing", "past_due"].includes(account.status)
    )
      throw new HttpError(409, "This person pays by card. Change their plan in Billing desk.");
    const { invalidateBillingAccount } = await import("@/server/billing/accounts.server");
    const now = new Date();
    const activeUntil = new Date(now.getTime() + input.days * 86_400_000).toISOString();
    // The operation id makes a double click one pass: the credit grant below is
    // keyed by it, and the account row is only written when that grant is new.
    const grant =
      input.credits > 0
        ? await grantMeter({
            accountId: account.id,
            meter: "credits",
            amount: input.credits * UNITS_PER_CREDIT,
            source: "adjustment",
            restriction: "ai_only",
            idempotencyKey: `admin-pass:${input.operationId}`,
            expiresAt: activeUntil,
            reason: input.reason,
            actor: actor.actorId,
          })
        : null;
    if (grant?.replayed) return { replayed: true, activeUntil };
    const plan = input.tier === "trial" ? "starter" : input.tier;
    const { error } = await adminDb
      .from("billing_accounts")
      .update({
        comped_plan_id: plan,
        comped_until: activeUntil,
        comped_tier: input.tier === "trial" ? "trial" : null,
        next_grant_at: null,
        capacity_reconciled_at: null,
        updated_at: now.toISOString(),
      } as never)
      .eq("id", account.id);
    if (error) throw new HttpError(503, "Could not save the access.");
    invalidateBillingAccount(account.id);
    await recordAdminAudit(
      {
        ...entry,
        before: { planId: account.plan_id, compedUntil: account.comped_until },
        after: { tier: input.tier, days: input.days, credits: input.credits, activeUntil },
      },
      actor.audit,
    );
    return { replayed: false, activeUntil };
  } catch (error) {
    await recordAdminAudit(
      {
        ...entry,
        after: { tier: input.tier, days: input.days, credits: input.credits },
        success: false,
        error: error instanceof Error ? error.message : "Access grant failed",
      },
      actor.audit,
    );
    throw error;
  }
}

/** End a staff pass now (the account goes back to its own plan, or none). */
export async function endAccessPass(
  actor: Actor,
  input: { userId: string; reason: string },
): Promise<{ ended: boolean }> {
  const account = await accountForUser(input.userId);
  if (!account.comped_until || new Date(account.comped_until) <= new Date())
    return { ended: false };
  const { invalidateBillingAccount } = await import("@/server/billing/accounts.server");
  const now = new Date().toISOString();
  const { error } = await adminDb
    .from("billing_accounts")
    .update({
      comped_until: now,
      comped_tier: null,
      capacity_reconciled_at: null,
      updated_at: now,
    } as never)
    .eq("id", account.id);
  if (error) throw new HttpError(503, "Could not end the access.");
  invalidateBillingAccount(account.id);
  await recordAdminAudit(
    {
      actorUserId: actor.actorId,
      actorRole: actor.actorRole,
      action: "access.ended",
      targetType: "user",
      targetId: input.userId,
      reason: input.reason,
      before: { compedPlan: account.comped_plan_id, compedUntil: account.comped_until },
    },
    actor.audit,
  );
  return { ended: true };
}
