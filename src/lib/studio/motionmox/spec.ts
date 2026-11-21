// The one input to a MotionMox render. Built by code (plan.ts), grounded here,
// and read by the compositions. The model never writes a spec.
// Pure and browser-safe.
import { z } from "zod";
import { MOTIONMOX_ELEMENT_IDS, MOTIONMOX_SAFE } from "./elements";

export const MOTIONMOX_FPS = 30;
/** The bundle's one composition. */
export const MOTIONMOX_COMPOSITION_ID = "mellox-video";
export const MOTIONMOX_MAX_SECONDS = 60;

/** A file the render's own loopback server serves: a bare name inside the render folder. */
const LocalFile = z
  .string()
  .regex(/^[A-Za-z0-9_.-]{1,80}$/, "only a file name inside the render folder");

const Seconds = z.number().finite().min(0).max(MOTIONMOX_MAX_SECONDS);

export const MotionMoxTransitionSchema = z.enum(["fade", "slide-left", "slide-up", "wipe", "none"]);
export type MotionMoxTransition = z.infer<typeof MotionMoxTransitionSchema>;

export const MotionMoxSegmentSchema = z.object({
  kind: z.enum(["video", "image"]),
  src: LocalFile,
  seconds: Seconds.min(0.3),
  /** Where a still is pushed in towards (0..1), and how far. */
  focus: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }).optional(),
  zoom: z.number().min(1).max(1.3).optional(),
  /** Keep the clip's own sound. */
  sound: z.boolean().optional(),
});
export type MotionMoxSegment = z.infer<typeof MotionMoxSegmentSchema>;

export const MotionMoxTextSchema = z.object({
  element: z.enum(MOTIONMOX_ELEMENT_IDS),
  text: z.string().min(1).max(160),
  from: Seconds,
  to: Seconds,
});
export type MotionMoxText = z.infer<typeof MotionMoxTextSchema>;

export const MotionMoxCueSchema = z.object({
  start: Seconds,
  end: Seconds,
  lines: z.array(z.array(z.string().max(40)).max(12)).max(3),
  emphasis: z.tuple([z.number().int().min(0), z.number().int().min(0)]).nullable(),
});

export const MotionMoxSpecSchema = z.object({
  version: z.literal(1),
  width: z.number().int().min(240).max(2160),
  height: z.number().int().min(240).max(3840),
  fps: z.literal(MOTIONMOX_FPS),
  segments: z.array(MotionMoxSegmentSchema).min(1).max(12),
  transition: MotionMoxTransitionSchema,
  transitionSeconds: z.number().min(0).max(1.2),
  /** A finished design PNG laid over the opening seconds (made earlier, kept exact). */
  overlay: z.object({ src: LocalFile, from: Seconds, to: Seconds }).nullable(),
  texts: z.array(MotionMoxTextSchema).max(12),
  captions: z.array(MotionMoxCueSchema).max(400),
  /** A full-canvas see-through PNG with the real logo already placed by code. */
  logo: z.object({ src: LocalFile, from: Seconds }).nullable(),
  progressBar: z.boolean(),
  look: z.object({
    ink: z.string().regex(/^#[0-9a-f]{6}$/i),
    paper: z.string().regex(/^#[0-9a-f]{6}$/i),
    accent: z.string().regex(/^#[0-9a-f]{6}$/i),
    font: z.string().max(80).nullable(),
  }),
  safe: z.object({ x: z.number(), top: z.number(), bottom: z.number() }),
});
export type MotionMoxSpec = z.infer<typeof MotionMoxSpecSchema>;

/** Length of the finished video: segments joined, less the overlaps of the transitions. */
export function specSeconds(
  spec: Pick<MotionMoxSpec, "segments" | "transitionSeconds" | "transition">,
): number {
  const total = spec.segments.reduce((sum, s) => sum + s.seconds, 0);
  const overlap =
    spec.transition === "none" ? 0 : spec.transitionSeconds * Math.max(0, spec.segments.length - 1);
  return Math.round((total - overlap) * 1000) / 1000;
}

export function specFrames(spec: MotionMoxSpec): number {
  return Math.max(1, Math.round(specSeconds(spec) * spec.fps));
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();

export type GroundResult = { spec: MotionMoxSpec; dropped: string[] };

/**
 * Code decides, the spec obeys. Every time is clamped to the video, a
 * transition never eats more than a third of the shortest piece, and a text
 * that isn't one of the allowed lines (the approved copy, the brand's name or
 * words the person quoted) is dropped, never shown. Throws on a spec that
 * doesn't parse at all.
 */
export function groundSpec(input: unknown, allowedText: string[]): GroundResult {
  const spec = MotionMoxSpecSchema.parse(input);
  const dropped: string[] = [];
  const shortest = Math.min(...spec.segments.map((s) => s.seconds));
  const transitionSeconds =
    spec.segments.length < 2 || spec.transition === "none"
      ? 0
      : Math.min(spec.transitionSeconds, Math.round((shortest / 3) * 100) / 100);
  const total = specSeconds({ ...spec, transitionSeconds });
  const clamp = (t: number) => Math.min(total, Math.max(0, t));
  const allowed = new Set(allowedText.map(norm).filter(Boolean));

  const texts = spec.texts.flatMap((t) => {
    if (!allowed.has(norm(t.text))) {
      dropped.push(`text not in the approved copy: "${t.text}"`);
      return [];
    }
    const from = clamp(t.from);
    const to = clamp(t.to);
    if (to - from < 0.5) {
      dropped.push(`text too short to read: "${t.text}"`);
      return [];
    }
    return [{ ...t, from, to }];
  });
  const captions = spec.captions
    .map((c) => ({ ...c, start: clamp(c.start), end: clamp(c.end) }))
    .filter((c) => c.end - c.start > 0.05);
  const overlay =
    spec.overlay && clamp(spec.overlay.to) - clamp(spec.overlay.from) > 0.3
      ? { ...spec.overlay, from: clamp(spec.overlay.from), to: clamp(spec.overlay.to) }
      : null;
  const safe = {
    x: Math.max(MOTIONMOX_SAFE.x, spec.safe.x),
    top: Math.max(MOTIONMOX_SAFE.top, spec.safe.top),
    bottom: Math.max(MOTIONMOX_SAFE.bottom, spec.safe.bottom),
  };
  return {
    spec: {
      ...spec,
      transitionSeconds,
      texts,
      captions,
      overlay,
      logo: spec.logo ? { ...spec.logo, from: clamp(spec.logo.from) } : null,
      safe,
      // Even numbers: h264 with yuv420p needs them.
      width: spec.width - (spec.width % 2),
      height: spec.height - (spec.height % 2),
    },
    dropped,
  };
}
