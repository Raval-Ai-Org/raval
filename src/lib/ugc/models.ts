// UGC video model registry. Pure data — shared by the studio UI (which only
// offers what a model can really do) and the server (which validates every
// render against the same entry and builds the provider request from it).
//
// Capabilities and prices were confirmed against Kie.ai on 2026-09-16: live
// createTask validation for every enum below, one real Veo 3.1 Lite
// reference-to-video render, and the kie.ai/pricing table. Prices are Kie
// credits (1 credit = KIE_USD_PER_CREDIT, $0.005 by default) and can be
// overridden per model and resolution without a deploy (see
// src/server/ugc/models.server.ts). The provider's `creditsConsumed` on the
// finished task is what is finally metered.

export type UgcAspectRatio = "9:16" | "1:1" | "16:9" | "4:3" | "3:4";
export type UgcResolution = "480p" | "720p" | "1080p";
export type UgcModelKey =
  | "veo-3-1-fast"
  | "veo-3-1-quality"
  | "veo-3-1-lite"
  | "seedance-2"
  | "seedance-2-fast";

/**
 * How product images reach the model:
 *   references  — the model keeps the product consistent from 1–N images
 *                 (Veo REFERENCE_2_VIDEO, Seedance reference_image_urls)
 *   first_frame — the image opens the video (Veo image-to-video); the product
 *                 is shown exactly, then comes alive
 */
export type ReferenceMode = "references" | "first_frame";

export type UgcModel = {
  key: UgcModelKey;
  provider: "kie";
  family: "veo" | "seedance";
  /** Kie `model` field. */
  providerModel: string;
  /** Kie `input.model` tier for Veo 3.1 (veo3 | veo3_fast | veo3_lite). */
  providerVariant?: string;
  displayName: string;
  tier: "draft" | "standard" | "premium";
  description: string;
  durations: number[];
  aspectRatios: UgcAspectRatio[];
  resolutions: UgcResolution[];
  defaultResolution: UgcResolution;
  /** Generates speech and ambient sound with the picture. */
  nativeAudio: boolean;
  /** Lip-synced spoken dialogue from quoted lines in the prompt. */
  spokenDialogue: boolean;
  images: {
    mode: ReferenceMode;
    max: number;
    /** Durations allowed when images are attached (Veo references: 8s only). */
    durations?: number[];
  } | null;
  pricing:
    | { unit: "video"; credits: Partial<Record<UgcResolution, number>> }
    | { unit: "second"; credits: Partial<Record<UgcResolution, number>> };
  enabledByDefault: boolean;
};

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

export const UGC_MODELS: Record<UgcModelKey, UgcModel> = {
  "veo-3-1-fast": {
    key: "veo-3-1-fast",
    provider: "kie",
    family: "veo",
    providerModel: "veo-3-1",
    providerVariant: "veo3_fast",
    displayName: "Veo 3.1 Fast",
    tier: "standard",
    description:
      "Realistic creators with lip-synced speech and your product from reference photos. The best value for UGC ads.",
    durations: [4, 6, 8],
    aspectRatios: ["9:16", "16:9"],
    resolutions: ["720p", "1080p"],
    defaultResolution: "720p",
    nativeAudio: true,
    spokenDialogue: true,
    images: { mode: "references", max: 3, durations: [8] },
    // Kie: text/image-to-video Fast 720p 60, 1080p 65; reference-to-video Fast 1080p 65.
    pricing: { unit: "video", credits: { "720p": 60, "1080p": 65 } },
    enabledByDefault: true,
  },
  "veo-3-1-quality": {
    key: "veo-3-1-quality",
    provider: "kie",
    family: "veo",
    providerModel: "veo-3-1",
    providerVariant: "veo3",
    displayName: "Veo 3.1 Quality",
    tier: "premium",
    description:
      "Google's highest-fidelity model for hero ads. A product photo can open the video as its first frame.",
    durations: [4, 6, 8],
    aspectRatios: ["9:16", "16:9"],
    resolutions: ["720p", "1080p"],
    defaultResolution: "1080p",
    nativeAudio: true,
    spokenDialogue: true,
    // Reference-to-video is Fast/Lite only on Kie; Quality takes an opening frame.
    images: { mode: "first_frame", max: 1 },
    pricing: { unit: "video", credits: { "720p": 250, "1080p": 255 } },
    enabledByDefault: true,
  },
  "veo-3-1-lite": {
    key: "veo-3-1-lite",
    provider: "kie",
    family: "veo",
    providerModel: "veo-3-1",
    providerVariant: "veo3_lite",
    displayName: "Veo 3.1 Lite",
    tier: "draft",
    description: "Quick, low-cost drafts to test hooks and concepts before a final render.",
    durations: [4, 6, 8],
    aspectRatios: ["9:16", "16:9"],
    resolutions: ["720p", "1080p"],
    defaultResolution: "720p",
    nativeAudio: true,
    spokenDialogue: true,
    images: { mode: "references", max: 3, durations: [8] },
    pricing: { unit: "video", credits: { "720p": 30, "1080p": 35 } },
    enabledByDefault: true,
  },
  "seedance-2": {
    key: "seedance-2",
    provider: "kie",
    family: "seedance",
    providerModel: "bytedance/seedance-2",
    displayName: "Seedance 2.0",
    tier: "premium",
    description:
      "Longer takes up to 15 seconds, square video, and up to 9 product photos for accurate packaging.",
    durations: range(4, 15),
    aspectRatios: ["9:16", "1:1", "16:9", "4:3", "3:4"],
    resolutions: ["720p", "1080p"],
    defaultResolution: "720p",
    nativeAudio: true,
    spokenDialogue: true,
    images: { mode: "references", max: 9 },
    pricing: { unit: "second", credits: { "720p": 41, "1080p": 102 } },
    enabledByDefault: true,
  },
  "seedance-2-fast": {
    key: "seedance-2-fast",
    provider: "kie",
    family: "seedance",
    providerModel: "bytedance/seedance-2-fast",
    displayName: "Seedance 2.0 Fast",
    tier: "standard",
    description: "Faster, cheaper Seedance renders up to 15 seconds, including square video.",
    durations: range(4, 15),
    aspectRatios: ["9:16", "1:1", "16:9", "4:3", "3:4"],
    resolutions: ["480p", "720p"],
    defaultResolution: "720p",
    nativeAudio: true,
    spokenDialogue: true,
    images: { mode: "references", max: 9 },
    pricing: { unit: "second", credits: { "480p": 11.7, "720p": 24.8 } },
    enabledByDefault: true,
  },
};

