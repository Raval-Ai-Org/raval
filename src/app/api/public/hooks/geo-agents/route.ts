// POST /api/public/hooks/geo-agents — pg_cron (every minute) advances GEO
// coding agent runs whose lease is free: new runs, approved plans, and runs a
// restart or deploy interrupted (they resume from their checkpoint). It also
// publishes approved articles to websites and checks their live pages. Auth +
// heartbeat come from defineCronRoute (x-cron-secret header, timing-safe).
import { defineCronRoute } from "@/server/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const POST = defineCronRoute({
  job: "geo-agents",
  expectedIntervalSeconds: 60,
  handler: async () => {
    const { runDueAgentRuns, pruneAgentRuns } = await import("@/server/geo/agents/runner.server");
    // Stay inside pg_net's call timeout; long stages continue on the next tick.
    const runs = await runDueAgentRuns({ budgetMs: 80_000, max: 2 });
    const { runDuePublications } = await import("@/server/articles/publish.server");
    const publications = await runDuePublications({ budgetMs: 45_000, max: 4 }).catch((e) => {
      console.error("[geo-agents] publications failed", e);
      return null;
    });
    // Retention (ADR-0013): checkpoints holding repository code are dropped a day
    // after a run ends. Hourly is enough.
    const pruned = new Date().getUTCMinutes() === 0 ? await pruneAgentRuns() : null;
    return { ...runs, publications, pruned };
  },
});

export async function GET() {
  return Response.json({ ok: true, hint: "POST with the x-cron-secret header" });
}
