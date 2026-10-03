import "server-only";
import { createServerFn } from "@/server/server-fn";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { rateLimitFor } from "@/server/rate-limit";
import { HttpError } from "@/server/http-error";
import type { ServerFnContext } from "@/server/server-fn";
import type { WorkspaceRole } from "@/server/api-auth";

// Stories (ADR-0030). Making a Story with words goes through Studio
// (POST /api/studio/jobs, type "story"); these are the parts that need no
// model: whether Stories are on, re-using a video as a Story or a Story video
// as a Reel, and the Story numbers. Every call is scoped to a verified
// workspace and runs on the caller's RLS client.

const uuid = z.string().uuid();
const StoryPlatform = z.enum(["instagram", "facebook"]);

async function member(context: ServerFnContext, workspaceId: string, minRole: WorkspaceRole) {
  const { requireWorkspaceRole } = await import("@/server/workspace-access.server");
  return requireWorkspaceRole(context, workspaceId, minRole);
}

async function enabled(workspaceId: string) {
  const { isStoriesEnabled } = await import("@/lib/feature-flags");
  if (!isStoriesEnabled(workspaceId))
    throw new HttpError(404, "Stories aren't available for this workspace.");
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Whether Stories are on, which Story accounts are connected, and what's possible. */
export const getStoriesStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ workspaceId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    await member(context, data.workspaceId, "viewer");
    const [{ isStoriesEnabled }, { STORY_FEATURES, STORY_PLATFORMS }] = await Promise.all([
      import("@/lib/feature-flags"),
      import("@/lib/stories/placement"),
    ]);
    if (!isStoriesEnabled(data.workspaceId))
      return { enabled: false, accounts: [], features: STORY_FEATURES };
    const { data: rows } = await context.supabase
      .from("social_accounts")
      .select("platform, username, display_name, avatar_url, status")
      .eq("workspace_id", data.workspaceId)
      .in("platform", [...STORY_PLATFORMS])
      .neq("status", "disconnected");
    const accounts = ((rows ?? []) as Record<string, unknown>[]).map((r) => ({
      platform: String(r.platform) as "instagram" | "facebook",
      name: String(r.display_name ?? r.username ?? ""),
      avatarUrl: typeof r.avatar_url === "string" ? r.avatar_url : null,
      ready: r.status === "active",
    }));
    return { enabled: true, accounts, features: STORY_FEATURES };
  });

const CONTENT_COLS = "id, workspace_id, kind, channel, title, body, status, meta, scheduled_at";

