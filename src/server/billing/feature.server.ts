import "server-only";

import type { FeatureKey } from "@/lib/billing/catalog";
import type { WorkspaceRole } from "@/server/api-auth";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { getEntitlements } from "./entitlements.server";
import { BrandFrozenError, SpendNotAllowedError, UpgradeRequiredError } from "./errors";

const admin = supabaseAdmin as unknown as SupabaseClient;

/** Enforce a feature on work that is included in the plan rather than charged. */
export async function requireBillingFeature(args: {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  feature: FeatureKey;
  spending?: boolean;
}): Promise<void> {
  const entitlements = await getEntitlements(args);
  if (entitlements.enforcement === "off") return;
  if (entitlements.enforcement === "shadow") {
    const decision = entitlements.frozen
      ? "brand_frozen"
      : args.spending && entitlements.role === "viewer"
        ? "spend_not_allowed"
        : !entitlements.features[args.feature].allowed
          ? "upgrade_required"
          : null;
    if (decision) {
      const { error } = await admin.from("billing_shadow_events").insert({
        account_id: entitlements.accountId,
        workspace_id: args.workspaceId,
        action: `feature:${args.feature}`,
        decision,
        reason: "Included feature check",
      });
      if (error) console.error("[billing] feature shadow event failed", error.code);
    }
    return;
  }
  if (entitlements.frozen) throw new BrandFrozenError();
  if (args.spending && entitlements.role === "viewer") throw new SpendNotAllowedError();
  const grant = entitlements.features[args.feature];
  if (!grant.allowed) {
    throw new UpgradeRequiredError({
      feature: args.feature,
      requiredPlan: grant.requiredPlan,
      currentPlan: entitlements.entitledPlan,
    });
  }
}
