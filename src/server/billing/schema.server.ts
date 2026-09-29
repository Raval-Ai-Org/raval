import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { HttpError } from "@/server/http-error";

/** HEAD with limit(0) can succeed without ever resolving the table. */
export async function billingSchemaReady(): Promise<boolean> {
  const { error } = await (supabaseAdmin as unknown as SupabaseClient)
    .from("billing_accounts")
    .select("id")
    .limit(1);
  if (!error) return true;
  if (error.code === "PGRST205" || error.code === "42P01") return false;
  throw new HttpError(503, "Plan & billing is being set up. Please try again later.");
}

/** The UGC worker gate was added several migrations after billing_accounts. */
export async function ugcBillingColumnReady(): Promise<boolean> {
  if (!(await billingSchemaReady())) return false;
  const { error } = await (supabaseAdmin as unknown as SupabaseClient)
    .from("ugc_renders")
    .select("billing_ready")
    .limit(1);
  if (!error) return true;
  if (error.code === "42703" || error.code === "PGRST204") return false;
  throw new HttpError(503, "Video billing is being set up. Please try again later.");
}