export const UGC_MODEL_KEYS = Object.keys(UGC_MODELS) as UgcModelKey[];
export const DEFAULT_UGC_MODEL: UgcModelKey = "veo-3-1-fast";

export function isUgcModelKey(value: unknown): value is UgcModelKey {
  return typeof value === "string" && value in UGC_MODELS;
}

/** Durations valid for this model given whether product images are attached. */
export function durationsFor(model: UgcModel, withImages: boolean): number[] {
  if (withImages && model.images?.durations?.length) return model.images.durations;
  return model.durations;
}

/** How many images the render will actually send (0 when the model takes none). */
export function usableImageCount(model: UgcModel, attached: number): number {
  if (!model.images) return 0;
  return Math.min(model.images.max, Math.max(0, attached));
}

export type RenderSettings = {
  model: UgcModelKey;
  durationSec: number;
  aspectRatio: UgcAspectRatio;
  resolution: UgcResolution;
  imageCount: number;
};

export type SettingsProblem = { field: keyof RenderSettings; message: string };

/** Validate a settings combination against the registry. Empty = valid. */
export function checkRenderSettings(model: UgcModel, s: RenderSettings): SettingsProblem[] {
  const problems: SettingsProblem[] = [];
  const images = usableImageCount(model, s.imageCount);
  if (!model.aspectRatios.includes(s.aspectRatio)) {
    problems.push({
      field: "aspectRatio",
      message: `${model.displayName} supports ${model.aspectRatios.join(", ")}.`,
    });
  }
  if (!model.resolutions.includes(s.resolution)) {
    problems.push({
      field: "resolution",
      message: `${model.displayName} supports ${model.resolutions.join(", ")}.`,
    });
  }
  const durations = durationsFor(model, images > 0);
  if (!durations.includes(s.durationSec)) {
    problems.push({
      field: "durationSec",
      message:
        images > 0 && model.images?.durations
          ? `${model.displayName} with product photos renders ${durations.join(", ")}s videos.`
          : `${model.displayName} renders ${durations[0]}–${durations[durations.length - 1]}s videos.`,
    });
  }
  return problems;
}

/** Snap settings to the nearest valid combination (used when switching model or platform). */
export function coerceRenderSettings(model: UgcModel, s: RenderSettings): RenderSettings {
  const images = usableImageCount(model, s.imageCount);
  const durations = durationsFor(model, images > 0);
  const durationSec = durations.includes(s.durationSec)
    ? s.durationSec
    : durations.reduce((best, d) =>
        Math.abs(d - s.durationSec) < Math.abs(best - s.durationSec) ? d : best,
      );
  return {
    model: model.key,
    durationSec,
    aspectRatio: model.aspectRatios.includes(s.aspectRatio) ? s.aspectRatio : model.aspectRatios[0],
    resolution: model.resolutions.includes(s.resolution) ? s.resolution : model.defaultResolution,
    imageCount: s.imageCount,
  };
}

/** Kie credits for a render, from a price table (registry defaults or overrides). */
export function renderCredits(
  pricing: UgcModel["pricing"],
  resolution: UgcResolution,
  durationSec: number,
): number | null {
  const unit = pricing.credits[resolution];
  if (unit == null) return null;
  return pricing.unit === "video" ? unit : Math.round(unit * durationSec * 100) / 100;
}
