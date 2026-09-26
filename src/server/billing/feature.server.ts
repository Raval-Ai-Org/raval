import "server-only";

import type { FeatureKey } from "@/lib/billing/catalog";
import type { WorkspaceRole } from "@/server/api-auth";
import { getEntitlements } from "./entitlements.server";
import { BrandFrozenError, SpendNotAllowedError, UpgradeRequiredError } from "./errors";

/** Enforce a feature on work that is included in the plan rather than charged. */
export async function requireBillingFeature(args: {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  feature: FeatureKey;
  spending?: boolean;
}): Promise<void> {
  const entitlements = await getEntitlements(args);
  if (entitlements.enforcement !== "on") return;
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
