import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { HttpError } from "@/server/http-error";
import { getEntitlements } from "./entitlements.server";
import { assertWithinLimit } from "./limits.server";
import { BrandFrozenError, UpgradeRequiredError } from "./errors";

const admin = supabaseAdmin as unknown as SupabaseClient;

/** Publish and schedule are included in a paid plan, with no post allowance. */
export async function assertPublishingAction(args: {
  workspaceId: string;
  userId: string;
  role: "owner" | "admin" | "editor" | "viewer";
  action: "social_publish" | "social_schedule" | "social_retry";
}): Promise<void> {
  const entitlements = await getEntitlements(args);
  if (entitlements.enforcement === "off") return;
  const blockedFrozen = entitlements.frozen;
  const blockedFeature = !entitlements.features.publishing.allowed;
  if (entitlements.enforcement === "shadow") {
    if (blockedFrozen || blockedFeature) {
      const { error } = await admin.from("billing_shadow_events").insert({
        account_id: entitlements.accountId,
        workspace_id: args.workspaceId,
        action: args.action,
        decision: blockedFrozen ? "brand_frozen" : "upgrade_required",
        reason: blockedFrozen ? "Brand is frozen" : "Publishing locked",
      });
      if (error) console.error("[billing] publishing shadow event failed", error.code);
    }
    return;
  }
  if (blockedFrozen) throw new BrandFrozenError();
  if (blockedFeature) {
    throw new UpgradeRequiredError({
      feature: "publishing",
      requiredPlan: entitlements.features.publishing.requiredPlan,
      currentPlan: entitlements.entitledPlan,
    });
  }
}

/** Only call after the route kernel has verified workspace membership. */
export async function assertSocialProfileConnection(args: {
  workspaceId: string;
  userId: string;
  role: "owner" | "admin" | "editor" | "viewer";
}): Promise<void> {
  const entitlements = await getEntitlements(args);
  if (entitlements.enforcement === "off") return;

  // A brand with a profile may connect more networks without consuming another
  // allowance. Reconnects retain their provider profile until disconnected.
  const { data, error } = await admin
    .from("social_accounts")
    .select("id")
    .eq("workspace_id", args.workspaceId)
    .eq("provider", "socialapi")
    .in("status", ["active", "reconnect_required"])
    .limit(1);
  if (error) throw new HttpError(503, "Could not check connected social profiles.");
  const alreadyConnected = Boolean(data?.length);
  const blockedFeature = !entitlements.features.publishing.allowed;
  const blockedLimit =
    !alreadyConnected && entitlements.usage.socialProfiles >= entitlements.limits.socialProfiles;
  const blockedFrozen = entitlements.frozen;

  if (entitlements.enforcement === "shadow") {
    if (blockedFeature || blockedLimit || blockedFrozen) {
      const { error: logError } = await admin.from("billing_shadow_events").insert({
        account_id: entitlements.accountId,
        workspace_id: args.workspaceId,
        action: "social_profile_connect",
        meter: null,
        amount: 0,
        decision: blockedFrozen
          ? "brand_frozen"
          : blockedFeature
            ? "upgrade_required"
            : "limit_reached",
        reason: blockedFrozen
          ? "Brand is frozen"
          : blockedFeature
            ? "Publishing locked"
            : "Social profile limit",
      });
      if (logError) console.error("[billing] social profile shadow event failed", logError.code);
    }
    return;
  }
  if (blockedFrozen) throw new BrandFrozenError();
  if (blockedFeature) {
    throw new UpgradeRequiredError({
      feature: "publishing",
      requiredPlan: entitlements.features.publishing.requiredPlan,
      currentPlan: entitlements.entitledPlan,
    });
  }
  if (!alreadyConnected) assertWithinLimit(entitlements, "socialProfiles");
}
