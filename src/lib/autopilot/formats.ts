// Which format a planned piece gets. A week on a channel should not be five of
// the same thing, and what does well differs by channel: carousels and video on
// Instagram, words on LinkedIn and X. This file decides the mix; the plan may
// still swap a slot to another allowed format when the idea needs it.
// Pure: no I/O.
import type { PlatformId } from "@/lib/social-platforms";
import { STUDIO_FORMATS } from "@/lib/studio/formats";
import { weightedSequence } from "@/lib/studio/viral";
import { isAutopilotType, type AutopilotType } from "./contracts";

/** Channels that cannot publish words alone: a post there always has a picture or a video. */
export const PICTURE_PLATFORMS: readonly string[] = ["instagram", "tiktok", "youtube"];

export function needsPicture(platform: string | null | undefined): boolean {
  return Boolean(platform) && PICTURE_PLATFORMS.includes(platform as string);
}

/**
 * A text post headed for a picture-only channel is made with an image, so it
 * can go out. Every other format already carries its own media.
 */
export function withPicture(
  type: string | null | undefined,
  platform: string | null | undefined,
): boolean {
  return (type ?? "social") === "social" && needsPicture(platform);
}

/** How often each format should come up on a channel, relative to the others. */
const FORMAT_FIT: Record<PlatformId, Partial<Record<AutopilotType, number>>> = {
  instagram: { carousel: 3, image: 3, video: 2, social: 1 },
  tiktok: { video: 3, image: 2, social: 1 },
  youtube: { video: 3, social: 1 },
  linkedin: { social: 3, carousel: 2, image: 2, video: 1 },
  facebook: { image: 3, social: 2, video: 2, carousel: 1 },
  twitter: { social: 3, image: 2, video: 1 },
  threads: { social: 3, image: 2 },
};

/** The formats a program allows that this channel can carry (never an article). */
export function typesFor(platform: PlatformId, contentTypes: readonly string[]): AutopilotType[] {
  const fits = contentTypes.filter(
    (t): t is AutopilotType =>
      isAutopilotType(t) && t !== "article" && STUDIO_FORMATS[t].platforms.includes(platform),
  );
  return fits.length ? [...new Set(fits)] : ["social"];
}

/**
 * The format of each of a channel's `count` posts in one week. `offset` is how
 * many posts the channel has had in earlier weeks, so a new week carries on
 * the rotation instead of starting it again.
 */
export function formatMix(
  platform: PlatformId,
  contentTypes: readonly string[],
  count: number,
  offset = 0,
): AutopilotType[] {
  const allowed = typesFor(platform, contentTypes);
  const fit = FORMAT_FIT[platform] ?? {};
  const weights: Partial<Record<AutopilotType, number>> = {};
  for (const type of allowed) weights[type] = fit[type] ?? 1;
  return weightedSequence(weights, count, offset);
}
