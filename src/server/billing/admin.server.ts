import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { HttpError } from "@/server/http-error";

const admin = supabaseAdmin as unknown as SupabaseClient;

/**
 * Mellox staff who may use the billing admin console. A comma-separated list
 * of Supabase user ids in BILLING_ADMIN_USER_IDS (MELLOX_ADMIN_USER_IDS is
 * accepted as the older name). Unset means nobody: the console fails closed.
 */
export function billingAdminIds(): string[] {
  const raw = [process.env.BILLING_ADMIN_USER_IDS, process.env.MELLOX_ADMIN_USER_IDS]
    .filter(Boolean)
    .join(",");
  return raw
    .split(",")
    .map((id) => id.trim())
    .filter((id) => /^[0-9a-f-]{36}$/i.test(id));
}

export function isBillingAdmin(userId: string | null | undefined): boolean {
  return Boolean(userId) && billingAdminIds().includes(String(userId));
}

/**
 * Billing access includes the break-glass environment list and active super
 * admins from the admin team. A super admin is defined as having everything,
 * so requiring a second hidden allowlist for this one screen is surprising
 * and can lock the founder out of billing operations.
 */
export async function hasBillingAdminAccess(userId: string | null | undefined): Promise<boolean> {
  if (!userId) return false;
  if (isBillingAdmin(userId)) return true;
  const { data, error } = await admin
    .from("admin_users")
    .select("role,status")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("[billing-admin] could not read admin role", error.message);
    return false;
  }
  return data?.role === "super_admin" && data.status === "active";
}

export async function requireBillingAdmin(userId: string): Promise<void> {
  if (!(await hasBillingAdminAccess(userId))) {
    throw new HttpError(403, "Billing administrator access required.");
  }
}
