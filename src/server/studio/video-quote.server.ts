import "server-only";
import { createHash } from "node:crypto";
import { videoFeatureFor, videoUnitsFor, type VideoResolution } from "@/lib/billing/catalog";
import { activeModel, estimateRender, isModelEnabled } from "@/server/ugc/models.server";
import { HttpError } from "@/server/http-error";
import type { StudioControls } from "@/lib/studio/jobs";
import type { AspectRatio } from "@/lib/studio/aspect";

/** Same price rule and runtime provider registry used by UGC. No provider call. */
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
  const units = videoUnitsFor({ ugcKey: key, seconds, resolution, providerCostUsd: estimate.usd });
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
      }),
    )
    .digest("hex");
  return {
    hash,
    units,
    model: key,
    resolution,
    aspectRatio,
    feature: videoFeatureFor(key, resolution),
  };
}
