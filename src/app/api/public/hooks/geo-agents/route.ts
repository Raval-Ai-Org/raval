// POST /api/public/hooks/geo-agents — pg_cron (every minute) advances GEO
// coding agent runs whose lease is free: new runs, approved plans, and runs a
// restart or deploy interrupted (they resume from their checkpoint). Auth +
// heartbeat come from defineCronRoute (x-cron-secret header, timing-safe).
import { defineCronRoute } from "@/server/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const POST = defineCronRoute({
  job: "geo-agents",
  expectedIntervalSeconds: 60,
  handler: async () => {
    const { runDueAgentRuns } = await import("@/server/geo/agents/runner.server");
    // Stay inside pg_net's call timeout; long stages continue on the next tick.
    return runDueAgentRuns({ budgetMs: 110_000, max: 2 });
  },
});

export async function GET() {
  return Response.json({ ok: true, hint: "POST with the x-cron-secret header" });
}
