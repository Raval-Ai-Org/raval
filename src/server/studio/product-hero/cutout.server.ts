// The product cut out of its own photo, made once per photo and kept
// (ADR-0040). A photo that is already a clean PNG on transparency is used as
// it is; otherwise the image model is asked for the product alone on a
// transparent background, and the result is kept only if its alpha shows a
// real cut-out (src/lib/studio/product-hero/cutout.ts). Any failure returns
// null and the poster is made from the original photo instead.
import "server-only";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { llmJson } from "@/lib/ai-gateway.server";
import { generateImage, type ImageSize } from "@/lib/openrouter-image.server";
import { persistAsset, signAssetPath } from "@/server/assets/persist.server";
import { downloadAssetObject } from "@/server/assets/storage.server";
import { PHOTO_PIXEL_LIMIT } from "@/server/assets/image-limits";
import { isWorkspaceStoragePath } from "@/lib/workspace/storage-path";
import { cleanAlpha, judgeCutout, paddedBox } from "@/lib/studio/product-hero/cutout";
import { dominantColour } from "@/lib/studio/product-hero/palette";
import { cutoutPrompt } from "@/lib/studio/product-hero/prompt";
import type { StudioReference } from "../references.server";

export const CUTOUT_SOURCE = "product-cutout";

export type ProductCutout = {
  assetId: string;
  storagePath: string;
  url: string;
  /** The pack's own colour (palette.ts), or null for a colourless product. */
  colour: string | null;
  /** The product runs off its photo's edge, so only part of it can be shown. */
  cropped: boolean;
};

/** Long side a reference photo is sent at: labels stay readable. */
const SEND_SIDE = 1536;

function sizeFor(width: number, height: number): ImageSize {
  const r = height / width;
  if (r > 1.6) return "1024x1792";
  if (r > 1.12) return "1024x1280";
  if (r < 0.7) return "1792x1024";
  return "1024x1024";
}

async function existingCutout(
  client: SupabaseClient,
  workspaceId: string,
  photoId: string,
): Promise<ProductCutout | null> {
  const { data } = await client
    .from("assets")
    .select("id, storage_path, metadata")
    .eq("workspace_id", workspaceId)
    .eq("status", "ready")
    .eq("metadata->>source", CUTOUT_SOURCE)
    .eq("metadata->>from_asset_id", photoId)
    .order("created_at", { ascending: false })
    .limit(1);
  const row = data?.[0] as
    | { id: string; storage_path: string | null; metadata: Record<string, unknown> | null }
    | undefined;
  // The path comes from user-editable rows: it must be this workspace's.
  if (!row?.storage_path || !isWorkspaceStoragePath(row.storage_path, workspaceId)) return null;
  const url = await signAssetPath(row.storage_path);
  if (!url) return null;
  const colour = row.metadata?.colour;
  return {
    assetId: row.id,
    storagePath: row.storage_path,
    url,
    colour: typeof colour === "string" && /^#[0-9a-f]{6}$/i.test(colour) ? colour : null,
    cropped: row.metadata?.cropped === true,
  };
}

