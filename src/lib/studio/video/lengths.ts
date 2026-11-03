// How long a Studio video is, in whole clips. Pure and browser-safe.
//
// A video model makes clips of a few fixed lengths. A longer video is several
// clips joined. Each clip is made at the model's full length and used whole:
// a clip is never cut short, because the model ends its moment at its own
// last second and a cut there leaves the story unfinished.

import type { UgcModelKey } from "@/lib/ugc/models";
import { videoKind, type VideoKindId } from "./kinds";

/**
 * One clip's length per model, chosen so both providers make it natively
 * (a fallback from one provider to the other never changes the plan).
 */
export const CLIP_SECONDS: Record<UgcModelKey, number> = {
  standard: 8,
  draft: 8,
  premium: 10,
  long: 15,
  cinematic: 10,
  variation: 5,
};

/** At most this many clips per video: each one waits for the one before. */
export const MAX_VIDEO_CLIPS = 4;
export const MAX_STUDIO_VIDEO_SECONDS = 60;

export type ClipPlan = { start: number; seconds: number }[];

export function clipSeconds(model: UgcModelKey): number {
  return CLIP_SECONDS[model] ?? 8;
}

/** How many clips a length takes on a model (at least one). */
export function clipCount(seconds: number, model: UgcModelKey): number {
  return Math.max(1, Math.round(seconds / clipSeconds(model)));
}

/** The lengths offered for a model and kind: whole clips only. */
export function lengthChoices(model: UgcModelKey, kind: VideoKindId): number[] {
  const each = clipSeconds(model);
  const most = Math.min(videoKind(kind).maxClips, MAX_VIDEO_CLIPS);
  const out: number[] = [];
  for (let n = 1; n <= most && n * each <= MAX_STUDIO_VIDEO_SECONDS; n++) out.push(n * each);
  return out;
}

/** The kind's default length on a model. */
export function defaultLength(model: UgcModelKey, kind: VideoKindId): number {
  const choices = lengthChoices(model, kind);
  const wanted = videoKind(kind).defaultClips * clipSeconds(model);
  return choices.includes(wanted) ? wanted : choices[choices.length - 1];
}

/**
 * The nearest offered length to one saved earlier (an old 10 s default, or a
 * length picked before the model changed). Ties go to the longer one.
 */
export function snapLength(seconds: number | undefined, model: UgcModelKey, kind: VideoKindId) {
  const choices = lengthChoices(model, kind);
  if (seconds == null) return defaultLength(model, kind);
  return choices.reduce((best, n) =>
    Math.abs(n - seconds) < Math.abs(best - seconds) ||
    (Math.abs(n - seconds) === Math.abs(best - seconds) && n > best)
      ? n
      : best,
  );
}

/** The clips a length is made of, back to back. */
export function clipPlan(seconds: number, model: UgcModelKey): ClipPlan {
  const each = clipSeconds(model);
  const count = clipCount(seconds, model);
  return Array.from({ length: count }, (_, i) => ({ start: i * each, seconds: each }));
}
