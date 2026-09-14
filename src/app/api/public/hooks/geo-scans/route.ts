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
    const [{ runDueGeoScans }, { runDueVerifications }, { syncStaleOpenProposals }] =
      await Promise.all([
        import("@/server/geo/service.server"),
        import("@/server/geo/fixes/verify.server"),
        import("@/server/geo/fixes/service.server"),
      ]);
    // Stay inside pg_net's 120 s call timeout: scans, then fix verifications,
    // then pull requests whose webhook may not have reached us.
    const scans = await runDueGeoScans({ budgetMs: 55_000, max: 3 });
    const verifications = await runDueVerifications({ budgetMs: 40_000, max: 2 }).catch((e) => ({
      error: e instanceof Error ? e.message : String(e),
    }));
    const pullRequests = await syncStaleOpenProposals(5).catch((e) => ({
      error: e instanceof Error ? e.message : String(e),
    }));
    return { ...scans, verifications, pullRequests };
  },
});

export async function GET() {
  return Response.json({ ok: true, hint: "POST with the x-cron-secret header" });
}
