import "server-only";

// Plan limits for included work (tracked competitors, running experiments,
// site scans). Counting is done by entitlements; this adds the shadow log and
// the typed 402 so every caller behaves the same in off / shadow / on.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { FeatureKey } from "@/lib/billing/catalog";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireBillingFeature } from "./feature.server";
import { assertWithinLimit } from "./limits.server";
import { optionalWorkspaceEntitlements } from "./readiness.server";

const admin = supabaseAdmin as unknown as SupabaseClient;
type Role = "owner" | "admin" | "editor" | "viewer";
type LimitKey = Parameters<typeof assertWithinLimit>[1];

const USAGE: Record<LimitKey, (u: Record<string, number>) => number> = {
  trackedPrompts: (u) => u.trackedPrompts,
  competitors: (u) => u.competitors,
  brands: (u) => u.brands,
  seats: (u) => u.seats,
  experiments: (u) => u.openExperiments,
  renders: (u) => u.rendersRunning,
  scans: (u) => u.scansUsed,
};

/** Only call after the caller verified workspace membership. */
export async function requireWithinLimit(args: {
  workspaceId: string;
  userId: string;
  role: Role;
  limit: LimitKey;
  delta?: number;
  feature?: FeatureKey;
}): Promise<void> {
  if (args.feature) {
    await requireBillingFeature({ ...args, feature: args.feature, spending: true });
  }
  const entitlements = await optionalWorkspaceEntitlements(args);
  if (!entitlements || entitlements.enforcement === "off") return;
  const delta = args.delta ?? 1;
  if (entitlements.enforcement === "shadow") {
    const used = USAGE[args.limit](entitlements.usage as unknown as Record<string, number>);
    const max =
      args.limit === "experiments"
        ? entitlements.limits.maxConcurrentExperiments
        : args.limit === "renders"
          ? entitlements.limits.maxConcurrentRenders
          : args.limit === "scans"
            ? entitlements.limits.scansPerMonth
            : (entitlements.limits as unknown as Record<string, number | null>)[args.limit];
    if (max !== null && max !== undefined && used + delta > max) {
      const { error } = await admin.from("billing_shadow_events").insert({
        account_id: entitlements.accountId,
        workspace_id: args.workspaceId,
        action: `limit:${args.limit}`,
        decision: "limit_reached",
        reason: `${used + delta} of ${max}`,
      });
      if (error) console.error("[billing] limit shadow event failed", error.code);
    }
    return;
  }
  assertWithinLimit(entitlements, args.limit, delta);
}
