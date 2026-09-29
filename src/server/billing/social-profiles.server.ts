import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { HttpError } from "@/server/http-error";
import { getEntitlements, type Entitlements } from "./entitlements.server";
import { BrandFrozenError, LimitReachedError, UpgradeRequiredError } from "./errors";

const admin = supabaseAdmin as unknown as SupabaseClient;

/**
 * Publishing, scheduling and retries are included on every plan, Free too, and
 * never use credits (Post for Me bills Mellox about $0.01 a post). The only
 * limit is a hidden monthly fair-use cap per billing account against spam.
 */
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
  const blockedFairUse = entitlements.usage.postsThisMonth >= entitlements.limits.postsFairUse;
  const blockedEmail =
    !blockedFrozen && !blockedFeature && !blockedFairUse && !(await emailVerified(args.userId));
  if (entitlements.enforcement === "shadow") {
    if (blockedFrozen || blockedFeature || blockedFairUse || blockedEmail) {
      const { error } = await admin.from("billing_shadow_events").insert({
        account_id: entitlements.accountId,
        workspace_id: args.workspaceId,
        action: args.action,
        decision: blockedFrozen
          ? "brand_frozen"
          : blockedFeature
            ? "upgrade_required"
            : blockedFairUse
              ? "limit_reached"
              : "email_unverified",
        reason: blockedFrozen
          ? "Brand is frozen"
          : blockedFeature
            ? "Publishing locked"
            : blockedFairUse
              ? "Monthly post fair-use cap"
              : "Email not verified",
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
  if (blockedFairUse) {
    throw new LimitReachedError({
      limit: "posts",
      used: entitlements.usage.postsThisMonth,
      max: entitlements.limits.postsFairUse,
    });
  }
  if (blockedEmail) {
    throw new HttpError(403, "Please verify your email address before publishing.");
  }
}

async function emailVerified(userId: string): Promise<boolean> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  // Fail open on a lookup error: the fair-use cap and rate limit still apply.
  if (error || !data?.user) return true;
  return Boolean(data.user.email_confirmed_at ?? data.user.confirmed_at);
}

/**
 * Connecting social accounts is unlimited on every plan (Post for Me charges per
 * post, not per account). Only a frozen brand or a paused plan blocks it.
 * Only call after the route kernel has verified workspace membership.
 */
export async function assertSocialProfileConnection(args: {
  workspaceId: string;
  userId: string;
  role: "owner" | "admin" | "editor" | "viewer";
}): Promise<Entitlements> {
  const entitlements = await getEntitlements(args);
  if (entitlements.enforcement === "off") return entitlements;
  const blockedFeature = !entitlements.features.publishing.allowed;
  const blockedFrozen = entitlements.frozen;
  if (entitlements.enforcement === "shadow") {
    if (blockedFeature || blockedFrozen) {
      const { error: logError } = await admin.from("billing_shadow_events").insert({
        account_id: entitlements.accountId,
        workspace_id: args.workspaceId,
        action: "social_profile_connect",
        meter: null,
        amount: 0,
        decision: blockedFrozen ? "brand_frozen" : "upgrade_required",
        reason: blockedFrozen ? "Brand is frozen" : "Publishing locked",
      });
      if (logError) console.error("[billing] social profile shadow event failed", logError.code);
    }
    return entitlements;
  }
  if (blockedFrozen) throw new BrandFrozenError();
  if (blockedFeature) {
    throw new UpgradeRequiredError({
      feature: "publishing",
      requiredPlan: entitlements.features.publishing.requiredPlan,
      currentPlan: entitlements.entitledPlan,
    });
  }
  return entitlements;
}

/**
 * Social accounts are unlimited under Post for Me, so there is no slot to
 * reserve. Kept so the connect routes keep one call site if a per-account
 * limit ever returns.
 */
export async function reserveSocialProfileSlot(
  _entitlements: Entitlements,
  _workspaceId: string,
): Promise<void> {}

export async function activateSocialProfileSlot(
  _entitlements: Entitlements,
  _workspaceId: string,
): Promise<void> {}

export async function releaseSocialProfileSlotIfEmpty(workspaceId: string): Promise<void> {
  const { error } = await admin.rpc("release_billing_social_profile_slot_if_empty", {
    p_workspace: workspaceId,
  });
  if (error) throw new HttpError(503, "Could not release social profile allowance.");
}
