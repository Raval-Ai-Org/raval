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

export function allowedDurations(model: ModelView, imageCount: number): number[] {
  return imageCount > 0 && model.imageDurations ? model.imageDurations : model.durations;
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
