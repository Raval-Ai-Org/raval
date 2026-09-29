import { defineCronRoute } from "@/server/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export const POST = defineCronRoute({
  job: "billing",
  expectedIntervalSeconds: 300,
  handler: async () => {
    const { issueDueGrants } = await import("@/server/billing/grants.server");
    const { replayFailedBillingEvents } = await import("@/server/billing/stripe-account.server");
    const { reconcilePendingBillingCapacity } = await import("@/server/billing/capacity.server");
    const { advanceStudioBillingJobs } = await import("@/server/billing/studio-async.server");
    const { settleTerminalUgcBilling } = await import("@/server/billing/ugc-async.server");
    const { settleOpenAsyncCharges } = await import("@/server/billing/async-charges.server");
    const { notifyEndingComps, rewardReferrals } =
      await import("@/server/billing/lifecycle.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Rollover runs inside issueDueGrants before old grants expire.
    const grants = await issueDueGrants();
    const stripeReplay = await replayFailedBillingEvents();
    const capacity = await reconcilePendingBillingCapacity();
    const studio = await advanceStudioBillingJobs();
    const ugc = await settleTerminalUgcBilling();
    // Background jobs settle before the expiry sweep, so a finished job is
    // charged rather than released.
    const background = await settleOpenAsyncCharges();
    // People chores never block the money work above.
    const endingPlans = await notifyEndingComps().catch((cause) => {
      console.error("[billing] ending-plan notices failed", cause);
      return 0;
    });
    const referrals = await rewardReferrals().catch((cause) => {
      console.error("[billing] referral rewards failed", cause);
      return 0;
    });
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
    return {
      ...grants,
      stripeReplay,
      capacity,
      studio,
      ugc,
      background,
      endingPlans,
      referrals,
      expired: expired.data,
      releasedHolds: holds.data,
    };
  },
});
