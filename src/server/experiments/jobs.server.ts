// jobs.server.ts — the Proof Engine worker (ADR-0024 §5). No queue service:
// job rows leased with claim_experiment_jobs (FOR UPDATE SKIP LOCKED),
// advanced by the cron hook /api/public/hooks/experiments within a budget.
//
//   check_live           every 15 min after a merge, up to 7 days
//   pull_metrics         daily while running → queues analyze
//   analyze              verdict only at a checkpoint
//   check_contamination  weekly while running
// Pull requests are synced from the same hook (syncOpenDeliveries) and the
// GitHub webhook. A workspace with the flag off is skipped.
import "server-only";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ACCESS_LOST_INVALIDATE_DAYS } from "@/lib/experiments/constants";
import { isProofEngineEnabled } from "@/lib/feature-flags";
import {
  enqueueJob,
  loadExperimentAdmin,
  recordEvent,
  transition,
  type AssignmentRow,
  type ExperimentRow,
  type JobRow,
} from "./core.server";
import { runAnalysis } from "./analyze.server";
import { syncOpenDeliveries } from "./deliveries.server";
import {
  checkContamination,
  checkLive,
  CONTAMINATION_RETRY_MS,
  LIVE_RETRY_MS,
} from "./live-check.server";
import { pullExperimentMetrics } from "./metrics.server";
import { loadSiteSources } from "./sources.server";

const WORKER = `experiments-${process.pid}-${randomUUID().slice(0, 8)}`;
const LEASE_SECONDS = 150;

async function finish(job: JobRow, patch: Partial<JobRow>) {
  await supabaseAdmin
    .from("experiment_jobs")
    .update({ lease_until: null, locked_by: null, ...patch })
    .eq("id", job.id)
    .eq("locked_by", WORKER);
}

async function assignmentsOf(experimentId: string): Promise<AssignmentRow[]> {
  const { data, error } = await supabaseAdmin
    .from("experiment_assignments")
    .select("*")
    .eq("experiment_id", experimentId);
  if (error) throw new Error(error.message);
  return (data ?? []) as AssignmentRow[];
}

/**
 * Stop a test whose measurement can't be trusted any more: the Search Console
 * property changed, access has been lost for over a week, or the repository
 * no longer passes ownership.
 */
async function invalidIfBroken(experiment: ExperimentRow): Promise<string | null> {
  const s = await loadSiteSources(experiment.workspace_id);
  if (!s.gsc || s.gsc.id !== experiment.gsc_source_id) {
    return "The Search Console property changed during the test.";
  }
  if (experiment.ga4_source_id && (!s.ga4 || s.ga4.id !== experiment.ga4_source_id)) {
    return "The Google Analytics property changed during the test.";
  }
  if (
    s.gsc.status === "access_lost" &&
    Date.now() - Date.parse(s.gsc.updated_at) > ACCESS_LOST_INVALIDATE_DAYS * 86_400_000
  ) {
    return `Search Console access has been lost for more than ${ACCESS_LOST_INVALIDATE_DAYS} days.`;
  }
  if (!experiment.source_id) return "The website's repository was disconnected.";
  const { data: src } = await supabaseAdmin
    .from("workspace_sources")
    .select("ownership_status, ownership_site_host, ownership_checked_at, site_host")
    .eq("id", experiment.source_id)
    .maybeSingle();
  if (!src) return "The website's repository was disconnected.";
  if (src.ownership_status === "mismatch") {
    return "The repository no longer passes the ownership check for this website.";
  }
  return null;
}

async function invalidate(experiment: ExperimentRow, reason: string) {
  await transition(
    experiment,
    ["running", "analyzing", "awaiting_deploy"],
    "invalidated",
    { invalidated_at: new Date().toISOString(), invalid_reason: reason.slice(0, 500) },
    { kind: "invalidated", summary: reason },
  );
}

/**
 * Run one job. Returns when the same job should run again (recurring kinds),
 * or null when it is finished. A job never re-queues itself: its own row is
 * still pending, so the runner reschedules that row instead.
 */