/** A clean cut-out trimmed to the product, with its colour; null if it isn't one. */
export async function trimmedCutout(
  bytes: Buffer,
): Promise<{ png: Buffer; colour: string | null; cropped: boolean } | null> {
  const image = sharp(bytes, { limitInputPixels: PHOTO_PIXEL_LIMIT, failOn: "none" }).rotate();
  const meta = await image.metadata();
  if (!meta.hasAlpha) return null;
  const { data, info } = await image
    .clone()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const alpha = new Uint8Array(info.width * info.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3];
  const verdict = judgeCutout(alpha, info.width, info.height);
  if (!verdict.ok) return null;
  // The glow a model leaves around the product goes; the edge stays soft.
  cleanAlpha(alpha);
  for (let i = 0; i < alpha.length; i++) data[i * 4 + 3] = alpha[i];
  const box = paddedBox(verdict.box, info);
  const png = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } })
    .extract(box)
    .png()
    .toBuffer();
  const { data: small } = await sharp(png)
    .resize(256, 256, { fit: "inside" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { png, colour: dominantColour(new Uint8Array(small)), cropped: verdict.cropped };
}

/**
 * Does the photo show the whole product, or does its edge cut part of it off?
 * One small vision read of the original photo (a model closes a cropped pack
 * when it cuts it out, so the cut-out can't tell). Unsure means whole.
 */
export async function photoCropsProduct(photo: Buffer, productName: string): Promise<boolean> {
  try {
    const small = await sharp(photo, { limitInputPixels: PHOTO_PIXEL_LIMIT, failOn: "none" })
      .rotate()
      .resize(768, 768, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();
    const read = await llmJson<{ cutOff?: unknown } | null>({
      route: "studio.photo-read",
      system: "You look at one product photo and answer one question about it. Return JSON only.",
      user: `Is the product (${productName.replace(/\s+/g, " ").slice(0, 80)}) cut off by the photo's edge, so that part of the pack itself is outside the picture? Answer {"cutOff": true} only when part of the product clearly runs out of the frame; {"cutOff": false} when the whole product is inside it.`,
      images: [{ mediaType: "image/webp", data: small.toString("base64") }],
      timeoutMs: 30_000,
      fallback: null,
    });
    return read?.cutOff === true;
  } catch {
    return false;
  }
}

/** Ask the image model for the product alone on transparency, then check it. */
export async function cutOut(photo: Buffer, productName: string) {
  const { data: send, info } = await sharp(photo, {
    limitInputPixels: PHOTO_PIXEL_LIMIT,
    failOn: "none",
  })
    .rotate()
    .resize(SEND_SIDE, SEND_SIDE, { fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer({ resolveWithObject: true });
  const [image, cropped] = await Promise.all([
    generateImage({
      prompt: cutoutPrompt(productName),
      size: sizeFor(info.width, info.height),
      background: "transparent",
      routing: {
        referenceAssets: [`data:image/png;base64,${send.toString("base64")}`],
        editing: true,
        brandPrecision: "strict",
        requiredQuality: "high",
      },
    }),
    photoCropsProduct(photo, productName),
  ]);
  const made = await trimmedCutout(Buffer.from(image.b64, "base64"));
  return made ? { ...made, cropped: made.cropped || cropped } : null;
}

/**
 * The product's cut-out for this photo: the stored one, the photo itself when
 * it already is one, or a new one from the image model. Never throws.
 */
export async function ensureProductCutout(args: {
  client: SupabaseClient;
  workspaceId: string;
  productId: string;
  productName: string;
  photo: Pick<StudioReference, "id" | "storagePath">;
}): Promise<ProductCutout | null> {
  try {
    const stored = await existingCutout(args.client, args.workspaceId, args.photo.id);
    if (stored) return stored;
    const downloaded = await downloadAssetObject(args.client, args.photo.storagePath);
    if (downloaded.error || !downloaded.data) return null;
    const original = Buffer.from(await downloaded.data.arrayBuffer());
    const made = (await trimmedCutout(original)) ?? (await cutOut(original, args.productName));
    if (!made) return null;
    const saved = await persistAsset({
      workspaceId: args.workspaceId,
      idempotencyKey: `${CUTOUT_SOURCE}:${args.photo.id}`,
      bytes: made.png,
      mimeType: "image/png",
      assetType: "image",
      filename: `product-cutout-${args.photo.id.slice(0, 8)}.png`,
      metadata: {
        source: CUTOUT_SOURCE,
        product_id: args.productId,
        from_asset_id: args.photo.id,
        ...(made.colour ? { colour: made.colour } : {}),
        cropped: made.cropped,
      },
    });
    if (!saved.ok || !saved.asset.storage_path) return null;
    const url = saved.asset.public_url ?? (await signAssetPath(saved.asset.storage_path));
    if (!url) return null;
    return {
      assetId: saved.asset.id,
      storagePath: saved.asset.storage_path,
      url,
      colour: made.colour,
      cropped: made.cropped,
    };
  } catch (error) {
    console.warn(
      "[studio] product cut-out unavailable",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}
