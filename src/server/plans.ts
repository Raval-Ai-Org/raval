// plans.ts — the central plan-gating policy (proposal workstream B, and the
// module section H's billing will later write `workspaces.plan` for).
//
// Each plan carries AI spend ceilings (daily + monthly USD, measured by
// src/server/ai/metering.ts) and monthly generation quotas. Every number is
// env-overridable — PLAN_<ID>_DAILY_USD, _MONTHLY_USD, _MONTHLY_IMAGES,
// _MONTHLY_VIDEOS — so pricing experiments need no deploy.
import "server-only";

export type PlanId = "starter" | "growth" | "agency";

export type PlanLimits = {
  id: PlanId;
  label: string;
  dailyUsd: number;
  monthlyUsd: number;
  monthlyImages: number;
  monthlyVideos: number;
};

const PLANS: Record<PlanId, PlanLimits> = {
  starter: {
    id: "starter",
    label: "Starter",
    dailyUsd: 3,
    monthlyUsd: 40,
    monthlyImages: 150,
    monthlyVideos: 10,
  },
  growth: {
    id: "growth",
    label: "Growth",
    dailyUsd: 10,
    monthlyUsd: 150,
    monthlyImages: 600,
    monthlyVideos: 40,
  },
  agency: {
    id: "agency",
    label: "Agency OS",
    dailyUsd: 40,
    monthlyUsd: 600,
    monthlyImages: 2_500,
    monthlyVideos: 150,
  },
};

/** Spend ceiling for a user acting outside any workspace (USD per UTC day). */
export function userDailyCeilingUsd(): number {
  return envNumber("AI_USER_DAILY_USD") ?? 2;
}

/** Share of a limit at which the user is warned (soft cap) before the hard cap. */
export const SOFT_LIMIT_RATIO = 0.8;

function envNumber(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export function normalizePlanId(plan: string | null | undefined): PlanId {
  const p = (plan ?? "").toLowerCase().trim();
  if (p === "growth" || p === "pro") return "growth";
  if (p === "agency" || p === "agency-os" || p === "agency_os" || p === "enterprise")
    return "agency";
  return "starter";
}

export function getPlanLimits(plan: string | null | undefined): PlanLimits {
  const base = PLANS[normalizePlanId(plan)];
  const key = base.id.toUpperCase();
  return {
    ...base,
    dailyUsd: envNumber(`PLAN_${key}_DAILY_USD`) ?? base.dailyUsd,
    monthlyUsd: envNumber(`PLAN_${key}_MONTHLY_USD`) ?? base.monthlyUsd,
    monthlyImages: envNumber(`PLAN_${key}_MONTHLY_IMAGES`) ?? base.monthlyImages,
    monthlyVideos: envNumber(`PLAN_${key}_MONTHLY_VIDEOS`) ?? base.monthlyVideos,
  };
}
