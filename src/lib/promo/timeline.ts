/**
 * The product film's clock. Everything here is pure: a frame is a function of
 * the time in seconds, so the film can be scrubbed and recorded frame by frame.
 */

export const FPS = 30;
export const DURATION = 40;
export const STAGE = { width: 1920, height: 1080 } as const;

export type SceneId =
  | "hook"
  | "reveal"
  | "website"
  | "panels"
  | "brains"
  | "brain"
  | "studio"
  | "autopilot"
  | "visibility"
  | "connect"
  | "chat"
  | "allinone"
  | "outro";

export type SceneSpan = { id: SceneId; start: number; end: number };

export const SCENES: readonly SceneSpan[] = [
  { id: "hook", start: 0, end: 2.6 },
  { id: "reveal", start: 2.6, end: 5.2 },
  { id: "website", start: 5.2, end: 8.2 },
  { id: "panels", start: 8.2, end: 12.5 },
  { id: "brains", start: 12.5, end: 15 },
  { id: "brain", start: 15, end: 18 },
  { id: "studio", start: 18, end: 21 },
  { id: "autopilot", start: 21, end: 24 },
  { id: "visibility", start: 24, end: 27 },
  { id: "connect", start: 27, end: 29.5 },
  { id: "chat", start: 29.5, end: 35 },
  { id: "allinone", start: 35, end: 37.5 },
  { id: "outro", start: 37.5, end: 40 },
];

export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** How far through a move that starts at `start` and lasts `duration`, 0 to 1. */
export function progress(t: number, start: number, duration: number): number {
  if (duration <= 0) return t >= start ? 1 : 0;
  return clamp01((t - start) / duration);
}

export function lerp(from: number, to: number, p: number): number {
  return from + (to - from) * p;
}

export function easeOut(p: number): number {
  const x = clamp01(p);
  return 1 - Math.pow(1 - x, 3);
}

export function easeInOut(p: number): number {
  const x = clamp01(p);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

/** Overshoots a little before settling: for badges and tiles that pop in. */
export function easeOutBack(p: number): number {
  const x = clamp01(p);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

/** Eased progress of a move, the common case. */
export function move(t: number, start: number, duration: number): number {
  return easeOut(progress(t, start, duration));
}

/** The part of `text` typed so far. */
export function typed(text: string, p: number): string {
  return text.slice(0, Math.round(text.length * clamp01(p)));
}

/** A whole number counting from `from` to `to`. */
export function count(from: number, to: number, p: number): number {
  return Math.round(lerp(from, to, easeOut(p)));
}

/** The scene on screen at `t`. The last scene holds through the final frame. */
export function sceneAt(t: number): SceneSpan {
  const time = Math.min(Math.max(t, 0), DURATION);
  return (
    SCENES.find((scene) => time >= scene.start && time < scene.end) ?? SCENES[SCENES.length - 1]
  );
}

export function totalFrames(): number {
  return Math.round(DURATION * FPS);
}
