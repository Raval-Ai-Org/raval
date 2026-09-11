// POST /api/public/hooks/sdr-reconcile — reconciliation backstop (FR-018),
// invoked by pg_cron every 5 minutes. Sweeps stale publishing/pending/retrying
// publications against each workspace's own SDR so nothing strands in
// "publishing". Auth + heartbeat come from defineCronRoute.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { reconcileStalePublications } from "@/lib/sdr.reconcile";
import { getWorkspaceSdrConfig } from "@/lib/sdr.helpers.server";
import { defineCronRoute } from "@/server/cron";

export const dynamic = "force-dynamic";

export const POST = defineCronRoute({
  job: "sdr-reconcile",
  expectedIntervalSeconds: 300,
  handler: () =>
    reconcileStalePublications({
      db: supabaseAdmin,
      sdrBaseUrl: process.env.SDR_BASE_URL ?? "",
      getConfig: getWorkspaceSdrConfig,
    }),
});
