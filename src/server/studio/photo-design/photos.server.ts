// The brand's own photos for a design: opened from this workspace's storage
// (asset ids checked by resolveStudioReferences), turned upright, read by a
// vision model and laid out on a contact sheet the image model can see.
import "server-only";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { llmJson, type LlmImageInput } from "@/lib/ai-gateway.server";
import { downloadAssetObject } from "@/server/assets/storage.server";
import { groundRead, type GroundedRead } from "@/lib/studio/photo-design/read";
import { PHOTO_READ_SYSTEM } from "@/lib/studio/photo-design/prompt";
import type { StudioReference } from "../references.server";

/** Long side the photos are kept at while designing (the post renders at about 1K). */
const WORKING_SIDE = 2048;

export type DesignPhoto = {
  /** Upright PNG, at most WORKING_SIDE on the long side. */
  bytes: Buffer;
  width: number;
  height: number;
};

export async function loadDesignPhotos(
  client: SupabaseClient,
  references: Pick<StudioReference, "storagePath">[],
): Promise<DesignPhoto[]> {
  return Promise.all(
    references.map(async (reference) => {
      const downloaded = await downloadAssetObject(client, reference.storagePath);
      if (downloaded.error || !downloaded.data)
        throw new Error("One of your photos could not be opened. Try again.");
      const { data, info } = await sharp(Buffer.from(await downloaded.data.arrayBuffer()), {
        limitInputPixels: 60_000_000,
      })
        .rotate()
        .resize(WORKING_SIDE, WORKING_SIDE, { fit: "inside", withoutEnlargement: true })
        .png()
        .toBuffer({ resolveWithObject: true });
      return { bytes: data, width: info.width, height: info.height };
    }),
  );
}

/** Small copies for the vision model; nothing leaves the workspace but these bytes. */
async function visionCopies(photos: DesignPhoto[]): Promise<LlmImageInput[]> {
  return Promise.all(
    photos.map(async (photo) => ({
      mediaType: "image/webp" as const,
      data: (
        await sharp(photo.bytes)
          .resize(1024, 1024, { fit: "inside", withoutEnlargement: true })
          .webp({ quality: 82 })
          .toBuffer()
      ).toString("base64"),
    })),
  );
}

/**
 * What the photos show, where the faces are and where words could go. A
 * failed read falls back to neutral readings: the design still runs, with
 * the stricter face check done on the finished picture.
 */
export async function readDesignPhotos(photos: DesignPhoto[]): Promise<GroundedRead> {
  try {
    const raw = await llmJson<unknown>({
      route: "studio.photo-read",
      system: PHOTO_READ_SYSTEM,
      user: `There are ${photos.length} photo${photos.length === 1 ? "" : "s"}, shown in order (index 0 first). Read every one.`,
      images: await visionCopies(photos),
      timeoutMs: 45_000,
      fallback: null,
    });
    return groundRead(raw, photos.length);
  } catch (error) {
    console.warn("[studio] photo read unavailable", error instanceof Error ? error.message : error);
    return groundRead(null, photos.length);
  }
}

/** Every photo on one sheet, so one reference slot shows the model the whole set. */
export async function contactSheet(photos: DesignPhoto[], order: number[]): Promise<Buffer> {
  const columns = order.length <= 2 ? order.length : 3;
  const rows = Math.ceil(order.length / columns);
  const cell = 400;
  const gap = 12;
  const tiles = await Promise.all(
    order.map(async (index, position) => ({
      input: await sharp(photos[index].bytes)
        .resize(cell, cell, { fit: "cover", position: "attention" })
        .png()
        .toBuffer(),
      left: gap + (position % columns) * (cell + gap),
      top: gap + Math.floor(position / columns) * (cell + gap),
    })),
  );
  return sharp({
    create: {
      width: gap + columns * (cell + gap),
      height: gap + rows * (cell + gap),
      channels: 3,
      background: { r: 245, g: 245, b: 245 },
    },
  })
    .composite(tiles)
    .jpeg({ quality: 82 })
    .toBuffer();
}
