// POST /api/public/hooks/agents-tick — pg_cron (every 15 min) runs the
// Distribution Reliability worker for workspaces with recent delivery activity.
// Read-only worker: the tick records findings, it never changes delivery state.
import { defineCronRoute } from "@/server/cron";

export const dynamic = "force-dynamic";

export const POST = defineCronRoute({
  job: "agents-tick",
  expectedIntervalSeconds: 15 * 60,
  handler: async () => {
    const { agentsTick } = await import("@/server/agents/service");
    return agentsTick({ maxWorkspaces: 50 });
  },
});
