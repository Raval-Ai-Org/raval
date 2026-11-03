"use client";

import { authedFetch } from "@/lib/authed-fetch";

export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const CLIP_TYPES = ["video/mp4", "video/quicktime", "video/webm"];
export const MAX_PHOTO_BYTES = 20 * 1024 * 1024;
export const MAX_CLIP_BYTES = 50 * 1024 * 1024;

export type UploadedMedia = { id: string; filename: string; url?: string };

/** One photo or clip into the workspace's assets. Uploading is free. */
export async function uploadStudioMedia(
  workspaceId: string,
  file: File,
  kind: "photo" | "clip",
): Promise<UploadedMedia> {
  const params = new URLSearchParams({
    workspaceId,
    requestId: crypto.randomUUID(),
    filename: file.name,
  });
  const response = await authedFetch(`/api/assets/upload?${params}`, {
    method: "POST",
    workspaceId,
    headers: { "Content-Type": file.type },
    body: file,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.asset?.id || (kind === "photo" && !body.asset?.public_url))
    throw new Error(
      kind === "photo" ? "Could not upload the photo." : "Could not upload the clip.",
    );
  return { id: body.asset.id, filename: file.name, url: body.asset.public_url ?? undefined };
}
