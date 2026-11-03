// Lays the brand's real photos into the design layer the image model drew:
// finds the key-coloured windows, fits each photo into its window (turned to
// the window's angle, cut to its shape) and puts the design back on top. The
// photos are only scaled and cropped, never redrawn.
import "server-only";
import sharp from "sharp";
import {
  compositeLayers,
  findRegions,
  fitPhoto,
  mapToCanvas,
  photoMask,
  visibleShare,
  windowAlpha,
  type PhotoTransform,
} from "@/lib/studio/photo-design/geometry";
import { judgeFaces, judgeLayer } from "@/lib/studio/photo-design/checks";
import type { PhotoDesignPlan } from "@/lib/studio/photo-design/plan";
import type { Box, PhotoReading } from "@/lib/studio/photo-design/read";
import type { DesignPhoto } from "./photos.server";

export type ComposeResult =
  { ok: true; png: Buffer; faceShares: number[] } | { ok: false; reason: string; feedback: string };

/** The photo drawn by its transform onto a transparent canvas (RGBA). */
async function placePhoto(
  photo: DesignPhoto,
  t: PhotoTransform,
  width: number,
  height: number,
): Promise<Uint8Array> {
  // Two pipelines: sharp turns an image before it resizes it within one.
  const sized = await sharp(photo.bytes)
    .extract(t.crop)
    .resize(t.drawWidth, t.drawHeight, { fit: "fill" })
    .png()
    .toBuffer();
  const turned = t.angle
    ? sharp(sized).rotate((t.angle * 180) / Math.PI, {
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
    : sharp(sized);
  const { data, info } = await turned.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const left = Math.round(t.cx - info.width / 2);
  const top = Math.round(t.cy - info.height / 2);
  const out = new Uint8Array(width * height * 4);
  for (let y = Math.max(0, top); y < Math.min(height, top + info.height); y++) {
    const from = ((y - top) * info.width + Math.max(0, left) - left) * 4;
    const x0 = Math.max(0, left);
    const x1 = Math.min(width, left + info.width);
    out.set(data.subarray(from, from + (x1 - x0) * 4), (y * width + x0) * 4);
  }
  return out;
}

/** Sample points across a face that the crop still shows, on the canvas. */
function facePoints(t: PhotoTransform, face: Box): { x: number; y: number }[] {
  const u0 = Math.max(face.x, t.crop.left / t.sourceWidth);
  const u1 = Math.min(face.x + face.w, (t.crop.left + t.crop.width) / t.sourceWidth);
  const v0 = Math.max(face.y, t.crop.top / t.sourceHeight);
  const v1 = Math.min(face.y + face.h, (t.crop.top + t.crop.height) / t.sourceHeight);
  if (u1 <= u0 || v1 <= v0) return [];
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < 5; i++)
    for (let j = 0; j < 5; j++)
      points.push(
        mapToCanvas(t, u0 + ((i + 0.5) / 5) * (u1 - u0), v0 + ((j + 0.5) / 5) * (v1 - v0)),
      );
  return points;
}

/**
 * A soft fill made from the design itself, for the odd key-coloured speck no
 * photo covers: key pixels are dropped before blurring so they never tint it.
 */
async function designFill(
  rgba: Uint8Array,
  mask: Float32Array,
  width: number,
  height: number,
): Promise<Uint8Array> {
  const source = new Uint8Array(rgba);
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < width * height; i++) {
    if (mask[i] > 0.2) source[i * 4 + 3] = 0;
    else {
      r += rgba[i * 4];
      g += rgba[i * 4 + 1];
      b += rgba[i * 4 + 2];
      n += 1;
    }
  }
  const average = n ? [r / n, g / n, b / n] : [128, 128, 128];
  const blurred = await sharp(source, { raw: { width, height, channels: 4 } })
    .blur(14)
    .raw()
    .toBuffer();
  const fill = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const a = blurred[i * 4 + 3] / 255;
    for (let c = 0; c < 3; c++)
      fill[i * 3 + c] = Math.round(blurred[i * 4 + c] * a + average[c] * (1 - a));
  }
  return fill;
}

export async function composePhotoDesign(args: {
  layer: Buffer;
  photos: DesignPhoto[];
  readings: PhotoReading[];
  plan: PhotoDesignPlan;
}): Promise<ComposeResult> {
  const { plan, photos, readings } = args;
  const { data, info } = await sharp(args.layer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const width = info.width;
  const height = info.height;
  const design = new Uint8Array(data.buffer, data.byteOffset, data.length);
  const mask = photoMask(design, width, height, plan.key);
  const { labels, regions } = findRegions(mask, width, height);
  const verdict = judgeLayer(
    plan,
    regions,
    { width, height },
    photos.map((photo) => photo.width / photo.height),
  );
  if (!verdict.ok) return verdict;

  const placed = new Uint8Array(width * height * 4);
  const faceShares: number[] = [];
  const slots =
    plan.layout === "overlay"
      ? [
          {
            index: plan.order[0],
            region: { cx: width / 2, cy: height / 2, angle: 0, width, height },
            id: 0,
          },
        ]
      : plan.order.map((index, position) => {
          const region = regions[verdict.windows[position]];
          // A few pixels larger, so the photo reaches into the window's soft edge.
          return {
            index,
            region: { ...region, width: region.width + 4, height: region.height + 4 },
            id: region.id,
          };
        });
  for (const slot of slots) {
    const photo = photos[slot.index];
    const reading = readings[slot.index];
    const t = fitPhoto(photo, slot.region, reading.focus);
    const pixels = await placePhoto(photo, t, width, height);
    const alpha = slot.id ? windowAlpha(labels, slot.id, width, height, 3) : null;
    for (let i = 0; i < width * height; i++) {
      const a = alpha ? Math.min(pixels[i * 4 + 3], alpha[i]) : pixels[i * 4 + 3];
      if (!a) continue;
      placed[i * 4] = pixels[i * 4];
      placed[i * 4 + 1] = pixels[i * 4 + 1];
      placed[i * 4 + 2] = pixels[i * 4 + 2];
      placed[i * 4 + 3] = a;
    }
    for (const face of reading.faces.slice(0, 8)) {
      const points = facePoints(t, face);
      if (points.length) faceShares.push(visibleShare(mask, width, height, points));
    }
  }
  const faces = judgeFaces(faceShares);
  if (!faces.ok) return faces;

  const rgb = compositeLayers({
    width,
    height,
    design,
    photos: placed,
    fill: await designFill(design, mask, width, height),
    fillChannels: 3,
    mask,
    key: plan.key,
  });
  const png = await sharp(Buffer.from(rgb.buffer, rgb.byteOffset, rgb.length), {
    raw: { width, height, channels: 3 },
  })
    .png({ compressionLevel: 8 })
    .toBuffer();
  return { ok: true, png, faceShares };
}
