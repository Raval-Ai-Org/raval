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
import { judgeFaces, judgeLayer, lenientWindows } from "@/lib/studio/photo-design/checks";
import { ratioValue, type PhotoDesignPlan } from "@/lib/studio/photo-design/plan";
import type { Box, PhotoReading } from "@/lib/studio/photo-design/read";
import type { DesignPhoto } from "./photos.server";
import { fitWhole } from "../fit-image.server";

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

/**
 * Lenient pass only: wherever a placed photo shows a face, the photo wins
 * over the design, so a face is never covered even when the layer drew over it.
 */
function clearFaces(
  mask: Float32Array,
  placed: Uint8Array,
  width: number,
  height: number,
  boxes: { x0: number; y0: number; x1: number; y1: number }[],
) {
  for (const box of boxes) {
    for (let y = Math.max(0, box.y0); y < Math.min(height, box.y1); y++)
      for (let x = Math.max(0, box.x0); x < Math.min(width, box.x1); x++) {
        const i = y * width + x;
        if (placed[i * 4 + 3] > 0) mask[i] = Math.max(mask[i], placed[i * 4 + 3] / 255);
      }
  }
}

export async function composePhotoDesign(args: {
  layer: Buffer;
  photos: DesignPhoto[];
  readings: PhotoReading[];
  plan: PhotoDesignPlan;
  /**
   * The last pass after the layer's retry: use the windows the layer left
   * (more or fewer than asked, smaller than wished) and keep faces clear of
   * the design instead of refusing. Still refuses a layer with no usable
   * window, so the caller can lay the photos out by code.
   */
  lenient?: boolean;
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
  const aspects = photos.map((photo) => photo.width / photo.height);
  const strict = judgeLayer(plan, regions, { width, height }, aspects);
  let verdict: { windows: number[]; placed: number };
  if (strict.ok) verdict = { windows: strict.windows, placed: plan.order.length };
  else {
    const loose = args.lenient ? lenientWindows(plan, regions, { width, height }, aspects) : null;
    if (!loose) return strict;
    verdict = loose;
  }

  const placed = new Uint8Array(width * height * 4);
  const faceShares: number[] = [];
  const faceBoxes: { x0: number; y0: number; x1: number; y1: number }[] = [];
  const slots =
    plan.layout === "overlay"
      ? [
          {
            index: plan.order[0],
            region: { cx: width / 2, cy: height / 2, angle: 0, width, height },
            id: 0,
          },
        ]
      : plan.order.slice(0, verdict.placed).map((index, position) => {
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
      if (!points.length) continue;
      faceShares.push(visibleShare(mask, width, height, points));
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      // The sample points sit inside the face; grow the box to its edges and a little past.
      const padX = (Math.max(...xs) - Math.min(...xs)) * 0.25 + 4;
      const padY = (Math.max(...ys) - Math.min(...ys)) * 0.25 + 4;
      faceBoxes.push({
        x0: Math.floor(Math.min(...xs) - padX),
        y0: Math.floor(Math.min(...ys) - padY),
        x1: Math.ceil(Math.max(...xs) + padX),
        y1: Math.ceil(Math.max(...ys) + padY),
      });
    }
  }
  const faces = judgeFaces(faceShares);
  if (!faces.ok && !args.lenient) return faces;
  if (!faces.ok) clearFaces(mask, placed, width, height, faceBoxes);

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

/** Average colour of a photo, for the backdrop behind a code-drawn layout. */
async function averageColour(bytes: Buffer): Promise<{ r: number; g: number; b: number }> {
  const stats = await sharp(bytes).removeAlpha().stats();
  const [r, g, b] = stats.channels.map((channel) => Math.round(channel.mean));
  return { r, g: g ?? r, b: b ?? r };
}

/** A photo cover-cut around its focus to exactly `w`×`h`. */
function coverCut(
  photo: DesignPhoto,
  focus: { x: number; y: number },
  w: number,
  h: number,
): Promise<Buffer> {
  const t = fitPhoto(photo, { cx: w / 2, cy: h / 2, angle: 0, width: w, height: h }, focus);
  return sharp(photo.bytes).extract(t.crop).resize(w, h, { fit: "fill" }).png().toBuffer();
}

/** Columns per row for 2 to 6 photos on a canvas of this shape. */
function gridRows(count: number, landscape: boolean): number[] {
  if (count === 2) return landscape ? [2] : [1, 1];
  if (count === 3) return landscape ? [3] : [1, 2];
  if (count === 4) return [2, 2];
  if (count === 5) return landscape ? [3, 2] : [2, 3];
  return landscape ? [3, 3] : [2, 2, 2];
}

/** A photo is cover-cut (instead of fitted whole) only this close to the canvas shape. */
export const FITTED_COVER_MISMATCH = 1.12;

/**
 * The photos laid out by code at the canvas size, when no design layer could
 * hold them: one photo is shown whole (cover-cut only when its shape is close
 * to the canvas, else fitted over a soft blurred copy of itself), several
 * share a clean grid. Nothing is redrawn; the piece is always made.
 */
export async function composeFittedPhotos(args: {
  photos: DesignPhoto[];
  readings: PhotoReading[];
  plan: Pick<PhotoDesignPlan, "order" | "ratio">;
  width?: number;
  height?: number;
}): Promise<Buffer> {
  const { photos, readings, plan } = args;
  const width = Math.max(64, Math.round(args.width ?? 1024));
  const height = Math.max(64, Math.round(args.height ?? width / ratioValue(plan.ratio)));
  const order = plan.order.filter((i) => photos[i]).slice(0, 6);
  if (!order.length) throw new Error("A photo design needs at least one photo.");
  const hero = photos[order[0]];
  const focus = (i: number) => readings[i]?.focus ?? { x: 0.5, y: 0.5 };

  if (order.length === 1) {
    const photoAspect = hero.width / hero.height;
    const canvasAspect = width / height;
    const mismatch = Math.max(photoAspect / canvasAspect, canvasAspect / photoAspect);
    if (mismatch <= FITTED_COVER_MISMATCH) return coverCut(hero, focus(order[0]), width, height);
    return fitWhole(hero.bytes, width, height);
  }

  const background = await averageColour(hero.bytes);
  const gap = Math.round(Math.min(width, height) * 0.02);
  const rows = gridRows(order.length, width > height);
  const rowHeight = (height - gap * (rows.length + 1)) / rows.length;
  const tiles: { input: Buffer; left: number; top: number }[] = [];
  let next = 0;
  for (const [r, columns] of rows.entries()) {
    const cellWidth = (width - gap * (columns + 1)) / columns;
    for (let c = 0; c < columns && next < order.length; c++, next++) {
      const index = order[next];
      const left = Math.round(gap + c * (cellWidth + gap));
      const top = Math.round(gap + r * (rowHeight + gap));
      const w = Math.max(1, Math.round(gap + c * (cellWidth + gap) + cellWidth) - left);
      const h = Math.max(1, Math.round(gap + r * (rowHeight + gap) + rowHeight) - top);
      tiles.push({ input: await coverCut(photos[index], focus(index), w, h), left, top });
    }
  }
  return sharp({ create: { width, height, channels: 3, background } })
    .composite(tiles)
    .png()
    .toBuffer();
}
