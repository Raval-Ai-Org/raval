// POST /api/social/metrics/sync — pull live engagement metrics for the
// workspace's posts delivered in the last 30 days (also refreshed by the
// 5-minute reconcile sweep). Rate limited: each post is a provider call.
import { z } from "zod";
import { defineRoute } from "@/server/route";
import { syncPostMetrics } from "@/lib/socialapi/handlers";
import { withSocialApi } from "@/lib/socialapi/route.server";

export const dynamic = "force-dynamic";

const MAX_POSTS = 25;

export const POST = defineRoute({
  name: "social/metrics/sync",
  auth: "workspace",
  body: z.object({ workspaceId: z.string() }),
  workspaceId: ({ body }) => body.workspaceId,
  minRole: "editor",
  rateLimit: ({ workspaceId }) => ({ tier: "audit", subject: `social-metrics:${workspaceId}` }),
  handler: ({ workspaceId }) =>
    withSocialApi(workspaceId, async (deps) => {
      const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
      const { data, error } = await deps.db
        .from("content_publications")
        .select("sdr_post_id")
        .eq("workspace_id", workspaceId)
        .eq("provider", "socialapi")
        .eq("status", "published")
        .gt("delivered_at", since)
        .order("delivered_at", { ascending: false })
        .limit(MAX_POSTS * 4);
      if (error)
        return { status: 500, body: { error: { code: "UNKNOWN", detail: error.message } } };
      const postIds = [
        ...new Set(((data ?? []) as Array<{ sdr_post_id: string }>).map((r) => r.sdr_post_id)),
      ].slice(0, MAX_POSTS);
      let updated = 0;
      for (const postId of postIds) {
        updated += (await syncPostMetrics({ postId, workspaceId }, deps)).updated;
      }
      return { status: 200, body: { posts: postIds.length, updated } };
    }),
});
