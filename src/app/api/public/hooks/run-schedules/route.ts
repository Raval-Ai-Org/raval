// POST /api/public/hooks/run-schedules — pg_cron (every minute) drives due
// scheduled_jobs, due Market Brain collections and due Autopilot actions. Auth + heartbeat come from
// defineCronRoute (x-cron-secret header, timing-safe; 503 if CRON_SECRET unset).
import { after } from "next/server";
import { defineCronRoute } from "@/server/cron";

export const dynamic = "force-dynamic";
// Autopilot writes a piece inside this request (as the Studio route does).
export const maxDuration = 120;

export const POST = defineCronRoute({
  job: "run-schedules",
  expectedIntervalSeconds: 60,
  handler: async () => {
    const [{ runDueScheduledJobs }, { runDueMarketBrainCollections }, { runDueAutopilot }] =
      await Promise.all([
        import("@/lib/schedules.server"),
        import("@/lib/market-brain-scheduler.server"),
        import("@/server/autopilot/service.server"),
      ]);
    // Shared social trends: refreshed every few days, a no-op otherwise. Runs
    // after the response so it never slows or fails the schedules.
    after(async () => {
      try {
        const { refreshSocialTrendsIfDue } = await import("@/server/studio/social-trends.server");
        await refreshSocialTrendsIfDue();
      } catch (error) {
        console.error("[social-trends] refresh failed", error);
      }
    });
    const [scheduled, marketBrain, autopilot] = await Promise.all([
      runDueScheduledJobs({ max: 25 }),
      runDueMarketBrainCollections({ max: 25 }),
      // Never let Autopilot fail the schedules it shares this hook with.
      runDueAutopilot({ budgetMs: 45_000, max: 12 }).catch((error) => {
        console.error("[autopilot] sweep failed", error);
        return { claimed: 0, advanced: 0, failed: 1, deferred: 0 };
      }),
    ]);
    return {
      ran: scheduled.ran + marketBrain.ran,
      failed: scheduled.failed,
      autopilot,
    };
  },
});

export async function GET() {
  return Response.json({ ok: true, hint: "POST with the x-cron-secret header" });
}
