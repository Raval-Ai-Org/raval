/**
 * The "Meet Mox" film's clock (107 seconds, 16:9). Pure, like `timeline.ts`:
 * a frame is a function of the time in seconds, so the film can be scrubbed
 * and recorded frame by frame.
 */

export const MOX_FPS = 30;
export const MOX_DURATION = 107;

export type MoxSceneId =
  | "built"
  | "pressure"
  | "meet"
  | "learn"
  | "create"
  | "always"
  | "loop"
  | "payoff"
  | "price"
  | "finale";

export type MoxSceneSpan = { id: MoxSceneId; start: number; end: number };

/**
 * Scene starts follow the narration (`promo/meet-mox/voice`): each scene opens
 * a beat before its line is spoken.
 */
export const MOX_SCENES: readonly MoxSceneSpan[] = [
  { id: "built", start: 0, end: 11 },
  { id: "pressure", start: 11, end: 27.6 },
  { id: "meet", start: 27.6, end: 35.2 },
  { id: "learn", start: 35.2, end: 46.8 },
  { id: "create", start: 46.8, end: 65.4 },
  { id: "always", start: 65.4, end: 72.2 },
  { id: "loop", start: 72.2, end: 79.4 },
  { id: "payoff", start: 79.4, end: 89.8 },
  { id: "price", start: 89.8, end: 95.4 },
  { id: "finale", start: 95.4, end: 107 },
];

/** The scene on screen at `t`. The last scene holds through the final frame. */
export function moxSceneAt(t: number): MoxSceneSpan {
  const time = Math.min(Math.max(t, 0), MOX_DURATION);
  return (
    MOX_SCENES.find((scene) => time >= scene.start && time < scene.end) ??
    MOX_SCENES[MOX_SCENES.length - 1]
  );
}

export function moxTotalFrames(): number {
  return Math.round(MOX_DURATION * MOX_FPS);
}

/**
 * Footage drawn as numbered stills (`public/promo-mox/<name>/f0001.jpg`, made
 * by `scripts/promo-mox-media.mjs`, never committed). `frames: 0` means the
 * footage is not there yet and the scene shows its still instead.
 */
export const MOX_MEDIA = {
  "clip-meet": { frames: 121, fps: 24 },
  "clip-always": { frames: 121, fps: 24 },
  "clip-finale": { frames: 121, fps: 24 },
  "clip-orb": { frames: 121, fps: 24 },
  "clip-tired": { frames: 121, fps: 24 },
  "reel-1": { frames: 210, fps: 30 },
  "reel-2": { frames: 210, fps: 30 },
  "reel-3": { frames: 210, fps: 30 },
  "reel-4": { frames: 210, fps: 30 },
  "skin-fix": { frames: 210, fps: 30 },
  "website-losing-customers": { frames: 210, fps: 30 },
} as const;

export type MoxMediaName = keyof typeof MOX_MEDIA;

/** The still to draw for `name` at `seconds` into it; null when there is no footage. */
export function mediaFrame(
  name: MoxMediaName,
  seconds: number,
  { loop = false }: { loop?: boolean } = {},
): string | null {
  const media = MOX_MEDIA[name];
  if (media.frames <= 0) return null;
  const raw = Math.floor(Math.max(seconds, 0) * media.fps);
  const index = loop ? raw % media.frames : Math.min(raw, media.frames - 1);
  return `/promo-mox/${name}/f${String(index + 1).padStart(4, "0")}.jpg`;
}

/** Whether footage for `name` has been cut into stills yet. */
export function hasMedia(name: MoxMediaName): boolean {
  return MOX_MEDIA[name].frames > 0;
}

/** A steady pseudo-random number in 0..1 for `seed` (layout jitter, never time). */
export function rand(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}
