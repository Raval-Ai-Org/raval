// Which meter pays for a video: one of the month's free videos, or credits.
// Pure and browser-safe; the quote, the Studio hold and UGC all use it, so the
// price a person sees is the one charged.
import {
  FREE_VIDEO_UNITS,
  videoCreditsFor,
  type UgcModelKey,
  type VideoResolution,
} from "./catalog";

/** A free video covers one whole video on these options, any offered length. */
export const FREE_VIDEO_OPTIONS: readonly UgcModelKey[] = ["draft", "standard"];

export type VideoCharge =
  | { meter: "video"; amount: number; label: string }
  | { meter: "credits"; amount: number; label: string };

export function videoChargePlan(args: {
  /** The account's video balance in units (100 = 1 free video). */
  videoBalance: number;
  option: UgcModelKey;
  seconds: number;
  resolution: VideoResolution;
  /** The routed provider's cost, a floor for the credit price. */
  providerCostUsd?: number;
}): VideoCharge {
  if (FREE_VIDEO_OPTIONS.includes(args.option) && args.videoBalance >= FREE_VIDEO_UNITS)
    return { meter: "video", amount: FREE_VIDEO_UNITS, label: "Free video" };
  const amount = videoCreditsFor(args.option, args.seconds, args.resolution, args.providerCostUsd);
  return { meter: "credits", amount, label: `${amount.toLocaleString("en-US")} credits` };
}

/** Whole free videos left in a video balance. */
export function freeVideosLeft(videoBalance: number): number {
  return Math.max(0, Math.floor(videoBalance / FREE_VIDEO_UNITS));
}

/** "Free video · 1 of 2 left" (left counts this one), for a price chip. */
export function freeVideoLabel(left: number, monthly: number): string {
  return monthly > 0 && left <= monthly
    ? `Free video · ${left} of ${monthly} left`
    : `Free video · ${left} left`;
}
