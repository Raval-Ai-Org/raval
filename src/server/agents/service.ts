// service.ts — the entry points routes use: run a worker for a workspace,
// run the periodic tick, and read the inbox. Production wiring (Supabase store,
// service-role db) lives here so routes stay thin and tests use memory stores.
import "server-only";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { agentsGloballyDisabled } from "./policy";
import { executeRun, type RunOutcome } from "./runtime";
import { supabaseAgentStore } from "./store";
import { getWorker } from "./workers";

export function productionStore() {
  return supabaseAgentStore(supabaseAdmin);
}

export async function runWorker(args: {
  worker: string;
  workspaceId: string;
  trigger: "manual" | "cron" | "event";
  createdBy?: string | null;
  input?: Record<string, unknown>;
}): Promise<RunOutcome> {
  const worker = getWorker(args.worker);
  if (!worker) throw new Error(`Unknown worker: ${args.worker}`);
  if (agentsGloballyDisabled()) {
    return { runId: "", status: "failed", summary: "", error: "Agents are disabled platform-wide." };
  }
  return executeRun(worker, {
    workspaceId: args.workspaceId,
    trigger: args.trigger,
    store: productionStore(),
    db: supabaseAdmin,
    createdBy: args.createdBy ?? null,
    input: args.input,
  });
}

/**
 * Periodic tick: run the Distribution Reliability worker for every workspace
 * with delivery activity in the last 7 days (bounded per tick).
 */
export async function agentsTick(opts: { maxWorkspaces?: number } = {}) {
  if (agentsGloballyDisabled()) return { ran: 0, skipped: "AGENTS_DISABLED" };
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data, error } = await supabaseAdmin
    .from("content_publications")
    .select("workspace_id")
    .gte("updated_at", since)
    .limit(5000);
  if (error) throw new Error(error.message);
  const workspaces = [...new Set((data ?? []).map((r: { workspace_id: string }) => r.workspace_id))].slice(
    0,
    opts.maxWorkspaces ?? 50,
  );
  const outcomes: Array<{ workspaceId: string; status: string }> = [];
  for (const workspaceId of workspaces) {
    const out = await runWorker({ worker: "distribution-reliability", workspaceId, trigger: "cron" });
    outcomes.push({ workspaceId, status: out.status });
  }
  return {
    ran: outcomes.length,
    failed: outcomes.filter((o) => o.status === "failed").length,
  };
}
