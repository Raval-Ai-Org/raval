// Which Studio videos are short clips, priced in credits instead of Video
// Credits (src/lib/billing/catalog.ts). Shared by the Generate button, the
// creation-points price and the server's charge, so all three agree.
// Pure and browser-safe.
import {
  SHORT_CLIP_MAX_SECONDS,
  isShortClipKey,
  shortClipCredits,
  shortClipPoints,
  type ShortClipKey,
  type VideoResolution,
} from "@/lib/billing/catalog";
import { RECAP_AI_SECONDS } from "./clip-edit";
import type { StudioControls } from "./jobs";
import type { StudioType } from "./formats";

export type ShortClipPlan = {
  ugcKey: ShortClipKey;
  resolution: VideoResolution;
  /** How many AI clips run: one, or one per animated recap photo. */
  clips: number;
  seconds: number;
};

type ClipControls = Pick<
  StudioControls,
  | "videoModelKey"
  | "durationSec"
  | "videoResolution"
  | "videoPreview"
  | "videoMode"
  | "recapMotion"
  | "storyMode"
  | "referenceAssetIds"
>;

/**
 * A short clip, or null for a video on Video Credits. A Premium, Cinematic or
 * Long-take option, or anything over 8 seconds, stays a video.
 */
export function shortClipPlan(input: {
  type: StudioType;
  controls: ClipControls;
}): ShortClipPlan | null {
  const c = input.controls;
  if (c.videoPreview || !isShortClipKey(c.videoModelKey)) return null;
  const resolution: VideoResolution = c.videoResolution === "1080P" ? "1080p" : "720p";
  const base = { ugcKey: c.videoModelKey, resolution };
  if (input.type === "video" && c.videoMode === "recap") {
    if (c.recapMotion !== "ai") return null;
    const photos = c.referenceAssetIds?.length ?? 0;
    return photos ? { ...base, clips: photos, seconds: RECAP_AI_SECONDS } : null;
  }
  if (input.type === "video" && c.videoMode && c.videoMode !== "generate") return null;
  if (input.type === "story" && c.storyMode !== "video") return null;
  if (input.type !== "video" && input.type !== "story") return null;
  const seconds = c.durationSec ?? 10;
  return seconds <= SHORT_CLIP_MAX_SECONDS ? { ...base, clips: 1, seconds } : null;
}

/** Catalog credits for a short clip (the server adds its provider-cost floor). */
export function shortClipPrice(plan: ShortClipPlan): { credits: number; points: number } {
  const credits = shortClipCredits(plan);
  return { credits, points: shortClipPoints(credits) };
}
