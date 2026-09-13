// GET /api/social/analytics — measured social performance for a workspace:
// delivery outcomes per platform, engagement pulled from the platforms, top
// posts, recent failures, account health and publishing credits. Every read
// uses the caller's RLS-bound client, so a member only ever sees their own
// workspace. Nothing here is estimated: empty data stays empty.
import { z } from "zod";
import { defineRoute } from "@/server/route";
import { getPlanLimits } from "@/server/plans";
import { getDistributionProviderForWorkspace } from "@/lib/feature-flags";
import type { SocialAnalytics } from "@/lib/sdr.functions";

export const dynamic = "force-dynamic";

type Row = {
  content_item_id: string;
  platform: string;
  status: string;
  created_at: string;
  delivered_at: string | null;
  updated_at: string;
  metrics: {
    likes?: number;
    comments?: number;
    shares?: number;
    saves?: number;
    views?: number;
  } | null;
  metrics_synced_at: string | null;
  platform_post_url: string | null;
  last_error: string | null;
};

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export const GET = defineRoute({
  name: "social/analytics",
  auth: "workspace",
  query: z.object({
    workspaceId: z.string(),
    days: z.coerce.number().int().min(1).max(365).default(30),
  }),
  workspaceId: ({ query }) => query.workspaceId,
  handler: async ({ query, workspaceId, supabase }): Promise<SocialAnalytics | Response> => {
    const sb = supabase as any;
    const since = new Date(Date.now() - query.days * 24 * 3600 * 1000).toISOString();
    const monthStart = new Date(
      Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1),
    ).toISOString();

    const [pubs, accounts, credits, workspace] = await Promise.all([
      sb
        .from("content_publications")
        .select(
          "content_item_id, platform, status, created_at, delivered_at, updated_at, metrics, metrics_synced_at, platform_post_url, last_error",
        )
        .eq("workspace_id", workspaceId)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(2000),
      sb.from("social_accounts").select("status").eq("workspace_id", workspaceId),
      sb
        .from("social_usage_events")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .gte("created_at", monthStart),
      sb.from("workspaces").select("plan").eq("id", workspaceId).maybeSingle(),
    ]);
    if (pubs.error) return Response.json({ error: pubs.error.message }, { status: 500 });

    const rows = (pubs.data ?? []) as Row[];
    const totals: SocialAnalytics["totals"] = {
      deliveries: rows.length,
      published: 0,
      failed: 0,
      inFlight: 0,
      scheduled: 0,
      likes: 0,
      comments: 0,
      shares: 0,
      saves: 0,
      views: 0,
    };
    const platforms = new Map<string, SocialAnalytics["byPlatform"][number]>();
    let metricsSyncedAt: string | null = null;

    for (const r of rows) {
      const p = platforms.get(r.platform) ?? {
        platform: r.platform,
        published: 0,
        failed: 0,
        likes: 0,
        comments: 0,
        shares: 0,
        views: 0,
      };
      if (r.status === "published") {
        totals.published++;
        p.published++;
      } else if (r.status === "failed") {
        totals.failed++;
        p.failed++;
      } else if (r.status === "pending") totals.scheduled++;
      else if (r.status === "publishing" || r.status === "retrying") totals.inFlight++;
      const m = r.metrics ?? {};
      totals.likes += n(m.likes);
      totals.comments += n(m.comments);
      totals.shares += n(m.shares);
      totals.saves += n(m.saves);
      totals.views += n(m.views);
      p.likes += n(m.likes);
      p.comments += n(m.comments);
      p.shares += n(m.shares);
      p.views += n(m.views);
      platforms.set(r.platform, p);
      if (r.metrics_synced_at && (!metricsSyncedAt || r.metrics_synced_at > metricsSyncedAt)) {
        metricsSyncedAt = r.metrics_synced_at;
      }
    }

    const engagement = (r: Row) =>
      n(r.metrics?.likes) + n(r.metrics?.comments) + n(r.metrics?.shares) + n(r.metrics?.saves);
    const top = rows
      .filter((r) => r.status === "published" && r.metrics && engagement(r) > 0)
      .sort((a, b) => engagement(b) - engagement(a))
      .slice(0, 8);
    const failures = rows.filter((r) => r.status === "failed").slice(0, 8);

    const itemIds = [...new Set([...top, ...failures].map((r) => r.content_item_id))];
    const titles = new Map<string, string>();
    if (itemIds.length) {
      const { data: items } = await sb
        .from("content_items")
        .select("id, title, body")
        .eq("workspace_id", workspaceId)
        .in("id", itemIds);
      for (const it of (items ?? []) as Array<{
        id: string;
        title: string | null;
        body: string | null;
      }>) {
        titles.set(it.id, (it.title || it.body || "Untitled post").slice(0, 120));
      }
    }

    const accountRows = (accounts.data ?? []) as Array<{ status: string }>;
    return {
      provider: getDistributionProviderForWorkspace(workspaceId),
      rangeDays: query.days,
      totals,
      byPlatform: [...platforms.values()].sort((a, b) => b.published - a.published),
      topPosts: top.map((r) => ({
        contentItemId: r.content_item_id,
        title: titles.get(r.content_item_id) ?? "Untitled post",
        platform: r.platform,
        url: r.platform_post_url,
        publishedAt: r.delivered_at,
        likes: n(r.metrics?.likes),
        comments: n(r.metrics?.comments),
        shares: n(r.metrics?.shares),
        views: n(r.metrics?.views),
      })),
      failures: failures.map((r) => ({
        contentItemId: r.content_item_id,
        title: titles.get(r.content_item_id) ?? "Untitled post",
        platform: r.platform,
        error: r.last_error,
        at: r.updated_at,
      })),
      accounts: {
        active: accountRows.filter((a) => a.status === "active").length,
        reconnect: accountRows.filter((a) => a.status === "reconnect_required").length,
      },
      credits: credits.error
        ? null
        : {
            used: credits.count ?? 0,
            limit: getPlanLimits(workspace.data?.plan ?? null).monthlyPosts,
          },
      metricsSyncedAt,
    };
  },
});
