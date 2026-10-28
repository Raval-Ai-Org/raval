import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { PLANS, type PlanId } from "@/lib/billing/catalog";
import { creationProviderLimits } from "@/lib/billing/creation-economics";
import { notifyAdmins } from "./notify.server";

const admin = supabaseAdmin as unknown as SupabaseClient;
export type CreationCostRow = {
  account_id: string;
  window_start: string;
  plan_id: PlanId;
  billing_interval: "month" | "year" | null;
  provider_usd: number;
  calls: number;
  creation_points_spent: number;
  provider_limit_usd: number;
};
export async function creationCostReport(): Promise<CreationCostRow[]> {
  const { data, error } = await admin.rpc("creation_cost_report");
  if (error || !Array.isArray(data)) throw new Error("Creation cost report is unavailable.");
  return data
    .filter((row) => row.plan_id in PLANS)
    .map((row) => ({
      ...row,
      provider_usd: Number(row.provider_usd),
      calls: Number(row.calls),
      creation_points_spent: Number(row.creation_points_spent),
      provider_limit_usd: creationProviderLimits(row.plan_id as PlanId, row.billing_interval)
        .monthlyUsd,
    }));
}

/** An operator warning, not a customer debit. Dedupe in the database per window. */
export async function warnCreationCosts(): Promise<number> {
  const rows = await creationCostReport();
  let warned = 0;
  for (const row of rows) {
    if (!row.provider_limit_usd || row.provider_usd < row.provider_limit_usd * 0.8) continue;
    const { data, error } = await admin
      .from("billing_creation_windows")
      .update({ cost_warning_at: new Date().toISOString() })
      .eq("account_id", row.account_id)
      .eq("window_start", row.window_start)
      .is("cost_warning_at", null)
      .select("account_id");
    if (error) throw new Error("Could not record provider-cost warning.");
    if (!data?.length) continue;
    console.warn(
      "[billing] creation provider budget warning",
      row.account_id,
      row.provider_usd,
      row.provider_limit_usd,
    );
    await notifyAdmins({
      subject: "Mellox provider-cost budget warning",
      text: `Account ${row.account_id} has $${row.provider_usd.toFixed(2)} of recorded provider usage against a $${row.provider_limit_usd.toFixed(2)} emergency ceiling. Review retries, model routing and usage attribution. This is provider spending, not an invoice profit calculation.`,
    });
    warned++;
  }
  return warned;
}
