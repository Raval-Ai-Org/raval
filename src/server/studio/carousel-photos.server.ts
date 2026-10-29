// The brand's own photos and screenshots for a carousel: measured, framed and
// handed to slides by code (src/lib/studio/carousel/photos.ts). Only assets
// already checked against the job's workspace (resolveStudioReferences) reach
// here, and only their storage paths are stored.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { MAX_SLIDE_PHOTOS, photoFrame, type SlidePhoto } from "@/lib/studio/carousel/photos";
import { isWorkspaceStoragePath } from "@/lib/workspace/storage-path";
import { safeFetch } from "@/server/safe-fetch";
import { screenCaptureIds, type StudioReference } from "./references.server";

/** Website captures are screens; anything else is a photo unless its shape says otherwise. */
export async function carouselPhotos(
  client: SupabaseClient,
  workspaceId: string,
  references: StudioReference[],
): Promise<SlidePhoto[]> {
  const refs = references
    .filter((r) => isWorkspaceStoragePath(r.storagePath, workspaceId))
    .slice(0, MAX_SLIDE_PHOTOS);
  if (!refs.length) return [];
  const screens = await screenCaptureIds(
    client,
    workspaceId,
    refs.map((r) => r.id),
  );
  const measured = await Promise.all(
    refs.map(async (ref): Promise<SlidePhoto | null> => {
      try {
        const { bytes } = await safeFetch(ref.url, {
          maxBytes: 25 * 1024 * 1024,
          timeoutMs: 15_000,
          onOverflow: "error",
        });
        const meta = await sharp(Buffer.from(bytes), { limitInputPixels: 80_000_000 }).metadata();
        // Phone photos carry their turn in EXIF; the slide draws them upright.
        const turned = (meta.orientation ?? 1) >= 5;
        const width = (turned ? meta.height : meta.width) ?? 0;
        const height = (turned ? meta.width : meta.height) ?? 0;
        if (!width || !height) return null;
        return {
          path: ref.storagePath,
          width,
          height,
          frame: photoFrame({ width, height }, screens.has(ref.id)),
        };
      } catch (error) {
        console.warn("[carousel] photo could not be measured", ref.id, error);
        return null;
      }
    }),
  );
  return measured.filter((p): p is SlidePhoto => !!p);
}
