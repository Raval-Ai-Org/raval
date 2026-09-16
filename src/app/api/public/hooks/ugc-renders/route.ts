// POST /api/public/hooks/ugc-renders — pg_cron (every minute) advances UGC
// video renders that are due: submissions to retry, provider tasks to check,
// finished videos to store. Also releases expired allowance holds. Auth +
// heartbeat come from defineCronRoute (x-cron-secret header, timing-safe).
import { defineCronRoute } from "@/server/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const POST = defineCronRoute({
  job: "ugc-renders",
  expectedIntervalSeconds: 60,
  handler: async () => {
    const { runDueUgcRenders } = await import("@/server/ugc/service.server");
    return runDueUgcRenders({ budgetMs: 100_000, max: 25 });
  },
});

export async function GET() {
  return Response.json({ ok: true, hint: "POST with the x-cron-secret header" });
}