async function handle(job: JobRow): Promise<Date | null> {
  const experiment = await loadExperimentAdmin(job.experiment_id);
  if (!experiment) return null;
  if (!isProofEngineEnabled(experiment.workspace_id)) {
    // Flipping the flag off pauses the worker for this workspace; it doesn't destroy anything.
    return new Date(Date.now() + 86_400_000);
  }
  switch (job.kind) {
    case "check_live": {
      if (!["awaiting_deploy", "rolling_out", "rolling_back"].includes(experiment.status))
        return null;
      const outcome = await checkLive(experiment);
      return outcome === "waiting" ? new Date(Date.now() + LIVE_RETRY_MS) : null;
    }
    case "pull_metrics": {
      if (!["running", "analyzing"].includes(experiment.status)) return null;
      const broken = await invalidIfBroken(experiment);
      if (broken) {
        await invalidate(experiment, broken);
        return null;
      }
      const s = await loadSiteSources(experiment.workspace_id);
      const assignments = await assignmentsOf(experiment.id);
      const outcome = await pullExperimentMetrics({
        experiment,
        assignments,
        gsc: s.gsc!,
        ga4: s.ga4,
      });
      if (outcome?.ga4Deferred) {
        await recordEvent(
          experiment,
          "data_deferred",
          "Google Analytics used up today's data allowance; its numbers will be pulled tomorrow.",
        );
      }
      await enqueueJob(experiment, "analyze", new Date());
      return new Date(Date.now() + 24 * 3600_000);
    }
    case "analyze": {
      if (experiment.status !== "running") return null;
      const s = await loadSiteSources(experiment.workspace_id);
      await runAnalysis(experiment, await assignmentsOf(experiment.id), s.ga4?.currency ?? null);
      return null;
    }
    case "check_contamination": {
      if (!["running", "analyzing"].includes(experiment.status)) return null;
      const { contaminated } = await checkContamination(experiment);
      return contaminated ? null : new Date(Date.now() + CONTAMINATION_RETRY_MS);
    }
    default:
      return null;
  }
}

async function complete(job: JobRow, again: Date | null) {
  await finish(
    job,
    again
      ? { status: "queued", next_attempt_at: again.toISOString(), attempts: 0, last_error: null }
      : { status: "done", finished_at: new Date().toISOString(), last_error: null },
  );
}

/** Safety net: every running experiment always has its daily pull queued. */
async function ensureRecurring() {
  const { data } = await supabaseAdmin
    .from("experiments")
    .select("id, workspace_id")
    .in("status", ["running"])
    .limit(200);
  for (const e of data ?? []) {
    const { data: pending } = await supabaseAdmin
      .from("experiment_jobs")
      .select("id")
      .eq("experiment_id", e.id)
      .eq("kind", "pull_metrics")
      .in("status", ["queued", "running"])
      .limit(1);
    if (!pending?.length) await enqueueJob(e, "pull_metrics", new Date());
  }
}

export async function runDueExperimentJobs(opts: { budgetMs: number }) {
  const deadline = Date.now() + opts.budgetMs;
  let synced = 0;
  try {
    synced = await syncOpenDeliveries();
  } catch (e) {
    console.error("[experiments] delivery sync failed", e instanceof Error ? e.message : e);
  }
  await ensureRecurring().catch((e) =>
    console.error("[experiments] recurring check failed", e instanceof Error ? e.message : e),
  );
  let processed = 0;
  let failed = 0;
  while (Date.now() < deadline - 20_000) {
    const { data, error } = await supabaseAdmin.rpc("claim_experiment_jobs", {
      p_worker: WORKER,
      p_max: 2,
      p_lease_seconds: LEASE_SECONDS,
    });
    if (error) throw new Error(error.message);
    const jobs = (data ?? []) as JobRow[];
    if (!jobs.length) break;
    for (const job of jobs) {
      try {
        await complete(job, await handle(job));
        processed++;
      } catch (e) {
        failed++;
        const message = (e instanceof Error ? e.message : String(e)).slice(0, 500);
        const retry = job.attempts < job.max_attempts;
        await finish(job, {
          status: retry ? "queued" : "failed",
          last_error: message,
          next_attempt_at: new Date(
            Date.now() + Math.min(2 ** job.attempts, 48) * 15 * 60_000,
          ).toISOString(),
          ...(retry ? {} : { finished_at: new Date().toISOString() }),
        });
        if (!retry) {
          const experiment = await loadExperimentAdmin(job.experiment_id).catch(() => null);
          if (experiment) {
            await recordEvent(
              experiment,
              "job_failed",
              `A background step (${job.kind}) kept failing: ${message}`.slice(0, 500),
            );
          }
        }
      }
    }
  }
  return { processed, failed, synced };
}

/** Run one job right after the response (after()), e.g. a first live check. */
export async function kickJob(jobId: string) {
  const { data } = await supabaseAdmin.rpc("claim_experiment_jobs", {
    p_worker: WORKER,
    p_max: 1,
    p_lease_seconds: LEASE_SECONDS,
    p_id: jobId,
  });
  for (const job of (data ?? []) as JobRow[]) {
    try {
      await complete(job, await handle(job));
    } catch (e) {
      await finish(job, {
        status: "queued",
        last_error: (e instanceof Error ? e.message : String(e)).slice(0, 500),
      });
    }
  }
}
