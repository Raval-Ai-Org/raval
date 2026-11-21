// Does this person need a plan before they can use Mellox? There is no Free
// plan (ADR-0050): the answer is yes when billing is enforced and neither
// their own account nor the account behind the workspace they opened has
// one. A teammate in a paid brand never pays to get in; Mellox staff with
// billing access are never stopped. Paid work is refused on the server either
// way (402); this only decides where the browser lands.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { hasActivePlan } from "@/lib/billing/catalog";
import { accountForUser, accountForWorkspace } from "./accounts.server";
import { enforcementFor, entitledPlanFor } from "./entitlements.server";
import { billingSchemaReady } from "./schema.server";

const admin = supabaseAdmin as unknown as SupabaseClient;

export type PlanAccess = { needsPlan: boolean; isOwner: boolean };

export async function planAccess(userId: string, workspaceId?: string): Promise<PlanAccess> {
  if (!(await billingSchemaReady())) return { needsPlan: false, isOwner: true };
  const { hasBillingAdminAccess } = await import("./admin.server");
  if (await hasBillingAdminAccess(userId)) return { needsPlan: false, isOwner: true };

  if (workspaceId) {
    const { account } = await accountForWorkspace(workspaceId);
    const paid = hasActivePlan(entitledPlanFor(account));
    return {
      needsPlan: enforcementFor(account) === "on" && !paid,
      isOwner: account.owner_user_id === userId,
    };
  }

  const own = await accountForUser(userId);
  if (enforcementFor(own) !== "on" || hasActivePlan(entitledPlanFor(own)))
    return { needsPlan: false, isOwner: true };
  // Someone else's paid brand lets them in without a plan of their own.
  const { data } = await admin
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userId)
    .limit(20);
  for (const row of data ?? []) {
    const workspace = await accountForWorkspace(String(row.workspace_id)).catch(() => null);
    if (
      workspace &&
      workspace.account.owner_user_id !== userId &&
      hasActivePlan(entitledPlanFor(workspace.account))
    )
      return { needsPlan: false, isOwner: true };
  }
  return { needsPlan: true, isOwner: true };
}
