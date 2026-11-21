// Promo trial codes: checking a code at checkout, claiming one use when the
// trial really starts (the Stripe webhook), and the staff tools in /admin.
//
// A code is checked twice: when the person types it (a friendly answer, and
// the checkout is opened with its days) and again when Stripe says the trial
// started (`redeem_promo_code`, a compare-and-set that also refuses a second
// trial on the same account or the same card). Only the second one counts a
// use. Every answer to a person is short and never says which rule refused.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { HttpError } from "@/server/http-error";
import { normalizePromoCode, PROMO_LIMITS, type PromoOffer } from "@/lib/billing/promo";
import type { BillingAccount } from "./accounts.server";

const admin = supabaseAdmin as unknown as SupabaseClient;

export type PromoRow = {
  id: string;
  code: string;
  label: string;
  trial_days: number;
  credits: number;
  max_redemptions: number | null;
  redeemed_count: number;
  starts_at: string | null;
  expires_at: string | null;
  active: boolean;
  note: string;
  created_at: string;
};

const NOT_VALID = "That code isn't valid. Check it and try again.";

function usable(row: PromoRow, now = new Date()): boolean {
  if (!row.active) return false;
  if (row.starts_at && new Date(row.starts_at) > now) return false;
  if (row.expires_at && new Date(row.expires_at) <= now) return false;
  if (row.max_redemptions !== null && row.redeemed_count >= row.max_redemptions) return false;
  return true;
}

export async function promoById(id: string): Promise<PromoRow | null> {
  const { data, error } = await admin
    .from("billing_promo_codes")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new HttpError(503, "Could not check the code.");
  return (data as PromoRow | null) ?? null;
}

/**
 * The offer behind a code for this account, or a 4xx with a plain reason.
 * Trials are for accounts that never paid and never had one.
 */
export async function promoOfferFor(
  account: BillingAccount,
  raw: unknown,
): Promise<PromoOffer & { id: string }> {
  const code = normalizePromoCode(raw);
  if (!code) throw new HttpError(400, NOT_VALID);
  const { data, error } = await admin
    .from("billing_promo_codes")
    .select("*")
    .eq("code", code)
    .maybeSingle();
  if (error) throw new HttpError(503, "Could not check the code. Try again in a moment.");
  const row = data as PromoRow | null;
  if (!row || !usable(row)) throw new HttpError(400, NOT_VALID);
  if (account.trial_used || account.last_paid_invoice_id || account.provider_subscription_id)
    throw new HttpError(409, "Trial codes are for new accounts. Pick a plan to continue.");
  const { data: used, error: usedError } = await admin
    .from("billing_promo_redemptions")
    .select("id")
    .eq("account_id", account.id)
    .maybeSingle();
  if (usedError) throw new HttpError(503, "Could not check the code. Try again in a moment.");
  if (used) throw new HttpError(409, "This account already had a trial. Pick a plan to continue.");
  return {
    id: row.id,
    code: row.code,
    days: row.trial_days,
    credits: row.credits,
    label: row.label || `${row.trial_days}-day trial`,
  };
}

/** One use, claimed when Stripe says the trial started. Null = refused. */
export async function redeemPromo(args: {
  codeId: string;
  accountId: string;
  userId: string | null;
  subscriptionId: string;
  fingerprint: string | null;
  trialEndsAt: string | null;
}): Promise<string | null> {
  const { data, error } = await admin.rpc("redeem_promo_code", {
    p_code: args.codeId,
    p_account: args.accountId,
    p_user: args.userId,
    p_subscription: args.subscriptionId,
    p_fingerprint: args.fingerprint,
    p_trial_ends: args.trialEndsAt,
  });
  if (error) throw new Error("Could not claim the trial code.");
  return typeof data === "string" ? data : null;
}

/** Keep the redemption's state in step with the subscription. Never throws. */
export async function markRedemption(subscriptionId: string, status: "converted" | "ended") {
  await admin
    .from("billing_promo_redemptions")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("subscription_id", subscriptionId)
    .eq("status", "trialing")
    .then(
      () => undefined,
      () => undefined,
    );
}

/* ───────────────────────────── staff ───────────────────────────── */

export type PromoAdminRow = PromoRow & {
  state: "live" | "paused" | "scheduled" | "expired" | "used_up";
  converted: number;
};

function stateOf(row: PromoRow, now = new Date()): PromoAdminRow["state"] {
  if (!row.active) return "paused";
  if (row.expires_at && new Date(row.expires_at) <= now) return "expired";
  if (row.starts_at && new Date(row.starts_at) > now) return "scheduled";
  if (row.max_redemptions !== null && row.redeemed_count >= row.max_redemptions) return "used_up";
  return "live";
}

