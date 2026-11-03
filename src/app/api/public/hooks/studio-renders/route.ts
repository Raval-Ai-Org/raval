// POST /api/public/hooks/studio-renders — pg_cron advances durable Studio
// provider tasks every minute. This is independent of browser polling, so a
// video continues when the user minimizes Studio, navigates away or closes it.
import { defineCronRoute } from "@/server/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const POST = defineCronRoute({
  job: "studio-renders",
  expectedIntervalSeconds: 60,
  handler: async () => {
    const { advanceStudioBillingJobs } = await import("@/server/billing/studio-async.server");
    return advanceStudioBillingJobs(25);
  },
});

export async function GET() {
  return Response.json({ ok: true, hint: "POST with the x-cron-secret header" });
}
