// GET /api/usage?workspaceId=… — the workspace's real AI usage against its
// plan: spend today / this month vs ceilings, image and video quotas, cache
// hit rate and the cost the cache saved. Backs the "Plan & usage" panel
// (replacing the cosmetic localStorage token counter).
import { z } from "zod";
import { defineRoute } from "@/server/route";
import { checkBudget } from "@/server/ai/budget";
import { getCacheStats } from "@/server/cache/store";
import { getPlanLimits } from "@/server/plans";

export const dynamic = "force-dynamic";

export const GET = defineRoute({
  name: "usage",
  auth: "workspace",
  query: z.object({ workspaceId: z.string().optional() }),
  workspaceId: ({ query }) => query.workspaceId,
  handler: async ({ workspaceId, supabase }) => {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const [decision, cacheStats, recent, socialPosts] = await Promise.all([
      checkBudget("text", { workspaceId }),
      getCacheStats(["ai", "image"]),
      // RLS-bound read: members see only their own workspace's events.
      supabase
        .from("ai_usage_events")
        .select("route, provider, model, kind, est_cost_usd, cached, truncated, status, created_at")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(25),
      // Social publishing credits (publish / schedule / retry), same RLS scope.
      supabase
        .from("social_usage_events")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .gte("created_at", monthStart),
    ]);
    const limits = decision.limits ?? { ...getPlanLimits(null), plan: "starter" };
    const usage = decision.usage;
    const pct = (used: number, limit: number) => (limit > 0 ? Math.min(1, used / limit) : 0);
    return {
      plan: limits.plan,
      status: decision.mode,
      notice: decision.reason ?? null,
      spend: {
        todayUsd: usage?.todayCostUsd ?? 0,
        monthUsd: usage?.monthCostUsd ?? 0,
        dailyLimitUsd: limits.dailyUsd,
        monthlyLimitUsd: limits.monthlyUsd,
        dailyUsed: pct(usage?.todayCostUsd ?? 0, limits.dailyUsd),
        monthlyUsed: pct(usage?.monthCostUsd ?? 0, limits.monthlyUsd),
      },
      quotas: {
        images: { used: usage?.monthImages ?? 0, limit: limits.monthlyImages },
        videos: { used: usage?.monthVideos ?? 0, limit: limits.monthlyVideos },
        posts: socialPosts.error
          ? null
          : { used: socialPosts.count ?? 0, limit: getPlanLimits(limits.plan).monthlyPosts },
      },
      cache: {
        monthCalls: usage?.monthCalls ?? 0,
        monthCachedCalls: usage?.monthCachedCalls ?? 0,
        monthSavedUsd: usage?.monthSavedUsd ?? 0,
        hitRates: cacheStats,
      },
      recent: recent.data ?? [],
    };
  },
});
