import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { HttpError } from "@/server/http-error";
import { signAssetPath } from "@/server/assets/persist.server";
import { isWorkspaceStoragePath } from "@/lib/workspace/storage-path";
import { safeFetch } from "@/server/safe-fetch";
import type { LlmImageInput } from "@/lib/ai-gateway.server";

export type StudioReference = {
  id: string;
  filename: string;
  mimeType: string;
  storagePath: string;
  url: string;
};

/** Accept asset IDs, never arbitrary URLs or browser-supplied storage paths. */
export async function resolveStudioReferences(
  client: SupabaseClient,
  workspaceId: string,
  assetIds: string[] = [],
  /** Six when designing with photos (the job schema keeps other modes to four). */
  limit: 6 | 40 = 6,
): Promise<StudioReference[]> {
  const ids = [...new Set(assetIds)];
  if (!ids.length) return [];
  if (ids.length > limit) throw new HttpError(400, "Choose up to six photos.");
  const { data, error } = await client
    .from("assets")
    .select("id,filename,storage_path,mime_type,status,asset_type")
    .eq("workspace_id", workspaceId)
    .in("id", ids);
  if (error) throw new HttpError(503, "Could not load reference photos.");
  return Promise.all(
    ids.map(async (id) => {
      const asset = data?.find((row) => row.id === id);
      if (
        !asset ||
        asset.asset_type !== "image" ||
        asset.status !== "ready" ||
        !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(asset.mime_type) ||
        !isWorkspaceStoragePath(asset.storage_path, workspaceId)
      ) {
        throw new HttpError(
          400,
          "A reference photo is unavailable in this workspace. Choose it again.",
        );
      }
      const url = await signAssetPath(asset.storage_path);
      if (!url) throw new HttpError(503, "Could not open a reference photo. Try again.");
      return {
        id,
        filename: asset.filename,
        mimeType: asset.mime_type,
        storagePath: asset.storage_path!,
        url,
      };
    }),
  );
}

const CLIP_TYPES = ["video/mp4", "video/quicktime", "video/webm"];

/** The brand's own clips for "Brand my clips", by asset id, checked like photos. */
export async function resolveStudioClips(
  client: SupabaseClient,
  workspaceId: string,
  assetIds: string[] = [],
): Promise<Pick<StudioReference, "id" | "filename" | "mimeType" | "storagePath">[]> {
  const ids = [...new Set(assetIds)];
  if (!ids.length) return [];
  if (ids.length > 5) throw new HttpError(400, "Choose up to five clips.");
  const { data, error } = await client
    .from("assets")
    .select("id,filename,storage_path,mime_type,status,asset_type")
    .eq("workspace_id", workspaceId)
    .in("id", ids);
  if (error) throw new HttpError(503, "Could not load your clips.");
  return ids.map((id) => {
    const asset = data?.find((row) => row.id === id);
    if (
      !asset ||
      asset.asset_type !== "video" ||
      asset.status !== "ready" ||
      !CLIP_TYPES.includes(asset.mime_type) ||
      !isWorkspaceStoragePath(asset.storage_path, workspaceId)
    )
      throw new HttpError(400, "A clip is unavailable in this workspace. Choose it again.");
    return {
      id,
      filename: asset.filename,
      mimeType: asset.mime_type,
      storagePath: asset.storage_path!,
    };
  });
}

/** Bound vision input size without sending untrusted remote URLs to the model. */
export async function studioReferenceImages(
  references: StudioReference[],
): Promise<LlmImageInput[]> {
  return Promise.all(
    references.map(async (reference) => {
      const { bytes } = await safeFetch(reference.url, {
        maxBytes: 20 * 1024 * 1024,
        timeoutMs: 15_000,
        onOverflow: "error",
      });
      const image = await sharp(Buffer.from(bytes), { limitInputPixels: 40_000_000 })
        .rotate()
        .resize(1536, 1536, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 85 })
        .toBuffer();
      return { mediaType: "image/webp" as const, data: image.toString("base64") };
    }),
  );
}
