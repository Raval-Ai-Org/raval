// core.server.ts — shared plumbing for the Proof Engine (ADR-0024):
// the feature-flag gate, the caller context, compare-and-set status
// transitions, the append-only event log and job enqueueing.
//
// Browsers never write experiment rows (RLS gives members SELECT only), so
// every write here uses the service role — after the caller's role has been
// checked and the row has been read through the caller's own RLS client.
import "server-only";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json, Tables } from "@/integrations/supabase/types";
import type { UserSupabaseClient } from "@/integrations/supabase/client.user.server";
import { isProofEngineEnabled } from "@/lib/feature-flags";
import { assertTransition, type ExperimentStatus } from "@/lib/experiments/state";
import { roleAtLeast } from "@/server/api-auth";
import { HttpError } from "@/server/http-error";
import type { ServerFnContext } from "@/server/server-fn";
import { requireWorkspaceRole } from "@/server/workspace-access.server";

export class ExperimentError extends HttpError {
  constructor(message: string, status = 400) {
    super(status, message);
    this.name = "ExperimentError";
  }
}

export type ExperimentRow = Tables<"experiments">;
export type AssignmentRow = Tables<"experiment_assignments">;
export type ChangeRow = Tables<"experiment_changes">;
export type DeliveryRow = Tables<"experiment_deliveries">;
export type JobRow = Tables<"experiment_jobs">;
export type GroupRow = Tables<"experiment_page_groups">;

export type ExperimentCtx = {
  supabase: UserSupabaseClient;
  userId: string;
  workspaceId: string;
  canEdit: boolean;
  canManage: boolean;
};

/** Off means "doesn't exist": 404, exactly like an unknown route. */
export function assertEnabled(workspaceId: string) {
  if (!isProofEngineEnabled(workspaceId)) throw new ExperimentError("Not found", 404);
}

export async function experimentCtx(
  context: ServerFnContext,
  workspaceId: string,
  minRole: "viewer" | "editor" | "admin" = "viewer",
): Promise<ExperimentCtx> {
  assertEnabled(workspaceId);
  const role = await requireWorkspaceRole(context, workspaceId, minRole);
  return {
    supabase: context.supabase as unknown as UserSupabaseClient,
    userId: context.userId,
    workspaceId,
    canEdit: roleAtLeast(role, "editor"),
    canManage: roleAtLeast(role, "admin"),
  };
}

export function requireEditor(ctx: ExperimentCtx) {
  if (!ctx.canEdit) throw new ExperimentError("Only editors can change experiments.", 403);
}

/** Read through the caller's RLS client: another workspace's id is simply "not found". */
export async function loadExperiment(ctx: ExperimentCtx, id: string): Promise<ExperimentRow> {
  const { data, error } = await ctx.supabase
    .from("experiments")
    .select("*")
    .eq("workspace_id", ctx.workspaceId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new ExperimentError("Experiment not found", 404);
  return data as ExperimentRow;
}

export async function loadExperimentAdmin(id: string): Promise<ExperimentRow | null> {
  const { data, error } = await supabaseAdmin
    .from("experiments")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as ExperimentRow | null) ?? null;
}

export async function recordEvent(
  exp: Pick<ExperimentRow, "id" | "workspace_id">,
  kind: string,
  summary: string,
  data: Record<string, unknown> = {},
  actorId: string | null = null,
) {
  const { error } = await supabaseAdmin.from("experiment_events").insert({
    experiment_id: exp.id,
    workspace_id: exp.workspace_id,
    kind,
    summary: summary.slice(0, 500),
    data: data as Json,
    actor_id: actorId,
  });
  if (error) console.error("[experiments] event not recorded", kind, error.message);
}

/**
 * Compare-and-set status change. Returns the updated row, or null when the
 * experiment was no longer in any of `from` (someone else moved it first).
 */
export async function transition(
  exp: Pick<ExperimentRow, "id" | "workspace_id">,
  from: ExperimentStatus | ExperimentStatus[],
  to: ExperimentStatus,
  patch: Partial<ExperimentRow> = {},
  event?: {
    kind: string;
    summary: string;
    data?: Record<string, unknown>;
    actorId?: string | null;
  },
): Promise<ExperimentRow | null> {
  const froms = Array.isArray(from) ? from : [from];
  for (const f of froms) assertTransition(f, to);
  const { data, error } = await supabaseAdmin
    .from("experiments")
    .update({ ...patch, status: to })
    .eq("id", exp.id)
    .eq("workspace_id", exp.workspace_id)
    .in("status", froms)
    .select("*");
  if (error) throw new Error(error.message);
  const row = (data?.[0] as ExperimentRow | undefined) ?? null;
  if (row && event) {
    await recordEvent(exp, event.kind, event.summary, event.data ?? {}, event.actorId ?? null);
  }
  return row;
}

export async function patchExperiment(id: string, patch: Partial<ExperimentRow>) {
  const { error } = await supabaseAdmin.from("experiments").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export type JobKind = JobRow["kind"];

/** Queue a job; if one of this kind is already pending, pull it forward instead. */
export async function enqueueJob(
  exp: Pick<ExperimentRow, "id" | "workspace_id">,
  kind: "backfill" | "pull_metrics" | "check_live" | "check_contamination" | "analyze" | "sync_pr",
  runAt: Date = new Date(),
  payload: Record<string, unknown> = {},
) {
  const { error } = await supabaseAdmin.from("experiment_jobs").insert({
    experiment_id: exp.id,
    workspace_id: exp.workspace_id,
    kind,
    payload: payload as Json,
    next_attempt_at: runAt.toISOString(),
  });
  if (!error) return;
  if (error.code !== "23505") throw new Error(error.message);
  await supabaseAdmin
    .from("experiment_jobs")
    .update({ next_attempt_at: runAt.toISOString() })
    .eq("experiment_id", exp.id)
    .eq("kind", kind)
    .eq("status", "queued")
    .gt("next_attempt_at", runAt.toISOString());
}

export async function cancelJobs(experimentId: string, kinds?: JobKind[]) {
  let q = supabaseAdmin
    .from("experiment_jobs")
    .update({ status: "cancelled", finished_at: new Date().toISOString(), lease_until: null })
    .eq("experiment_id", experimentId)
    .in("status", ["queued", "running"]);
  if (kinds?.length) q = q.in("kind", kinds);
  const { error } = await q;
  if (error) throw new Error(error.message);
}

/** Days between two instants, rounded down (for "day N of the test"). */
export function daysBetween(fromIso: string, to = new Date()): number {
  return Math.max(0, Math.floor((to.getTime() - Date.parse(fromIso)) / 86_400_000));
}
