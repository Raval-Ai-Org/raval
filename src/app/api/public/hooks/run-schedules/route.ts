// POST /api/public/hooks/run-schedules — pg_cron (every minute) drives due
// scheduled_jobs and due Market Brain collections. Auth + heartbeat come from
// defineCronRoute (x-cron-secret header, timing-safe; 503 if CRON_SECRET unset).
import { defineCronRoute } from "@/server/cron";

export const dynamic = "force-dynamic";

export const POST = defineCronRoute({
  job: "run-schedules",
  expectedIntervalSeconds: 60,
  handler: async () => {
    const [{ runDueScheduledJobs }, { runDueMarketBrainCollections }] = await Promise.all([
      import("@/lib/schedules.server"),
      import("@/lib/market-brain-scheduler.server"),
    ]);
    const [scheduled, marketBrain] = await Promise.all([
      runDueScheduledJobs({ max: 25 }),
      runDueMarketBrainCollections({ max: 25 }),
    ]);
    return {
      ran: scheduled.ran + marketBrain.ran,
      failed: scheduled.failed,
    };
  },
});

export async function GET() {
  return Response.json({ ok: true, hint: "POST with the x-cron-secret header" });
}
