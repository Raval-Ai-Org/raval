// plans.ts — the central plan-gating policy (proposal workstream B, and the
// module section H's billing will later write `workspaces.plan` for).
//
// Each plan carries AI spend ceilings (daily + monthly USD, measured by
// src/server/ai/metering.ts) and monthly generation quotas. Every number is
// env-overridable — PLAN_<ID>_DAILY_USD, _MONTHLY_USD, _MONTHLY_IMAGES,
// _MONTHLY_VIDEOS, _MONTHLY_POSTS — so pricing experiments need no deploy.
//
// monthlyPosts is the social publishing credit: each post created at the
// distribution provider (publish, schedule, retry) uses one, mirroring how
// SocialAPI.ai bills post operations (src/lib/socialapi/workspace.server.ts).
import "server-only";

export type PlanId = "starter" | "growth" | "agency";

export type PlanLimits = {
  id: PlanId;
  label: string;
  dailyUsd: number;
  monthlyUsd: number;
  monthlyImages: number;
  monthlyVideos: number;
  monthlyPosts: number;
  /** Pages one AI Visibility site scan may crawl (PLAN_<ID>_GEO_MAX_PAGES). */
  geoMaxPages: number;
};

const PLANS: Record<PlanId, PlanLimits> = {
  starter: {
    id: "starter",
    label: "Starter",
    dailyUsd: 3,
    monthlyUsd: 40,
    monthlyImages: 150,
    monthlyVideos: 10,
    monthlyPosts: 60,
    geoMaxPages: 25,
  },
  growth: {
    id: "growth",
    label: "Growth",
    dailyUsd: 10,
    monthlyUsd: 150,
    monthlyImages: 600,
    monthlyVideos: 40,
    monthlyPosts: 300,
    geoMaxPages: 100,
  },
  agency: {
    id: "agency",
    label: "Agency OS",
    dailyUsd: 40,
    monthlyUsd: 600,
    monthlyImages: 2_500,
    monthlyVideos: 150,
    monthlyPosts: 2_000,
    geoMaxPages: 300,
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
    monthlyPosts: envNumber(`PLAN_${key}_MONTHLY_POSTS`) ?? base.monthlyPosts,
    geoMaxPages: Math.max(
      1,
      Math.min(1000, envNumber(`PLAN_${key}_GEO_MAX_PAGES`) ?? base.geoMaxPages),
    ),
  };
}
