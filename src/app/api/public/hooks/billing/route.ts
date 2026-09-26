import { defineCronRoute } from "@/server/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const POST = defineCronRoute({
  job: "billing",
  expectedIntervalSeconds: 300,
  handler: async () => {
    const { issueDueGrants } = await import("@/server/billing/grants.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Rollover runs inside issueDueGrants before old grants expire.
    const grants = await issueDueGrants();
    const expired = await supabaseAdmin.rpc("meter_expire_due" as never);
    if (expired.error) throw new Error("Could not expire billing grants.");
    const holds = await supabaseAdmin.rpc("meter_release_expired_holds" as never);
    if (holds.error) throw new Error("Could not release expired billing holds.");
    const cutoff = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const purged = await supabaseAdmin
      .from("billing_shadow_events" as never)
      .delete()
      .lt("created_at", cutoff);
    if (purged.error) throw new Error("Could not purge old billing shadow events.");
    return { ...grants, expired: expired.data, releasedHolds: holds.data };
  },
});
