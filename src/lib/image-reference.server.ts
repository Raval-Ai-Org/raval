// image-reference.server.ts — every picture handed to the image model as a
// reference is first made into something it can always read.
//
// People upload whatever their phone or their media team gives them: 48 MP
// photos, sideways EXIF orientation, TIFF, GIF, AVIF, CMYK JPEGs, 30 MB PNGs.
// The image model reads PNG, JPEG and WebP of a bounded size and refuses the
// rest in under a second, which used to fail the whole post ("This isn't
// available right now"). Here each reference is opened once, turned upright,
// brought inside REFERENCE_SIDE on its long side (never enlarged), flattened to
// sRGB and sent as a JPEG (PNG when it has transparency, so a cut-out or a
// design layer keeps it) data URL. The pixels the person chose are kept: this
// only resizes and re-encodes, it never crops.
//
// Fails open: a reference that can't be fetched or decoded here is passed on
// as it was, so this can never be the reason a render fails.
import "server-only";
import sharp from "sharp";
import { safeFetch } from "@/server/safe-fetch";
import { PHOTO_PIXEL_LIMIT } from "@/server/assets/image-limits";

/** Long side sent to the model; it renders at about 1K, so this keeps detail. */
export const REFERENCE_SIDE = 2048;
/** Above this the encoded reference is made smaller once more. */
const MAX_REFERENCE_BYTES = 7 * 1024 * 1024;
const FETCH_LIMIT_BYTES = 80 * 1024 * 1024;

async function sourceBytes(reference: string): Promise<Buffer | null> {
  if (/^data:image\//i.test(reference)) {
    const comma = reference.indexOf(",");
    if (comma < 0 || !/;base64$/i.test(reference.slice(0, comma))) return null;
    return Buffer.from(reference.slice(comma + 1), "base64");
  }
  if (!/^https:\/\//i.test(reference)) return null;
  const { bytes } = await safeFetch(reference, {
    maxBytes: FETCH_LIMIT_BYTES,
    timeoutMs: 25_000,
    onOverflow: "error",
  });
  return Buffer.from(bytes);
}

async function encode(input: Buffer, side: number, alpha: boolean): Promise<Buffer> {
  const image = sharp(input, { limitInputPixels: PHOTO_PIXEL_LIMIT, failOn: "none", pages: 1 })
    .rotate()
    .resize(side, side, { fit: "inside", withoutEnlargement: true })
    .toColourspace("srgb");
  return alpha
    ? image.png({ compressionLevel: 8 }).toBuffer()
    : image.flatten({ background: "#ffffff" }).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
}

/** One reference made readable for the image model (or returned unchanged). */
export async function normalizeReferenceImage(reference: string): Promise<string> {
  try {
    const input = await sourceBytes(reference);
    if (!input?.length) return reference;
    const meta = await sharp(input, {
      limitInputPixels: PHOTO_PIXEL_LIMIT,
      failOn: "none",
      pages: 1,
    }).metadata();
    if (!meta.width || !meta.height) return reference;
    const alpha = Boolean(meta.hasAlpha);
    let out = await encode(input, REFERENCE_SIDE, alpha);
    if (out.length > MAX_REFERENCE_BYTES) out = await encode(input, 1536, alpha);
    return `data:image/${alpha ? "png" : "jpeg"};base64,${out.toString("base64")}`;
  } catch (error) {
    console.warn(
      "[image] reference left as it was",
      error instanceof Error ? error.message.slice(0, 160) : "unreadable",
    );
    return reference;
  }
}

/** Every reference of one request, in order. */
export function normalizeReferenceImages(references: string[]): Promise<string[]> {
  return Promise.all(references.map((reference) => normalizeReferenceImage(reference)));
}
