// reconcile.ts — SocialAPI.ai backstop sweep (runs inside the existing
// sdr-reconcile cron, every 5 minutes). Webhooks are the fast path; this makes
// delivery state converge even when a webhook is lost, not configured yet, or
// dropped while the provider account is past due. It also refreshes engagement
// metrics for recent posts and prunes expired connect states.
import { syncPostHandler, syncPostMetrics, type SocialApiDeps } from "@/lib/socialapi/handlers";

export type SocialReconcileDeps = Pick<SocialApiDeps, "api" | "db" | "now"> & {
  staleMs?: number;
  maxPosts?: number;
  metricsEveryMs?: number;
  maxMetricsPosts?: number;
};

export async function reconcileSocialApi(deps: SocialReconcileDeps) {
  const now = deps.now?.() ?? Date.now();
  const cutoff = new Date(now - (deps.staleMs ?? 10 * 60 * 1000)).toISOString();
  const maxPosts = deps.maxPosts ?? 25;

  // 1. In-flight deliveries that haven't moved recently — one GET per post.
  const { data: stale } = await deps.db
    .from("content_publications")
    .select("workspace_id, content_item_id, sdr_post_id, status")
    .eq("provider", "socialapi")
    .in("status", ["publishing", "pending", "retrying"])
    .lt("updated_at", cutoff)
    .order("updated_at", { ascending: true })
    .limit(maxPosts * 4);

  // `pending` rows belong to scheduled posts: only worth checking once due.
  const pendingItemIds = [
    ...new Set(
      ((stale ?? []) as any[]).filter((r) => r.status === "pending").map((r) => r.content_item_id),
    ),
  ];
  const notYetDue = new Set<string>();
  if (pendingItemIds.length) {
    const { data: items } = await deps.db
      .from("content_items")
      .select("id, scheduled_at")
      .in("id", pendingItemIds);
    for (const it of (items ?? []) as any[]) {
      if (it.scheduled_at && Date.parse(it.scheduled_at) > now - 60_000) notYetDue.add(it.id);
    }
  }

  const posts = new Map<string, string>();
  for (const row of (stale ?? []) as any[]) {
    if (row.status === "pending" && notYetDue.has(row.content_item_id)) continue;
    if (!posts.has(row.sdr_post_id)) posts.set(row.sdr_post_id, row.workspace_id);
    if (posts.size >= maxPosts) break;
  }

  let reconciled = 0;
  let unreachable = 0;
  for (const [postId, workspaceId] of posts) {
    try {
      const out = await syncPostHandler({ postId, workspaceId }, deps);
      if (out.touched.length) reconciled++;
    } catch {
      unreachable++; // try again next sweep
    }
  }

  // 2. Engagement metrics for posts delivered in the last 30 days.
  const metricsCutoff = new Date(now - (deps.metricsEveryMs ?? 6 * 3600 * 1000)).toISOString();
  const { data: published } = await deps.db
    .from("content_publications")
    .select("workspace_id, sdr_post_id, metrics_synced_at")
    .eq("provider", "socialapi")
    .eq("status", "published")
    .gt("delivered_at", new Date(now - 30 * 24 * 3600 * 1000).toISOString())
    .or(`metrics_synced_at.is.null,metrics_synced_at.lt.${metricsCutoff}`)
    .limit((deps.maxMetricsPosts ?? 20) * 4);
  const metricPosts = new Map<string, string>();
  for (const row of (published ?? []) as any[]) {
    if (!metricPosts.has(row.sdr_post_id)) metricPosts.set(row.sdr_post_id, row.workspace_id);
    if (metricPosts.size >= (deps.maxMetricsPosts ?? 20)) break;
  }
  let metricsUpdated = 0;
  for (const [postId, workspaceId] of metricPosts) {
    try {
      metricsUpdated += (await syncPostMetrics({ postId, workspaceId }, deps)).updated;
    } catch {
      unreachable++;
    }
  }

  // 3. Housekeeping: connect states expire after 30 minutes.
  await deps.db
    .from("social_oauth_states")
    .delete()
    .lt("expires_at", new Date(now - 24 * 3600 * 1000).toISOString());

  return { swept: posts.size, reconciled, metricsUpdated, unreachable };
}
