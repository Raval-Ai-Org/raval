import "server-only";
import { createHash } from "node:crypto";
import {
  SHORT_CLIP_MAX_SECONDS,
  isShortClipKey,
  shortClipCredits,
  videoFeatureFor,
  type VideoResolution,
} from "@/lib/billing/catalog";
import { freeVideosLeft, videoChargePlan } from "@/lib/billing/video-charge";
import {
  activeModel,
  estimateRender,
  isModelEnabled,
  videoMaxUsdPerJob,
} from "@/server/ugc/models.server";
import { HttpError } from "@/server/http-error";
import type { StudioControls } from "@/lib/studio/jobs";
import { RECAP_AI_SECONDS } from "@/lib/studio/clip-edit";
import type { AspectRatio } from "@/lib/studio/aspect";

/**
 * Same price rule and runtime provider registry used by UGC. No provider call.
 * A short clip (Economy or Standard, 8 s or less) is quoted in credits. A
 * longer video is one of the month's free videos while one is left (Draft or
 * Standard) or one of the month's premium videos (Premium, Cinematic, Long, up
 * to 24 s) while one is left, otherwise credits (`videoChargePlan`). The meter
 * is in the hash, so a quote shown as free no longer holds once they are used.
 */
export function quoteStudioVideo(
  controls: StudioControls,
  opts: {
    /** The account's video balance in units; none means no free video. */
    videoBalance?: number;
    /** Premium videos left this month; none means credits. */
    premiumBalance?: number;
  } = {},
) {
  const key = controls.videoModelKey ?? "standard";
  if (!isModelEnabled(key)) throw new HttpError(400, "This video option is unavailable.");
  const model = activeModel(key);
  const requested = (controls.videoResolution ?? "720P").toLowerCase() as VideoResolution;
  const resolution = model.resolutions.includes(requested) ? requested : model.defaultResolution;
  const requestedRatio = controls.ratio ?? "9:16";
  const aspectRatio = (
    model.aspectRatios.includes(requestedRatio as never) ? requestedRatio : model.aspectRatios[0]
  ) as AspectRatio;
  const seconds = controls.durationSec ?? 10;
  const referenceCount = Math.min(4, controls.referenceAssetIds?.length ?? 0);
  const estimate = estimateRender(model, resolution, seconds, referenceCount);
  // Checked before any price is shown, so nothing is held or made.
  if (estimate.usd > videoMaxUsdPerJob())
    throw new HttpError(
      400,
      "This video is too long for this option. Choose a shorter length or another option.",
    );
  const short = isShortClipKey(key) && seconds <= SHORT_CLIP_MAX_SECONDS;
  const videoBalance = Math.max(0, opts.videoBalance ?? 0);
  const premiumBalance = Math.max(0, opts.premiumBalance ?? 0);
  const charge = short
    ? {
        meter: "credits" as const,
        amount: shortClipCredits({ ugcKey: key, resolution, providerCostUsd: estimate.usd }),
      }
    : videoChargePlan({
        videoBalance,
        premiumBalance,
        option: key,
        seconds,
        resolution,
        providerCostUsd: estimate.usd,
      });
  const meter = charge.meter;
  const units = charge.amount;
  const hash = createHash("sha256")
    .update(
      JSON.stringify({
        key,
        provider: model.provider,
        providerModel: model.providerModel,
        resolution,
        seconds,
        referenceCount,
        aspectRatio,
        usd: estimate.usd,
        units,
        meter,
      }),
    )
    .digest("hex");
  return {
    hash,
    units,
    meter,
    model: key,
    resolution,
    aspectRatio,
    feature: videoFeatureFor(key, resolution),
    /** Whole free videos left before this one (shown as "N of 2 left"). */
    freeLeft: freeVideosLeft(videoBalance),
    /** Premium videos left before this one. */
    premiumLeft: Math.floor(premiumBalance),
  };
}

/**
 * Credits for a recap's animated photos: one short clip per photo, each with
 * the routed provider's cost as a floor (like the single-clip quote).
 */
export function shortClipCreditsForRecap(controls: StudioControls, photos: number): number {
  const key = controls.videoModelKey;
  if (!isShortClipKey(key)) throw new HttpError(400, "This video option is unavailable.");
  if (!isModelEnabled(key)) throw new HttpError(400, "This video option is unavailable.");
  const model = activeModel(key);
  const requested = (controls.videoResolution ?? "720P").toLowerCase() as VideoResolution;
  const resolution = model.resolutions.includes(requested) ? requested : model.defaultResolution;
  const estimate = estimateRender(model, resolution, RECAP_AI_SECONDS, 1);
  return shortClipCredits({
    ugcKey: key,
    resolution,
    clips: photos,
    providerCostUsd: estimate.usd,
  });
}
