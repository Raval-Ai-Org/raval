// Jobs console: one read-only list over the background work other features own
// (Studio, GEO scans, experiments, Autopilot) and, for Studio jobs only, two
// actions that call the owner's own code:
//   cancel — cancelStudioJob + settleStudioBilling, exactly what the customer's
//            cancel button runs (the credit hold is released the same way);
//   nudge  — one poll/advance, exactly what a customer's page poll runs. It
//            re-drives a render that is stuck waiting for someone to look at it.
// Retrying a failed job is deliberately not here: it spends credits and acts
// with the customer's billing and role, so it stays the customer's (or the
// owning feature's) action. Every action is audited, with its reason.
import "server-only";
import type { AdminJobRow, AdminJobs, AdminJobSource } from "@/lib/admin/types";
import { HttpError } from "@/server/http-error";
import { recordAdminAudit, type AuditContext } from "./audit.server";
import { adminDb, adminRpc, httpErrorFromPg } from "./db.server";

type Actor = { actorId: string; actorRole: string; audit: AuditContext };

type Raw = {
  generated_at: string;
  counts: Array<{ source: AdminJobSource; active: number; stuck: number; failed_24h: number }>;
  total: number;
  rows: Array<{
    source: AdminJobSource;
    id: string;
    workspace_id: string;
    kind: string;
    status: string;
    attempts: number | null;
    max_attempts: number | null;
    created_at: string;
    updated_at: string;
    error: string;
    stuck: boolean;
  }>;
};

const n = (value: unknown) => Number(value ?? 0);

export async function listJobs(query: {
  source: "all" | AdminJobSource;
  state: "all" | "active" | "failed" | "stuck";
  page: number;
  pageSize: number;
}): Promise<AdminJobs> {
  const raw = await adminRpc<Raw>(
    "admin_jobs",
    {
      p_source: query.source,
      p_state: query.state,
      p_limit: query.pageSize,
      p_offset: (query.page - 1) * query.pageSize,
    },
    "Jobs are unavailable.",
  );
  return {
    generatedAt: raw.generated_at,
    counts: raw.counts.map((c) => ({
      source: c.source,
      active: n(c.active),
      stuck: n(c.stuck),
      failed24h: n(c.failed_24h),
    })),
    total: n(raw.total),
    page: query.page,
    pageSize: query.pageSize,
    rows: raw.rows.map((row): AdminJobRow => ({
      source: row.source,
      id: row.id,
      workspaceId: row.workspace_id,
      kind: row.kind,
      status: row.status,
      attempts: row.attempts === null ? null : n(row.attempts),
      maxAttempts: row.max_attempts === null ? null : n(row.max_attempts),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      error: row.error,
      stuck: Boolean(row.stuck),
      // Only Studio jobs have admin actions, and only while they are in flight.
      canAct: row.source === "studio" && ["queued", "running"].includes(row.status),
    })),
  };
}

async function studioWorkspaceOf(id: string): Promise<string> {
  const { data, error } = await adminDb
    .from("studio_jobs")
    .select("workspace_id,status")
    .eq("id", id)
    .maybeSingle();
  if (error) throw httpErrorFromPg(error, "Could not load the job.");
  if (!data) throw new HttpError(404, "Job not found.");
  return String((data as { workspace_id: string }).workspace_id);
}

export async function cancelStudio(actor: Actor, id: string, reason: string) {
  const workspaceId = await studioWorkspaceOf(id);
  const entry = {
    actorUserId: actor.actorId,
    actorRole: actor.actorRole,
    action: "job.cancelled",
    targetType: "studio_job",
    targetId: id,
    workspaceId,
    reason,
  };
  try {
    const { cancelStudioJob } = await import("@/server/studio/runner.server");
    const { settleStudioBilling } = await import("@/server/billing/studio-async.server");
    const job = await cancelStudioJob(adminDb, workspaceId, id);
    await settleStudioBilling(job);
    await recordAdminAudit({ ...entry, after: { status: job.status } }, actor.audit);
    return { status: job.status };
  } catch (error) {
    await recordAdminAudit(
      { ...entry, success: false, error: error instanceof Error ? error.message : "Failed" },
      actor.audit,
    );
    throw error;
  }
}

export async function nudgeStudio(actor: Actor, id: string, reason: string) {
  const workspaceId = await studioWorkspaceOf(id);
  const entry = {
    actorUserId: actor.actorId,
    actorRole: actor.actorRole,
    action: "job.nudged",
    targetType: "studio_job",
    targetId: id,
    workspaceId,
    reason,
  };
  try {
    const { advanceStudioJob, getJobRow } = await import("@/server/studio/runner.server");
    const { settleStudioBilling, studioBillingLink } =
      await import("@/server/billing/studio-async.server");
    const { runWithScope } = await import("@/server/request-context");
    const row = await getJobRow(adminDb, workspaceId, id);
    if (!row) throw new HttpError(404, "Job not found.");
    if (row.status !== "running") {
      throw new HttpError(409, "Only a running job can be nudged.");
    }
    const billing = await studioBillingLink(row.id);
    const advanced = billing
      ? await runWithScope(
          { billingAccountId: billing.account_id, billingChargeId: billing.charge_id ?? undefined },
          () => advanceStudioJob(adminDb, row),
        )
      : await advanceStudioJob(adminDb, row);
    await settleStudioBilling(advanced);
    await recordAdminAudit({ ...entry, after: { status: advanced.status } }, actor.audit);
    return { status: advanced.status };
  } catch (error) {
    await recordAdminAudit(
      { ...entry, success: false, error: error instanceof Error ? error.message : "Failed" },
      actor.audit,
    );
    throw error;
  }
}
