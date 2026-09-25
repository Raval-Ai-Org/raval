// POST /api/public/hooks/experiments — pg_cron (every five minutes) runs the
// Proof Engine worker: sync Mellox experiment pull requests, then advance due
// experiment jobs (live checks, metric pulls, analysis, contamination checks).
// Auth + heartbeat come from defineCronRoute (x-cron-secret header).
import { defineCronRoute } from "@/server/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const POST = defineCronRoute({
  job: "experiments",
  expectedIntervalSeconds: 300,
  handler: async () => {
    const { runDueExperimentJobs } = await import("@/server/experiments/jobs.server");
    // Stay inside pg_net's call timeout; remaining jobs run on the next tick.
    return runDueExperimentJobs({ budgetMs: 110_000 });
  },
});

export async function GET() {
  return Response.json({ ok: true, hint: "POST with the x-cron-secret header" });
}
