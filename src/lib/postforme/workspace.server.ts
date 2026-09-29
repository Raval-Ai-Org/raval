import "server-only";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createPostForMeAdapter } from "@/lib/postforme/client.server";
import type { SocialApiDeps, PostQuota } from "@/lib/postforme/handlers";

export const postForMeDb = supabaseAdmin as any;

const quota: PostQuota = {
  async check(workspaceId, needed) {
    const today = new Date();
    const start = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
    ).toISOString();
    const { count, error } = await postForMeDb
      .from("social_usage_events")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .gte("created_at", start);
    if (error) throw new Error("Could not check publishing activity");
    const used = count ?? 0;
    return { ok: used + needed <= 100, used, limit: 100 };
  },
  async record(event) {
    const { error } = await postForMeDb.from("social_usage_events").insert({
      workspace_id: event.workspaceId,
      provider: "postforme",
      operation: event.operation,
      provider_post_id: event.providerPostId,
      content_item_id: event.contentItemId,
      user_id: event.userId,
      targets: event.targets,
    });
    if (error) throw new Error(error.message);
  },
};

export function getPostForMeDeps(workspaceId: string): SocialApiDeps {
  return { api: createPostForMeAdapter(workspaceId), db: postForMeDb, brandId: workspaceId, quota };
}
