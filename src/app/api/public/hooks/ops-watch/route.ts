// POST /api/public/hooks/ops-watch — pg_cron (every 5 min): alert on missed
// scheduler runs, AI spend anomalies, truncation spikes and webhook rejection
// spikes; prune operational logs. Auth + heartbeat from defineCronRoute.
import { defineCronRoute } from "@/server/cron";

export const dynamic = "force-dynamic";

export const POST = defineCronRoute({
  job: "ops-watch",
  expectedIntervalSeconds: 300,
  handler: async () => {
    const [{ supabaseAdmin }, { runOpsWatch }, { sendAlert }] = await Promise.all([
      import("@/integrations/supabase/client.server"),
      import("@/server/observability/ops-watch"),
      import("@/server/observability/alerts"),
    ]);
    return runOpsWatch({ db: supabaseAdmin, alert: sendAlert });
  },
});
