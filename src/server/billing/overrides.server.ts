// overrides.server.ts — load the entitlement overrides in force for a billing
// account (see src/lib/billing/overrides.ts for what they are and how they apply).
//
// Reads fail soft: if the table is missing (migration not applied yet) or the
// query fails, the plan's own entitlements stand and the problem is logged.
// An override is a convenience for staff; it must never be the reason a
// customer cannot use the product.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isEntitlementOverridesEnabled } from "@/lib/feature-flags";
import { isActiveOverride, type OverrideRow } from "@/lib/billing/overrides";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const admin = supabaseAdmin as unknown as SupabaseClient;

export const OVERRIDE_COLUMNS =
  "id,account_id,workspace_id,kind,key,allowed,limit_value,starts_at,expires_at,revoked_at,created_at";

export async function loadActiveOverrides(accountId: string): Promise<OverrideRow[]> {
  if (!isEntitlementOverridesEnabled()) return [];
  const now = new Date();
  const { data, error } = await admin
    .from("entitlement_overrides")
    .select(OVERRIDE_COLUMNS)
    .eq("account_id", accountId)
    .is("revoked_at", null)
    .lte("starts_at", now.toISOString())
    .limit(200);
  if (error) {
    // 42P01 / PGRST205: the table is not there yet. Anything else is worth a line.
    if (error.code !== "42P01" && error.code !== "PGRST205") {
      console.error("[billing] could not load entitlement overrides", error.code);
    }
    return [];
  }
  return ((data ?? []) as OverrideRow[]).filter((row) => isActiveOverride(row, now));
}
