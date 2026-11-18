// Snap a creator video's settings to what a model supports. Pure and
// browser-safe; mirrors coerceRenderSettings on the server.

import type { ModelView } from "./schemas";

export type RenderSettingsState = {
  model: string;
  durationSec: number;
  aspectRatio: string;
  resolution: string;
  referenceIds: string[];
};

/** The longest creator video offered in the composer (clips are joined on the server). */
export const CREATOR_MAX_SECONDS = 20;

/**
 * The lengths a person can pick: one short native clip, then 10, 15 and 20
 * seconds. Longer than one clip is several clips joined on the server
 * (`planVideoSegments`), which `checkRenderSettings` already accepts.
 */
export function allowedDurations(model: ModelView, imageCount: number): number[] {
  const native = imageCount > 0 && model.imageDurations ? model.imageDurations : model.durations;
  if (!native.length) return native;
  const shortest = native.filter((d) => d >= 5 && d <= 8).at(-1) ?? Math.min(...native);
  return [...new Set([shortest, 10, 15, CREATOR_MAX_SECONDS])]
    .filter((d) => d <= CREATOR_MAX_SECONDS && d >= Math.min(...native))
    .sort((a, b) => a - b);
}

export function usableRefs(model: ModelView, ids: string[]): string[] {
  return model.images ? ids.slice(0, model.images.max) : [];
}

export function coerceSettings(
  model: ModelView,
  s: RenderSettingsState,
  preferRatio?: string,
): RenderSettingsState {
  const refs = usableRefs(model, s.referenceIds);
  const durations = allowedDurations(model, refs.length);
  const durationSec = durations.includes(s.durationSec)
    ? s.durationSec
    : durations.reduce((best, d) =>
        Math.abs(d - s.durationSec) < Math.abs(best - s.durationSec) ? d : best,
      );
  const wantRatio = preferRatio ?? s.aspectRatio;
  return {
    model: model.key,
    durationSec,
    aspectRatio: model.aspectRatios.includes(wantRatio) ? wantRatio : model.aspectRatios[0],
    resolution: model.resolutions.includes(s.resolution) ? s.resolution : model.defaultResolution,
    referenceIds: s.referenceIds,
  };
}
