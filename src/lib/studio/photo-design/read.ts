// What a vision model saw in the person's own photos. The model proposes;
// `groundRead` keeps only well-formed, in-range values, and a photo it could
// not read gets a neutral reading, so a failed read never blocks a design.
// Pure and browser-safe.
import { z } from "zod";

/** A box in the photo, as fractions of its width and height (0..1). */
export type Box = { x: number; y: number; w: number; h: number };

const BoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});

const HEX = /^#[0-9a-f]{6}$/i;

const PhotoSchema = z.object({
  index: z.number().int().min(0),
  scene: z.string().default(""),
  people: z.number().int().min(0).max(500).optional(),
  faces: z.array(BoxSchema).max(24).default([]),
  subject: BoxSchema.optional(),
  calm: z.array(BoxSchema).max(4).default([]),
  colours: z.array(z.string()).max(6).default([]),
  quality: z.number().min(0).max(10).optional(),
});

/** Each photo is checked on its own: one malformed entry never loses the rest. */
export const PhotoReadSchema = z.object({
  occasion: z.string().optional(),
  photos: z.array(z.unknown()).max(12).default([]),
});

export type PhotoReading = {
  scene: string;
  people: number;
  /** Faces worth keeping clear of text and stickers, largest first. */
  faces: Box[];
  /** Where the photo's point is; the crop keeps it in view. */
  focus: { x: number; y: number };
  /** Quiet areas where type could sit without covering anything. */
  calm: Box[];
  colours: string[];
  /** 0..10; the strongest photo leads the design. */
  quality: number;
};

export type GroundedRead = { occasion?: string; photos: PhotoReading[] };

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** A box clipped to the photo; anything too small or malformed is dropped. */
export function clampBox(box: Box | undefined): Box | null {
  if (!box || ![box.x, box.y, box.w, box.h].every(Number.isFinite)) return null;
  const x = clamp01(box.x);
  const y = clamp01(box.y);
  const w = clamp01(Math.min(box.w, 1 - x));
  const h = clamp01(Math.min(box.h, 1 - y));
  return w >= 0.01 && h >= 0.01 ? { x, y, w, h } : null;
}

export const NEUTRAL_READING: PhotoReading = {
  scene: "",
  people: 0,
  faces: [],
  focus: { x: 0.5, y: 0.45 },
  calm: [],
  colours: [],
  quality: 5,
};

/** One reading per photo, in the order the photos were given. */
export function groundRead(raw: unknown, count: number): GroundedRead {
  const parsed = PhotoReadSchema.safeParse(raw);
  const photos = Array.from({ length: count }, () => ({ ...NEUTRAL_READING }));
  if (!parsed.success) return { photos };
  for (const entry of parsed.data.photos) {
    const one = PhotoSchema.safeParse(entry);
    if (!one.success || one.data.index >= count) continue;
    const photo = one.data;
    const faces = photo.faces
      .map(clampBox)
      .filter((box): box is Box => !!box)
      .sort((a, b) => b.w * b.h - a.w * a.h)
      .slice(0, 12);
    const subject = clampBox(photo.subject);
    const focusBox = subject ?? faces[0] ?? null;
    photos[photo.index] = {
      scene: photo.scene.replace(/\s+/g, " ").trim().slice(0, 280),
      people: photo.people ?? faces.length,
      faces,
      focus: focusBox
        ? { x: focusBox.x + focusBox.w / 2, y: focusBox.y + focusBox.h / 2 }
        : NEUTRAL_READING.focus,
      calm: photo.calm.map(clampBox).filter((box): box is Box => !!box),
      colours: photo.colours.filter((hex) => HEX.test(hex)).map((hex) => hex.toLowerCase()),
      quality: photo.quality ?? NEUTRAL_READING.quality,
    };
  }
  const occasion = parsed.data.occasion?.replace(/\s+/g, " ").trim().slice(0, 160);
  return { ...(occasion ? { occasion } : {}), photos };
}
