// POST /api/public/hooks/competitor-watch — pg_cron (every 30 min) scans
// competitor watches whose last_checked_at is stale and inserts alerts.
// Auth + heartbeat come from defineCronRoute (x-cron-secret header).
import { defineCronRoute } from "@/server/cron";

export const dynamic = "force-dynamic";

export const POST = defineCronRoute({
  job: "competitor-watch",
  expectedIntervalSeconds: 30 * 60,
  handler: async () => {
    const { runDueCompetitorScans } = await import("@/lib/competitor-watch.server");
    return runDueCompetitorScans({ max: 40 });
  },
});

export async function GET() {
  return Response.json({ ok: true, hint: "POST with the x-cron-secret header" });
}
