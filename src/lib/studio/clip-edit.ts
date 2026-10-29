// Branding a brand's own clips and turning its photos into a recap video:
// the timeline, decided by code. The footage and photos are never redrawn;
// the image model only makes the opening design layer and the end card.
// Pure and browser-safe.
import type { AspectRatio } from "./aspect";
import { bestWindow, plainAnalysis, shareTime, usableRange, type ClipAnalysis } from "./smart-cut";

/** Longest piece of one clip that is kept. */
export const MAX_CLIP_SECONDS = 20;
/** Longest finished video, end card included. */
export const MAX_EDIT_SECONDS = 60;
/** How long the opening design stays on screen, and its fades. */
export const OVERLAY_SECONDS = 4;
export const OVERLAY_FADE_SECONDS = 0.5;
export const END_CARD_SECONDS = 3;
/** Each photo's time in a recap. */
export const RECAP_PHOTO_SECONDS = 4;
/** AI motion clips are this long (the shortest every video model makes). */
export const RECAP_AI_SECONDS = 5;
export const MAX_CLIPS = 5;

export type ClipPlan = { index: number; start: number; seconds: number };

/**
 * Which part of each clip is used. The minute (less the end card) is shared
 * fairly, so every clip appears; each gets at most MAX_CLIP_SECONDS. Inside
 * its share, a measured clip skips black, frozen or silent ends and starts on
 * a scene change or a sentence (smart-cut.ts); a clip known only by its
 * length plays from the start. A clip too short to show anything is dropped.
 */
export function planClips(clips: (number | ClipAnalysis)[], endCard = true): ClipPlan[] {
  const room = MAX_EDIT_SECONDS - (endCard ? END_CARD_SECONDS : 0);
  const analyses = clips
    .slice(0, MAX_CLIPS)
    .map((clip) => (typeof clip === "number" ? plainAnalysis(clip) : clip));
  const usable = analyses.map((a) =>
    Number.isFinite(a.duration) && a.duration >= 0.5
      ? (({ start, end }) => end - start)(usableRange(a))
      : 0,
  );
  const shares = shareTime(usable, room, MAX_CLIP_SECONDS);
  const plan: ClipPlan[] = [];
  analyses.forEach((a, index) => {
    if (shares[index] < 0.5) return;
    const window = bestWindow(a, shares[index]);
    if (window.seconds >= 0.5) plan.push({ index, ...window });
  });
  return plan;
}

/** Recap length: every photo gets its time, plus the end card. */
export function recapSeconds(photos: number, motion: "camera" | "ai"): number {
  return photos * (motion === "ai" ? RECAP_AI_SECONDS : RECAP_PHOTO_SECONDS) + END_CARD_SECONDS;
}

/** Output size for a ratio: even numbers, 720 on the short side (light enough to post). */
export function videoCanvas(ratio: AspectRatio): { width: number; height: number } {
  const sizes: Record<AspectRatio, { width: number; height: number }> = {
    "9:16": { width: 720, height: 1280 },
    "16:9": { width: 1280, height: 720 },
    "1:1": { width: 720, height: 720 },
    "4:5": { width: 720, height: 900 },
    "3:4": { width: 720, height: 960 },
    "4:3": { width: 960, height: 720 },
  };
  return sizes[ratio];
}

/**
 * The opening design's opacity at a time (seconds from the start): fades in,
 * holds, fades out. FFmpeg gets the same numbers as an expression.
 */
export function overlayOpacity(t: number): number {
  if (t < 0 || t > OVERLAY_SECONDS) return 0;
  if (t < OVERLAY_FADE_SECONDS) return t / OVERLAY_FADE_SECONDS;
  if (t > OVERLAY_SECONDS - OVERLAY_FADE_SECONDS)
    return (OVERLAY_SECONDS - t) / OVERLAY_FADE_SECONDS;
  return 1;
}

/** A slow push-in for a still photo: zoom from 1 to this over its time. */
export const RECAP_ZOOM = 1.08;

/** Plain words for the video modes. */
export const VIDEO_MODES = [
  { value: "generate" as const, label: "Make a new video", hint: "AI makes the footage" },
  { value: "brand" as const, label: "Brand my clips", hint: "Your footage, with your design" },
  { value: "recap" as const, label: "Recap from my photos", hint: "Your photos as a short video" },
  { value: "site" as const, label: "From my website", hint: "Your site scrolling on a screen" },
];
