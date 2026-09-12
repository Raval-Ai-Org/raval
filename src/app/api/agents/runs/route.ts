// /api/agents/runs — run history and run detail (steps, policy decisions,
// model, cost, duration) for the Operations inbox. RLS-bound reads.
//   GET ?workspaceId=            → recent worker runs
//   GET ?workspaceId=&id=<run>   → one run with its steps
import { z } from "zod";
import { jsonError } from "@/server/api-auth";
import { defineRoute } from "@/server/route";

export const dynamic = "force-dynamic";

const RUN_COLS =
  "id, worker, trigger, status, summary, error, model, input_tokens, output_tokens, cost_usd, duration_ms, started_at, finished_at, created_at";

export const GET = defineRoute({
  name: "agents/runs",
  auth: "workspace",
  query: z.object({ workspaceId: z.string().optional(), id: z.string().uuid().optional() }),
  workspaceId: ({ query }) => query.workspaceId,
  handler: async ({ query, workspaceId, supabase }) => {
    if (query.id) {
      const [{ data: run, error }, { data: steps }] = await Promise.all([
        supabase
          .from("agent_runs")
          .select(RUN_COLS)
          .eq("id", query.id)
          .eq("workspace_id", workspaceId)
          .maybeSingle(),
        supabase
          .from("agent_run_steps")
          .select(
            "seq, kind, tool, redacted_args, policy_decision, status, result_summary, latency_ms, cost_usd, created_at",
          )
          .eq("run_id", query.id)
          .eq("workspace_id", workspaceId)
          .order("seq", { ascending: true }),
      ]);
      if (error) return jsonError(500, error.message);
      if (!run) return jsonError(404, "Run not found");
      return { run, steps: steps ?? [] };
    }
    const { data, error } = await supabase
      .from("agent_runs")
      .select(RUN_COLS)
      .eq("workspace_id", workspaceId)
      .not("worker", "is", null)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) return jsonError(500, error.message);
    return { runs: data ?? [] };
  },
});
