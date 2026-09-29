import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Meter } from "@/lib/billing/catalog";
import type { StudioJob } from "@/lib/studio/jobs";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { HttpError } from "@/server/http-error";
import { captureMeter, releaseMeter } from "./meters.server";
import { runWithScope } from "@/server/request-context";

const admin = supabaseAdmin as unknown as SupabaseClient;

type StudioBillingLink = {
  job_id: string;
  account_id: string;
  workspace_id: string;
  hold_id: string | null;
  charge_id: string | null;
  charge_key: string;
  action: string;
  meter: Meter;
  amount: number;
  route: string;
  mode: "off" | "shadow" | "on";
  shadow_decision: string;
  settled_at: string | null;
};

export async function saveStudioBillingLink(
  args: Omit<StudioBillingLink, "settled_at">,
): Promise<void> {
  const { error } = await admin.from("billing_studio_jobs").insert(args);
  if (error) {
    // Called before provider work starts. The caller marks the job failed and
    // releases the hold; report a short error without exposing provider data.
    console.error("[billing] Studio job link failed", error.code);
    throw new HttpError(503, "Could not record render billing.");
  }
}

export async function studioBillingLink(jobId: string): Promise<StudioBillingLink | null> {
  const { data, error } = await admin
    .from("billing_studio_jobs")
    .select("*")
    .eq("job_id", jobId)
    .maybeSingle();
  if (error?.code === "PGRST205" && process.env.BILLING_ENFORCEMENT !== "on") return null;
  if (error) throw new HttpError(503, "Could not load render billing.");
  return (data as StudioBillingLink | null) ?? null;
}

export async function settleStudioBilling(job: StudioJob): Promise<void> {
  if (job.status === "running" || job.status === "queued") return;
  const link = await studioBillingLink(job.id);
  if (!link || link.settled_at) return;
  const succeeded = job.status === "succeeded";
  if (succeeded && link.hold_id) {
    await captureMeter({
      accountId: link.account_id,
      holdId: link.hold_id,
      amount: Number(link.amount),
      idempotencyKey: link.charge_key,
      route: link.route,
      chargeId: link.charge_id ?? undefined,
    });
  } else if (!succeeded && link.hold_id) {
    await releaseMeter({
      accountId: link.account_id,
      holdId: link.hold_id,
      idempotencyKey: `${link.charge_key}:failed`,
      reason: "Studio render did not complete",
    });
  } else if (succeeded && link.mode === "shadow" && link.shadow_decision === "would_charge") {
    const { error } = await admin.from("billing_shadow_events").insert({
      account_id: link.account_id,
      workspace_id: link.workspace_id,
      action: link.action,
      meter: link.meter,
      amount: link.amount,
      decision: "would_charge",
      idempotency_key: `studio:${job.id}`,
    });
    if (error && error.code !== "23505") {
      throw new HttpError(503, "Could not record render shadow billing.");
    }
  }
  const { error: updateError } = await admin
    .from("billing_studio_jobs")
    .update({ settled_at: new Date().toISOString() })
    .eq("job_id", job.id)
    .is("settled_at", null);
  if (updateError) throw new HttpError(503, "Could not finalize render billing.");
}

/** Advance a small batch from the billing hook even when the user closes the tab. */
export async function advanceStudioBillingJobs(
  limit = 8,
): Promise<{ checked: number; settled: number }> {
  const { data, error } = await admin
    .from("billing_studio_jobs")
    .select("job_id,workspace_id,account_id,charge_id")
    .is("settled_at", null)
    .order("created_at", { ascending: true })
    .limit(Math.min(20, Math.max(1, limit)));
  if (error) throw new Error("Could not load pending Studio billing jobs.");
  const { advanceStudioJob, getJobRow } = await import("@/server/studio/runner.server");
  let checked = 0;
  let settled = 0;
  for (const link of data ?? []) {
    try {
      const row = await getJobRow(admin, String(link.workspace_id), String(link.job_id));
      if (!row) continue;
      checked++;
      const job = await runWithScope(
        {
          billingAccountId: String(link.account_id),
          billingChargeId: link.charge_id ? String(link.charge_id) : undefined,
          workspaceId: String(link.workspace_id),
          route: "studio/jobs:advance",
        },
        () => advanceStudioJob(admin, row),
      );
      await settleStudioBilling(job);
      if (job.status !== "running" && job.status !== "queued") settled++;
    } catch (failure) {
      console.error("[billing] Studio job advancement failed", link.job_id, failure);
    }
  }
  return { checked, settled };
}
