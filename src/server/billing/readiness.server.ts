import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { HttpError } from "@/server/http-error";
import { getEntitlements } from "./entitlements.server";

type EntitlementArgs = Parameters<typeof getEntitlements>[0];

/** Keep legacy workspace lifecycle available until the billing schema is deployed. */
export async function optionalWorkspaceEntitlements(args: EntitlementArgs) {
  const { error } = await (supabaseAdmin as unknown as SupabaseClient)
    .from("billing_accounts")
    .select("id")
    .limit(0);
  if (error?.code === "PGRST205" && process.env.BILLING_ENFORCEMENT !== "on") return null;
  if (error) throw new HttpError(503, "Plan & billing is being set up. Please try again later.");
  return getEntitlements(args);
}
