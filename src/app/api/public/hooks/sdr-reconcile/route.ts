// POST /api/public/hooks/sdr-reconcile — distribution reconciliation backstop,
// invoked by pg_cron every 5 minutes (job name kept for the existing schedule
// and heartbeat). Sweeps stale in-flight deliveries against the provider that
// owns them so nothing strands in "publishing":
//   * SDR rows against each workspace's own SDR (when the SDR is configured);
//   * SocialAPI.ai rows via GET /posts/{id}, plus engagement metrics refresh.
// Auth + heartbeat come from defineCronRoute.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { reconcileStalePublications } from "@/lib/sdr.reconcile";
import { getWorkspaceSdrConfig } from "@/lib/sdr.helpers.server";
import { defineCronRoute } from "@/server/cron";
import { isSocialApiConfigured } from "@/lib/feature-flags";
import { reconcileSocialApi } from "@/lib/socialapi/reconcile";
import { getSocialApiClient, socialDb } from "@/lib/socialapi/workspace.server";

export const dynamic = "force-dynamic";

export const POST = defineCronRoute({
  job: "sdr-reconcile",
  expectedIntervalSeconds: 300,
  handler: async () => {
    const result: Record<string, unknown> = {};
    const failures: string[] = [];

    if (process.env.SDR_BASE_URL && process.env.SDR_ADMIN_TOKEN) {
      try {
        result.sdr = await reconcileStalePublications({
          db: supabaseAdmin,
          sdrBaseUrl: process.env.SDR_BASE_URL,
          getConfig: getWorkspaceSdrConfig,
        });
      } catch (e) {
        failures.push(`sdr: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (isSocialApiConfigured()) {
      try {
        result.socialapi = await reconcileSocialApi({ api: getSocialApiClient(), db: socialDb });
      } catch (e) {
        failures.push(`socialapi: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // One provider failing must not hide the other's result — but a sweep in
    // which every configured provider failed is a failed run (heartbeat alert).
    const ran = Object.keys(result).length;
    if (failures.length && ran === 0) throw new Error(failures.join("; "));
    return { ...result, ...(failures.length ? { failures } : {}) };
  },
});
