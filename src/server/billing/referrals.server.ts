import "server-only";

// Record who invited a new person (from the /r/<code> cookie). Idempotent:
// referrals.referred_account_id is unique, so a later sign-in is a no-op.

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ensureAccount } from "./accounts.server";

const admin = supabaseAdmin as unknown as SupabaseClient;

/** Only brand-new accounts can be referred (created within the last 7 days). */
const NEW_ACCOUNT_MS = 7 * 86_400_000;

export async function attributeReferral(userId: string, rawCode: string): Promise<boolean> {
  const code = rawCode.trim().toUpperCase();
  if (!/^[A-Z0-9]{6,20}$/.test(code)) return false;
  const { data: referrer } = await admin
    .from("billing_accounts")
    .select("id,owner_user_id")
    .eq("referral_code", code)
    .maybeSingle();
  if (!referrer || referrer.owner_user_id === userId) return false;
  const account = await ensureAccount(userId);
  if (Date.now() - new Date(account.created_at).getTime() > NEW_ACCOUNT_MS) return false;
  const { error } = await admin.from("referrals").insert({
    referrer_account_id: referrer.id,
    referred_account_id: account.id,
  });
  if (error) return false;
  await admin
    .from("billing_accounts")
    .update({ referred_by_account_id: referrer.id })
    .eq("id", account.id)
    .is("referred_by_account_id", null);
  return true;
}
