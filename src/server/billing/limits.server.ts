import "server-only";

import { PLAN_ORDER, PLANS } from "@/lib/billing/catalog";
import type { Entitlements } from "./entitlements.server";
import { LimitReachedError } from "./errors";

type LimitKey =
  | "trackedPrompts"
  | "competitors"
  | "brands"
  | "seats"
  | "socialProfiles"
  | "experiments"
  | "renders"
  | "scans";

const usageKey: Record<LimitKey, keyof Entitlements["usage"]> = {
  trackedPrompts: "trackedPrompts",
  competitors: "competitors",
  brands: "brands",
  seats: "seats",
  socialProfiles: "socialProfiles",
  experiments: "openExperiments",
  renders: "rendersRunning",
  scans: "scansUsed",
};

function maximum(entitlements: Entitlements, key: LimitKey): number | null {
  if (key === "experiments") return entitlements.limits.maxConcurrentExperiments;
  if (key === "renders") return entitlements.limits.maxConcurrentRenders;
  if (key === "scans") return entitlements.limits.scansPerMonth;
  if (key === "brands" || key === "seats") return entitlements.limits[key];
  return entitlements.limits[key];
}

export function assertWithinLimit(entitlements: Entitlements, key: LimitKey, delta = 1): void {
  if (entitlements.enforcement !== "on") return;
  const used = entitlements.usage[usageKey[key]];
  const max = maximum(entitlements, key);
  if (max === null || used + delta <= max) return;
  const current = PLAN_ORDER.indexOf(entitlements.entitledPlan);
  const requiredPlan = PLAN_ORDER.slice(current + 1).find((plan) => {
    const candidate = PLANS[plan];
    const candidateMax =
      key === "experiments"
        ? candidate.limits.maxConcurrentExperiments
        : key === "renders"
          ? candidate.limits.maxConcurrentRenders
          : key === "scans"
            ? candidate.limits.scansPerMonth
            : key === "brands" || key === "seats"
              ? candidate[key]
              : candidate.limits[key];
    return candidateMax === null || used + delta <= candidateMax;
  });
  throw new LimitReachedError({ limit: key, used, max, requiredPlan });
}
