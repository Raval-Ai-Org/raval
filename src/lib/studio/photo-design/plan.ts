// The plan for one "design with my photos" piece: which layout, which photo
// leads, which key colour the design leaves for the photos, which words go on
// it and which areas (faces) stay clear. Decided by code from the photo
// readings; the image model only draws what the plan allows. Pure.
import type { AspectRatio } from "../aspect";
import type { CopyLine } from "../creative-knowledge";
import { KEY_GREEN, KEY_MAGENTA, type KeyColour } from "./geometry";
import type { Box, PhotoReading } from "./read";

/** Most photos one design holds (the contact sheet shows them all to the model). */
export const MAX_DESIGN_PHOTOS = 6;

export type PhotoShape = "landscape" | "portrait" | "square";

export type PhotoDesignPlan = {
  v: 1;
  /** One full-bleed photo with design over it, or photos in designed windows. */
  layout: "overlay" | "windows";
  ratio: AspectRatio;
  key: KeyColour;
  /** Indexes into the piece's photo list, the strongest first. */
  order: number[];
  /** Shape of each photo, in `order`. */
  shapes: PhotoShape[];
  /** What each photo shows, in `order` (context for the design, never drawn). */
  scenes: string[];
  occasion?: string;
  copy: CopyLine[];
  /** Overlay only: canvas areas (fractions) the design must keep clear. */
  avoid: Box[];
  /** In `order`: which photos are website screens, shown inside a device. */
  screens?: boolean[];
};

const RATIO_VALUE: Record<AspectRatio, number> = {
  "1:1": 1,
  "4:5": 0.8,
  "16:9": 16 / 9,
  "9:16": 9 / 16,
  "3:4": 0.75,
  "4:3": 4 / 3,
};

export function ratioValue(ratio: AspectRatio): number {
  return RATIO_VALUE[ratio];
}

function shapeOf(size: { width: number; height: number }): PhotoShape {
  const aspect = size.width / size.height;
  return aspect > 1.15 ? "landscape" : aspect < 0.87 ? "portrait" : "square";
}

function hue(hex: string): { h: number; s: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const s = max ? d / max : 0;
  if (!d) return { h: 0, s };
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s };
}

/**
 * Green unless the brand or the photos are green (a lime banner, a lawn,
 * a green shirt): then magenta, so nothing real is mistaken for a window.
 */
export function pickKeyColour(colours: string[]): KeyColour {
  let green = 0;
  let magenta = 0;
  for (const colour of colours) {
    const c = hue(colour);
    if (!c || c.s < 0.3) continue;
    if (c.h >= 65 && c.h <= 170) green += 1;
    if (c.h >= 280 && c.h <= 335) magenta += 1;
  }
  return green > magenta ? KEY_MAGENTA : KEY_GREEN;
}

const QUOTED = /[“"]([^”"]{2,90})[”"]/g;

/**
 * The words on the design: what the person quoted in the brief, exactly;
 * else the short on-image line the copy model wrote; else the title. None
 * when the brand's look allows no words on pictures.
 */
export function photoDesignCopy(args: {
  brief: string;
  onImageText?: string | null;
  title?: string | null;
  maxWords?: number;
}): CopyLine[] {
  if (args.maxWords === 0) return [];
  const quoted = [...args.brief.matchAll(QUOTED)]
    .map((m) => m[1].replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, 3);
  const labels = ["Headline", "Support line", "Small label"];
  if (quoted.length) return quoted.map((text, i) => ({ label: labels[i], text }));
  const line = [args.onImageText, args.title]
    .map((value) => value?.replace(/\s+/g, " ").trim())
    .find((value) => value && value.split(" ").length <= 12);
  return line ? [{ label: "Headline", text: line }] : [];
}

/** Words that ask for photos inside a designed frame rather than full-bleed. */
const FRAMED = /\b(?:frame|framed|border|poster|collage|polaroid|card|grid|scrapbook|window)s?\b/i;

/** Faces in a full-bleed photo, moved into canvas fractions after the cover crop. */
function overlayAvoid(
  reading: PhotoReading,
  size: { width: number; height: number },
  ratio: AspectRatio,
): Box[] {
  const photo = size.width / size.height;
  const canvas = ratioValue(ratio);
  const cw = photo > canvas ? canvas / photo : 1;
  const ch = photo > canvas ? 1 : photo / canvas;
  const left = Math.min(1 - cw, Math.max(0, reading.focus.x - cw / 2));
  const top = Math.min(1 - ch, Math.max(0, reading.focus.y - ch / 2));
  return reading.faces
    .map((face) => {
      const x = (face.x - left) / cw;
      const y = (face.y - top) / ch;
      const w = face.w / cw;
      const h = face.h / ch;
      const x0 = Math.max(0, x);
      const y0 = Math.max(0, y);
      const x1 = Math.min(1, x + w);
      const y1 = Math.min(1, y + h);
      return x1 - x0 > 0.01 && y1 - y0 > 0.01 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
    })
    .filter((box): box is Box => !!box)
    .slice(0, 8);
}

export function planPhotoDesign(args: {
  readings: PhotoReading[];
  sizes: { width: number; height: number }[];
  ratio: AspectRatio;
  copy: CopyLine[];
  brief: string;
  occasion?: string;
  brandColours?: string[];
  /** A video's opening is always over the footage; its end card always framed. */
  layout?: PhotoDesignPlan["layout"];
  /** Per photo, in input order: a website capture, framed as a device screen. */
  screens?: boolean[];
}): PhotoDesignPlan {
  const count = Math.min(args.readings.length, args.sizes.length, MAX_DESIGN_PHOTOS);
  if (!count) throw new Error("A photo design needs at least one photo.");
  const order = Array.from({ length: count }, (_, i) => i).sort(
    (a, b) => args.readings[b].quality - args.readings[a].quality || a - b,
  );
  const single = count === 1;
  const photoAspect = args.sizes[0].width / args.sizes[0].height;
  const canvasAspect = ratioValue(args.ratio);
  const mismatch = Math.max(photoAspect / canvasAspect, canvasAspect / photoAspect);
  // A screen is never the whole canvas: it always sits in a device window.
  const anyScreen = order.some((i) => args.screens?.[i]);
  const layout =
    args.layout ??
    (single && mismatch <= 1.35 && !FRAMED.test(args.brief) && !anyScreen ? "overlay" : "windows");
  return {
    v: 1,
    layout,
    ratio: args.ratio,
    key: pickKeyColour([
      ...(args.brandColours ?? []),
      ...order.flatMap((i) => args.readings[i].colours),
    ]),
    order,
    shapes: order.map((i) => shapeOf(args.sizes[i])),
    scenes: order.map((i) => args.readings[i].scene),
    ...(args.occasion ? { occasion: args.occasion } : {}),
    copy: args.copy,
    avoid: layout === "overlay" ? overlayAvoid(args.readings[0], args.sizes[0], args.ratio) : [],
    ...(anyScreen ? { screens: order.map((i) => !!args.screens?.[i]) } : {}),
  };
}
