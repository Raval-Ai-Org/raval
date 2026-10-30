import "server-only";
import { createHash } from "node:crypto";
import {
  SHORT_CLIP_MAX_SECONDS,
  isShortClipKey,
  shortClipCredits,
  videoFeatureFor,
  videoUnitsFor,
  type VideoResolution,
} from "@/lib/billing/catalog";
import { activeModel, estimateRender, isModelEnabled } from "@/server/ugc/models.server";
import { HttpError } from "@/server/http-error";
import type { StudioControls } from "@/lib/studio/jobs";
import { RECAP_AI_SECONDS } from "@/lib/studio/clip-edit";
import type { AspectRatio } from "@/lib/studio/aspect";

/**
 * Same price rule and runtime provider registry used by UGC. No provider call.
 * A short clip (Economy or Standard, 8 s or less) is quoted in credits.
 */
export function quoteStudioVideo(controls: StudioControls) {
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
  const short = isShortClipKey(key) && seconds <= SHORT_CLIP_MAX_SECONDS;
  const meter = short ? ("credits" as const) : ("video" as const);
  const units = short
    ? shortClipCredits({ ugcKey: key, resolution, providerCostUsd: estimate.usd })
    : videoUnitsFor({ ugcKey: key, seconds, resolution, providerCostUsd: estimate.usd });
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
