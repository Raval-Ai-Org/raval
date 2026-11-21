import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { HttpError } from "@/server/http-error";
import { accountForUser, invalidateBillingAccount } from "./accounts.server";
import { getEntitlements } from "./entitlements.server";
import { globalBillingMode } from "./mode.server";

const admin = supabaseAdmin as unknown as SupabaseClient;

export async function reconcileBillingCapacity(args: {
  ownerUserId: string;
  preferredWorkspaceId?: string;
}): Promise<{ frozen_brands: number; suspended_seats: number }> {
  const account = await accountForUser(args.ownerUserId);
  const entitlements = await getEntitlements({
    userId: args.ownerUserId,
    skipCapacityReconcile: true,
  });
  if (entitlements.enforcement !== "on") {
    return { frozen_brands: 0, suspended_seats: 0 };
  }
  const { data, error } = await admin.rpc("reconcile_billing_capacity", {
    p_account: account.id,
    p_brand_limit: entitlements.limits.brands,
    p_seat_limit: entitlements.limits.seats,
    p_preferred_workspace: args.preferredWorkspaceId ?? null,
  });
  if (error) throw new HttpError(503, "Could not apply account capacity.");
  const { error: stampError } = await admin
    .from("billing_accounts")
    .update({ capacity_reconciled_at: new Date().toISOString() })
    .eq("id", account.id);
  if (stampError) throw new HttpError(503, "Could not record account capacity check.");
  invalidateBillingAccount(account.id);
  return data as { frozen_brands: number; suspended_seats: number };
}

/** Sweeps existing accounts after an enforcement switch, oldest unchecked first. */
export async function reconcilePendingBillingCapacity(
  limit = 50,
): Promise<{ checked: number; failed: number }> {
  // Only accounts whose limits may have changed since their last check (edited,
  // a comp/trial/grace/override boundary passed, or a 6-hour safety re-check),
  // decided in SQL: billing_accounts_due_capacity (20261118140000).
  const { data, error } = await admin.rpc(
    "billing_accounts_due_capacity" as never,
    {
      p_limit: limit,
      p_only_enforced: globalBillingMode() !== "on",
    } as never,
  );
  if (error) throw new Error("Could not load accounts for capacity reconciliation.");
  let checked = 0;
  let failed = 0;
  for (const row of (data ?? []) as { owner_user_id: string }[]) {
    try {
      await reconcileBillingCapacity({ ownerUserId: String(row.owner_user_id) });
      checked++;
    } catch {
      failed++;
    }
  }
  return { checked, failed };
}
