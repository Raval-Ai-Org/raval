"use client";

// Approving a text-only draft (from chat, an agent, or the calendar) turns it
// into a finished post: Studio writes platform captions and renders the visual
// from it, and the result lands in Ready by itself (`approve: true`). The
// original draft is hidden while that happens and retired once the post exists.
import { supabase } from "@/integrations/supabase/client";
import { updateContentItem } from "@/lib/content.functions";
import type { PlatformId } from "@/lib/social-platforms";
import { readBrandPayload, studioApi } from "./client";
import { cleanText } from "./content-groups";
import { detectStudioType } from "./detect";
import {
  STUDIO_FORMATS,
  normalizeStudioType,
  studioTypeFromContent,
  type StudioType,
} from "./formats";
import { newIdempotencyKey, type StudioControls, type StudioJob } from "./jobs";
import { studioDefaultControls, trackJob } from "./session-store";

/** content_items.channel → platform id (the schema says "x", Studio says "twitter"). */
const CHANNEL_PLATFORM: Record<string, PlatformId> = {
  x: "twitter",
  twitter: "twitter",
  linkedin: "linkedin",
  instagram: "instagram",
  facebook: "facebook",
  threads: "threads",
  tiktok: "tiktok",
  youtube: "youtube",
};

type DraftRow = {
  id: string;
  title: string | null;
  body: string | null;
  kind: string;
  channel: string | null;
  meta: Record<string, unknown> | null;
};

export async function createPostFromDraft(
  workspaceId: string,
  contentId: string,
): Promise<StudioJob> {
  const { data, error } = await supabase
    .from("content_items")
    .select("id, title, body, kind, channel, meta")
    .eq("id", contentId)
    .single();
  if (error || !data) throw new Error(error?.message ?? "That draft no longer exists.");
  const row = data as DraftRow;

  const fromContent = studioTypeFromContent(row.kind, row.meta);
  const type: StudioType =
    normalizeStudioType(row.meta?.canvas) ??
    (fromContent === "legacy" ? null : fromContent) ??
    detectStudioType(`${row.title ?? ""} ${row.body ?? ""}`) ??
    "social";
  const format = STUDIO_FORMATS[type];

  const base = studioDefaultControls(type);
  const platform = row.channel ? CHANNEL_PLATFORM[row.channel.toLowerCase()] : undefined;
  const controls: StudioControls = {
    ...base,
    platforms: platform && format.platforms.includes(platform) ? [platform] : base.platforms,
    // A finished post has a visual; text-only formats stay text.
    ...(format.media === "optional-image" ? { includeImage: true } : {}),
  };

  const title = cleanText(row.title);
  const brief = [title && !/^untitled/i.test(title) ? title : "", (row.body ?? "").trim()]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 4000);
  if (brief.length < 3) throw new Error("This draft is empty. Add some text to it first.");

  const job = await studioApi.createJob({
    workspaceId,
    type,
    idempotencyKey: newIdempotencyKey(),
    intent: { brief },
    controls,
    brand: readBrandPayload(workspaceId),
    approve: true,
    fromContentId: row.id,
  });

  // Keep the text draft out of Review while its post is being made.
  await updateContentItem({
    data: { id: row.id, patch: { meta: { converting_job: job.id } } },
  }).catch(() => undefined);

  trackJob(job);
  return job;
}
