// POST /api/public/hooks/analytics-sync — pg_cron (every 10 minutes) queues
// the daily Google Analytics 4 / Search Console incremental sync for each
// connected source and resumes initial backfills whose worker lease expired
// or that yielded at their time budget. Auth + heartbeat come from
// defineCronRoute (x-cron-secret header, timing-safe).
import { defineCronRoute } from "@/server/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const POST = defineCronRoute({
  job: "analytics-sync",
  expectedIntervalSeconds: 600,
  handler: async () => {
    const { runDueAnalyticsSyncs } = await import("@/server/analytics/sync/service.server");
    // Stay inside pg_net's 120 s call timeout.
    return runDueAnalyticsSyncs({ budgetMs: 55_000 });
  },
});

export async function GET() {
  return Response.json({ ok: true, hint: "POST with the x-cron-secret header" });
}