async function loadItem(context: ServerFnContext, workspaceId: string, id: string) {
  const { data, error } = await context.supabase
    .from("content_items")
    .select(CONTENT_COLS)
    .eq("id", id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new HttpError(404, "That piece no longer exists.");
  return data as {
    id: string;
    kind: string;
    title: string | null;
    body: string | null;
    status: string;
    meta: unknown;
  };
}

/** The item's video in this workspace's own storage, or a clear refusal. */
async function videoOf(workspaceId: string, item: { meta: unknown }) {
  const { isWorkspaceStoragePath } = await import("@/lib/workspace/storage-path");
  const meta = record(item.meta);
  const path = meta.asset_storage_path;
  if (meta.media_type !== "video" || !isWorkspaceStoragePath(path, workspaceId)) {
    throw new HttpError(400, "Only a finished video can be shared this way.");
  }
  return {
    path: path as string,
    assetId: typeof meta.asset_id === "string" ? meta.asset_id : null,
  };
}

/** Insert drafts and move them to Needs approval (draft → pending is a legal step). */
async function insertForApproval(context: ServerFnContext, rows: Record<string, unknown>[]) {
  const { data, error } = await context.supabase
    .from("content_items")
    .insert(rows.map((r) => ({ ...r, status: "draft" })) as never)
    .select("id");
  if (error) throw new Error(error.message);
  const ids = ((data ?? []) as { id: string }[]).map((r) => r.id);
  if (ids.length) {
    const { error: moveError } = await context.supabase
      .from("content_items")
      .update({ status: "pending" })
      .in("id", ids);
    if (moveError) throw new Error(moveError.message);
  }
  return ids;
}

/**
 * Reel → Story: put a finished video up as a Story too. No model call and no
 * new render: the same stored video is reused. The new Story waits for approval.
 */
export const shareVideoAsStory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("generate")])
  .inputValidator((data) =>
    z
      .object({
        workspaceId: uuid,
        contentItemId: uuid,
        platforms: z.array(StoryPlatform).min(1).max(2),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await member(context, data.workspaceId, "editor");
    await enabled(data.workspaceId);
    const source = await loadItem(context, data.workspaceId, data.contentItemId);
    const video = await videoOf(data.workspaceId, source);
    const groupId = crypto.randomUUID();
    const title = (source.title || "Video Story").slice(0, 280);
    const ids = await insertForApproval(
      context,
      [...new Set(data.platforms)].map((platform) => ({
        workspace_id: data.workspaceId,
        agent: "echo",
        kind: "story",
        channel: platform,
        title,
        body: (source.body ?? "").slice(0, 600),
        hashtags: [],
        meta: {
          platform,
          placement: "stories",
          studio_type: "story",
          source: "repurpose",
          group_id: groupId,
          story: {
            mode: "video",
            theme: "repurpose",
            frames: [],
            mentions: [],
            source_content_id: source.id,
          },
          asset_id: video.assetId,
          asset_storage_path: video.path,
          asset_status: "ready",
          media_type: "video",
          aspect_ratio: "9:16",
        },
      })),
    );
    return { contentItemIds: ids };
  });

/**
 * Story → Reel: a video Story kept as a Reel on the profile. Same video, a
 * feed caption written from the Story's words; it waits for approval.
 */
export const shareStoryAsReel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("generate")])
  .inputValidator((data) => z.object({ workspaceId: uuid, contentItemId: uuid }).parse(data))
  .handler(async ({ data, context }) => {
    await member(context, data.workspaceId, "editor");
    const source = await loadItem(context, data.workspaceId, data.contentItemId);
    const meta = record(source.meta);
    if (source.kind !== "story") throw new HttpError(400, "That piece isn't a Story.");
    const video = await videoOf(data.workspaceId, source);
    const platform = meta.platform === "facebook" ? "facebook" : "instagram";
    const ids = await insertForApproval(context, [
      {
        workspace_id: data.workspaceId,
        agent: "echo",
        kind: "video",
        channel: platform,
        title: (source.title || "Reel").slice(0, 280),
        body: (source.body || source.title || "").slice(0, 2000),
        hashtags: [],
        meta: {
          platform,
          placement: "reels",
          studio_type: "video",
          source: "repurpose",
          source_content_id: source.id,
          asset_id: video.assetId,
          asset_storage_path: video.path,
          asset_status: "ready",
          media_type: "video",
          aspect_ratio: "9:16",
        },
      },
    ]);
    return { contentItemIds: ids };
  });

/** Story numbers for one workspace, newest first. */
export const getStoryAnalytics = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("analytics")])
  .inputValidator((data) =>
    z.object({ workspaceId: uuid, days: z.number().int().min(1).max(90).default(30) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await member(context, data.workspaceId, "viewer");
    const since = new Date(Date.now() - data.days * 86_400_000).toISOString();
    const { data: rows, error } = await context.supabase
      .from("content_publications")
      .select(
        "content_item_id, platform, status, delivered_at, metrics, metrics_synced_at, frames, platform_post_url, last_error, created_at",
      )
      .eq("workspace_id", data.workspaceId)
      .eq("placement", "stories")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) throw new Error(error.message);
    const list = (rows ?? []) as Record<string, unknown>[];
    const ids = [...new Set(list.map((r) => String(r.content_item_id)))];
    const { data: items } = ids.length
      ? await context.supabase.from("content_items").select("id, title").in("id", ids)
      : { data: [] };
    const titles = new Map(
      ((items ?? []) as { id: string; title: string | null }[]).map((i) => [i.id, i.title ?? ""]),
    );
    const { storyMetricsFrom } = await import("@/lib/stories/metrics");
    return {
      stories: list.map((r) => {
        const m = record(r.metrics);
        const frames = Array.isArray(r.frames) ? r.frames.length : 1;
        const hasNumbers = Object.keys(m).length > 0;
        return {
          id: String(r.content_item_id),
          title: titles.get(String(r.content_item_id)) || "Story",
          platform: typeof r.platform === "string" ? r.platform : null,
          status: String(r.status),
          publishedAt: typeof r.delivered_at === "string" ? r.delivered_at : null,
          frames,
          url: typeof r.platform_post_url === "string" ? r.platform_post_url : null,
          error: typeof r.last_error === "string" ? r.last_error : null,
          syncedAt: typeof r.metrics_synced_at === "string" ? r.metrics_synced_at : null,
          metrics: hasNumbers
            ? {
                ...storyMetricsFrom({ ...m, navigation: m.taps }),
                profileVisits: Number(m.profile_visits) || 0,
              }
            : null,
          hold: typeof m.hold === "number" ? m.hold : null,
        };
      }),
    };
  });