export async function listPromos(): Promise<PromoAdminRow[]> {
  const [codes, redemptions] = await Promise.all([
    admin
      .from("billing_promo_codes")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200),
    admin.from("billing_promo_redemptions").select("code_id,status").limit(5000),
  ]);
  if (codes.error || redemptions.error) throw new HttpError(503, "Could not load promo codes.");
  const converted = new Map<string, number>();
  for (const row of redemptions.data ?? [])
    if (row.status === "converted")
      converted.set(String(row.code_id), (converted.get(String(row.code_id)) ?? 0) + 1);
  return ((codes.data ?? []) as PromoRow[]).map((row) => ({
    ...row,
    state: stateOf(row),
    converted: converted.get(row.id) ?? 0,
  }));
}

export type PromoRedemptionRow = {
  id: string;
  userId: string | null;
  name: string | null;
  status: string;
  trialEndsAt: string | null;
  createdAt: string;
};

export async function listRedemptions(codeId: string): Promise<PromoRedemptionRow[]> {
  const { data, error } = await admin
    .from("billing_promo_redemptions")
    .select("id,user_id,status,trial_ends_at,created_at")
    .eq("code_id", codeId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new HttpError(503, "Could not load who used the code.");
  const ids = [...new Set((data ?? []).map((row) => row.user_id).filter(Boolean))] as string[];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: profiles } = await admin.from("profiles").select("id,name").in("id", ids);
    for (const p of profiles ?? []) if (p.name) names.set(String(p.id), String(p.name));
  }
  return (data ?? []).map((row) => ({
    id: String(row.id),
    userId: row.user_id ? String(row.user_id) : null,
    name: row.user_id ? (names.get(String(row.user_id)) ?? null) : null,
    status: String(row.status),
    trialEndsAt: (row.trial_ends_at as string | null) ?? null,
    createdAt: String(row.created_at),
  }));
}

export type PromoInput = {
  code: string;
  label: string;
  days: number;
  credits: number;
  maxUses: number | null;
  expiresAt: string | null;
  note: string;
};

function checkInput(input: Omit<PromoInput, "code">) {
  const { days, credits, maxUses } = input;
  if (!Number.isInteger(days) || days < PROMO_LIMITS.days.min || days > PROMO_LIMITS.days.max)
    throw new HttpError(400, `Days must be ${PROMO_LIMITS.days.min} to ${PROMO_LIMITS.days.max}.`);
  if (
    !Number.isInteger(credits) ||
    credits < PROMO_LIMITS.credits.min ||
    credits > PROMO_LIMITS.credits.max
  )
    throw new HttpError(
      400,
      `Credits must be ${PROMO_LIMITS.credits.min} to ${PROMO_LIMITS.credits.max}.`,
    );
  if (
    maxUses !== null &&
    (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > PROMO_LIMITS.uses.max)
  )
    throw new HttpError(400, "Uses must be a whole number.");
  if (input.expiresAt && Number.isNaN(Date.parse(input.expiresAt)))
    throw new HttpError(400, "The end date isn't a date.");
}

export async function createPromo(actorId: string, input: PromoInput): Promise<PromoRow> {
  const code = normalizePromoCode(input.code);
  if (!code) throw new HttpError(400, "Codes are 4 to 32 letters, numbers and dashes.");
  checkInput(input);
  const { data, error } = await admin
    .from("billing_promo_codes")
    .insert({
      code,
      label: input.label.trim().slice(0, 80),
      trial_days: input.days,
      credits: input.credits,
      max_redemptions: input.maxUses,
      expires_at: input.expiresAt,
      note: input.note.trim().slice(0, 300),
      created_by: actorId,
    })
    .select("*")
    .single();
  if (error?.code === "23505") throw new HttpError(409, "That code already exists.");
  if (error || !data) throw new HttpError(503, "Could not save the code.");
  return data as PromoRow;
}

export async function updatePromo(
  id: string,
  patch: { active?: boolean; maxUses?: number | null; expiresAt?: string | null; label?: string },
): Promise<{ before: PromoRow; after: PromoRow }> {
  const before = await promoById(id);
  if (!before) throw new HttpError(404, "That code doesn't exist.");
  const changes: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.active !== undefined) changes.active = patch.active;
  if (patch.label !== undefined) changes.label = patch.label.trim().slice(0, 80);
  if (patch.expiresAt !== undefined) {
    if (patch.expiresAt && Number.isNaN(Date.parse(patch.expiresAt)))
      throw new HttpError(400, "The end date isn't a date.");
    changes.expires_at = patch.expiresAt;
  }
  if (patch.maxUses !== undefined) {
    if (patch.maxUses !== null && (!Number.isInteger(patch.maxUses) || patch.maxUses < 1))
      throw new HttpError(400, "Uses must be a whole number.");
    changes.max_redemptions = patch.maxUses;
  }
  const { data, error } = await admin
    .from("billing_promo_codes")
    .update(changes)
    .eq("id", id)
    .select("*")
    .single();
  if (error || !data) throw new HttpError(503, "Could not update the code.");
  return { before, after: data as PromoRow };
}
