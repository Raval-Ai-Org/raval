import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { isWorkspaceStoragePath } from "@/lib/workspace/storage-path";
import { HttpError } from "@/server/http-error";
import { assertSafeVideo } from "./video-safety.server";
import {
  assertSafeMediaImages,
  assertSafeMediaPrompt,
  MediaSafetyError,
} from "./media-safety.server";

/** Review stored media too: uploading or editing a draft cannot bypass generation safety. */
export async function assertSafePublishingItems(
  db: SupabaseClient<Database>,
  workspaceId: string,
  ids: string[],
) {
  const { data, error } = await db
    .from("content_items")
    .select("id, title, body, kind, media_url, meta")
    .eq("workspace_id", workspaceId)
    .in("id", ids);
  if (error) throw new MediaSafetyError(true);
  if ((data ?? []).length !== new Set(ids).size)
    throw new HttpError(403, "Some content could not be reviewed in this workspace.");
  for (const row of data ?? []) {
    const meta = row.meta as Record<string, unknown> | null;
    const paths = Array.isArray(meta?.asset_storage_paths)
      ? meta.asset_storage_paths
      : meta?.asset_storage_path
        ? [meta.asset_storage_path]
        : [];
    if (!row.media_url && !paths.length) continue;
    await assertSafeMediaPrompt(`${row.title ?? ""}\n${row.body ?? ""}`);
    const video =
      /video|reel/i.test(row.kind) ||
      /\.(mp4|webm|mov)(?:\?|$)/i.test(row.media_url ?? "") ||
      String(meta?.mime_type ?? "").startsWith("video/");
    if (paths.length > 20) throw new MediaSafetyError(true);
    const images: string[] = [];
    for (const path of paths) {
      if (!isWorkspaceStoragePath(path, workspaceId))
        throw new HttpError(403, "This media does not belong to the workspace.");
      const { data: signed, error: signError } = await db.storage
        .from("generated-assets")
        .createSignedUrl(path as string, 300);
      if (signError || !signed?.signedUrl) throw new MediaSafetyError(true);
      images.push(signed.signedUrl);
    }
    if (!images.length && row.media_url) images.push(row.media_url);
    if (video) {
      for (const source of images) await assertSafeVideo(source);
    } else await assertSafeMediaImages(images);
  }
}
