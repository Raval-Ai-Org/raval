// POST /api/public/hooks/geo-scans — pg_cron (every minute) resumes AI
// Visibility scans whose worker lease expired: restarts, deploys, and full
// crawls that yielded at their time budget. Auth + heartbeat come from
// defineCronRoute (x-cron-secret header, timing-safe).
import { defineCronRoute } from "@/server/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const POST = defineCronRoute({
  job: "geo-scans",
  expectedIntervalSeconds: 60,
  handler: async () => {
    const { runDueGeoScans } = await import("@/server/geo/service.server");
    // Stay inside pg_net's 120 s call timeout.
    return runDueGeoScans({ budgetMs: 90_000, max: 3 });
  },
});

export async function GET() {
  return Response.json({ ok: true, hint: "POST with the x-cron-secret header" });
}
