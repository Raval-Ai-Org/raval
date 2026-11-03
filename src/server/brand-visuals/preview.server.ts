import "server-only";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { uploadAssetObject } from "@/server/assets/storage.server";
import { isWorkspaceStoragePath } from "@/lib/workspace/storage-path";
import { PHOTO_PIXEL_LIMIT } from "@/server/assets/image-limits";

/** A light gallery preview; the complete source stays unchanged for inspection/vision. */
export async function createVisualPreview(
  workspaceId: string,
  asset: { id: string; storage_path: string | null },
  bytes: Buffer,
  cropHero = false,
) {
  if (!asset.storage_path || !isWorkspaceStoragePath(asset.storage_path, workspaceId)) return;
  try {
    const image = sharp(bytes, { limitInputPixels: PHOTO_PIXEL_LIMIT, failOn: "none" });
    const dimensions = await image.metadata();
    if (!dimensions.width || !dimensions.height) return;
    const cropped = cropHero
      ? image.extract({
          left: 0,
          top: 0,
          width: dimensions.width,
          height: Math.min(dimensions.height, Math.round(dimensions.width * 0.75)),
        })
      : image;
    const preview = await cropped
      .resize(480, 480, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 70 })
      .toBuffer();
    const path = asset.storage_path.replace(/\/[^/]+$/, "/preview.jpg");
    await uploadAssetObject(path, preview, "image/jpeg");
    const result = await (supabaseAdmin as unknown as SupabaseClient)
      .from("assets")
      .update({ thumbnail_path: path })
      .eq("id", asset.id)
      .eq("workspace_id", workspaceId);
    if (result.error) throw new Error("Preview metadata could not be saved.");
  } catch {
    console.warn("[visual-taste] gallery preview unavailable", asset.id);
  }
}
