// service.server.ts — a workspace's goals (ADR-0035). Callers
// (src/server/fns/goals.ts) have already checked the workspace role; writes
// here use the service role for that one workspace, and only ever store what
// decideGoals returned.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { GoalsSchema, type GoalsView, type WorkspaceGoals } from "@/lib/goals/contracts";
import { decideGoals, type GoalWarning } from "@/lib/goals/decide";
import { HttpError } from "@/server/http-error";
import { invalidateGoalContext } from "./context.server";

const db = supabaseAdmin as unknown as SupabaseClient;
const TABLE = "workspace_goals";

type Row = { goals: unknown; version: number; updated_at: string };

async function readRow(workspaceId: string): Promise<Row | null> {
  const { data, error } = await db
    .from(TABLE)
    .select("goals, version, updated_at")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(`Could not read goals: ${error.message}`);
  return (data as Row | null) ?? null;
}

export async function readGoals(workspaceId: string): Promise<WorkspaceGoals | null> {
  const row = await readRow(workspaceId);
  if (!row) return null;
  const parsed = GoalsSchema.safeParse(row.goals);
  return parsed.success ? parsed.data : null;
}

export async function getGoalsView(workspaceId: string): Promise<GoalsView> {
  const row = await readRow(workspaceId);
  const parsed = row ? GoalsSchema.safeParse(row.goals) : null;
  return {
    goals: parsed?.success ? parsed.data : null,
    version: row?.version ?? 0,
    updatedAt: row?.updated_at ?? null,
  };
}

export async function saveGoals(args: {
  workspaceId: string;
  userId: string;
  goals: unknown;
}): Promise<GoalsView & { warnings: GoalWarning[] }> {
  const existing = await readRow(args.workspaceId);
  const previous = existing ? GoalsSchema.safeParse(existing.goals) : null;
  const decision = decideGoals(args.goals, new Date(), previous?.success ? previous.data : null);
  if (!decision.ok) throw new HttpError(400, decision.error);
  const { error } = await db.from(TABLE).upsert(
    {
      workspace_id: args.workspaceId,
      goals: decision.goals,
      version: (existing?.version ?? 0) + 1,
      updated_by: args.userId,
    },
    { onConflict: "workspace_id" },
  );
  if (error) throw new HttpError(503, "Could not save your goal. Try again.");
  invalidateGoalContext(args.workspaceId);
  return { ...(await getGoalsView(args.workspaceId)), warnings: decision.warnings };
}
