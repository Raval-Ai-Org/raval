import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { videoUnitsFor, type UgcModelKey, type VideoResolution } from "@/lib/billing/catalog";
import { isUgcModelKey } from "@/lib/ugc/models";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { HttpError } from "@/server/http-error";
import type { RenderRow } from "@/server/ugc/store";
import { captureMeter, releaseMeter } from "./meters.server";

const admin = supabaseAdmin as unknown as SupabaseClient;

type UgcLink = {
  render_id: string;
  account_id: string;
  workspace_id: string;
  hold_id: string | null;
  charge_id: string | null;
  charge_key: string;
  action: string;
  units: number;
  mode: "off" | "shadow" | "on";
  shadow_decision: string;
  settled_at: string | null;
};

export async function saveUgcBillingLink(args: Omit<UgcLink, "settled_at">): Promise<void> {
  const { error } = await admin.from("billing_ugc_renders").insert(args);
  if (error) {
    console.error("[billing] UGC render link failed", error.code);
    throw new HttpError(503, "Could not record video billing.");
  }
}

export async function settleUgcBilling(row: RenderRow): Promise<void> {
  if (
    row.status === "queued" ||
    row.status === "submitting" ||
    row.status === "processing" ||
    row.status === "persisting"
  )
    return;
  const { data, error } = await admin
    .from("billing_ugc_renders")
    .select("*")
    .eq("render_id", row.id)
    .maybeSingle();
  if (error) throw new HttpError(503, "Could not load video billing.");
  const link = data as UgcLink | null;
  if (!link || link.settled_at) return;
  const succeeded = row.status === "succeeded";
  const actualUnits =
    succeeded && isUgcModelKey(row.model_key)
      ? videoUnitsFor({
          ugcKey: row.model_key as UgcModelKey,
          seconds: row.duration_sec,
          resolution: row.resolution as VideoResolution,
          providerCostUsd: row.actual_cost_usd ?? undefined,
        })
      : link.units;
  if (actualUnits > link.units) {
    // The user accepted the quoted maximum. Never capture more than was held;
    // a provider cost jump is an operator margin alert, not a surprise charge.
    console.error("[billing] UGC provider cost exceeded held VC", row.id);
  }
  const capturedUnits = Math.min(link.units, actualUnits);
  if (succeeded && link.hold_id) {
    await captureMeter({
      accountId: link.account_id,
      holdId: link.hold_id,
      amount: capturedUnits,
      idempotencyKey: link.charge_key,
      route: "ugc/renders:create",
      chargeId: link.charge_id ?? undefined,
    });
  } else if (!succeeded && link.hold_id) {
    await releaseMeter({
      accountId: link.account_id,
      holdId: link.hold_id,
      idempotencyKey: `${link.charge_key}:failed`,
      reason: "Video render did not complete",
    });
  } else if (succeeded && link.mode === "shadow" && link.shadow_decision === "would_charge") {
    const { error: logError } = await admin.from("billing_shadow_events").insert({
      account_id: link.account_id,
      workspace_id: link.workspace_id,
      action: link.action,
      meter: "video",
      amount: capturedUnits,
      decision: "would_charge",
      idempotency_key: `ugc:${row.id}`,
    });
    if (logError && logError.code !== "23505") {
      throw new HttpError(503, "Could not record video shadow billing.");
    }
  }
  const { error: updateError } = await admin
    .from("billing_ugc_renders")
    .update({ settled_at: new Date().toISOString() })
    .eq("render_id", row.id)
    .is("settled_at", null);
  if (updateError) throw new HttpError(503, "Could not finalize video billing.");
}

/** Reconcile completed jobs after a worker restart or a closed browser tab. */
export async function settleTerminalUgcBilling(
  limit = 8,
): Promise<{ checked: number; settled: number }> {
  const { data, error } = await admin
    .from("billing_ugc_renders")
    .select("render_id")
    .is("settled_at", null)
    .order("created_at", { ascending: true })
    .limit(Math.min(20, Math.max(1, limit)));
  if (error) throw new Error("Could not load pending UGC billing renders.");
  const { supabaseUgcStore } = await import("@/server/ugc/store.supabase.server");
  let checked = 0;
  let settled = 0;
  for (const link of data ?? []) {
    try {
      const row = await supabaseUgcStore.getRender(String(link.render_id));
      if (!row) continue;
      checked++;
      if (["succeeded", "failed", "cancelled"].includes(row.status)) {
        await settleUgcBilling(row);
        settled++;
      }
    } catch (failure) {
      console.error("[billing] UGC render settlement failed", link.render_id, failure);
    }
  }
  return { checked, settled };
}
