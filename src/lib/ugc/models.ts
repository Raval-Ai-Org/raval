// UGC video model registry. Pure data — shared by the studio UI (which only
// offers what a model can really do) and the server (which validates every
// render against the same entry and builds the provider request from it).
//
// Each key describes one creative purpose and how two providers serve it:
//   kie        — Kie.ai Market API (temporary; removed when KIE is dropped)
//   openrouter — OpenRouter's video API (POST /api/v1/videos)
// The top-level capability fields are the KIE view (today's default
// provider); `specFor(model, provider)` gives the view for the provider that
// will actually run a job, and the server validates against that.
//
// Capabilities were confirmed on 2026-09-25 from OpenRouter's
// /api/v1/videos/models and docs.kie.ai (Gemini Omni 1.1 Flash, MiniMax H3);
// the Veo/Seedance/Grok KIE values were confirmed by live createTask on
// 2026-09-16. Prices are defaults: KIE credits (1 credit = KIE_USD_PER_CREDIT)
// or OpenRouter USD, all overridable without a deploy (src/server/ugc/models.server.ts).
// The provider's own reported cost on the finished task is what is metered.

export type UgcAspectRatio = "9:16" | "1:1" | "16:9" | "4:3" | "3:4";
export type UgcResolution = "480p" | "720p" | "768p" | "1080p" | "2k";
export type VideoProviderId = "kie" | "openrouter";

export type UgcModelKey = "standard" | "draft" | "premium" | "long" | "cinematic" | "variation";

/** Keys from before 2026-09-25. Existing jobs and history keep them; new jobs never do. */
export type LegacyUgcModelKey =
  | "veo-3-1-fast"
  | "veo-3-1-quality"
  | "veo-3-1-lite"
  | "seedance-2"
  | "seedance-2-fast"
  | "kling-3"
  | "grok-imagine";

export type AnyUgcModelKey = UgcModelKey | LegacyUgcModelKey;

/**
 * How product images reach the model:
 *   references  — the model keeps the product consistent from 1–N images
 *   first_frame — the image opens the video (image-to-video); the product
 *                 is shown exactly, then comes alive
 */
export type ReferenceMode = "references" | "first_frame";

/** Per resolution: price per video or per second. */
export type UgcPricing =
  | {
      unit: "video" | "second";
      currency: "credits";
      amounts: Partial<Record<UgcResolution, number>>;
    }
  | { unit: "video" | "second"; currency: "usd"; amounts: Partial<Record<UgcResolution, number>> };

export type ProviderVideoSpec = {
  /** The provider's model id. */
  model: string;
  /** Kie `input.model` tier for Veo 3.1 (veo3 | veo3_fast | veo3_lite). */
  variant?: string;
  /** KIE only: the model id used when no image is attached (e.g. MiniMax H3 text-to-video). */
  textModel?: string;
  /** KIE only: the model id used with exactly one first-frame image. */
  firstFrameModel?: string;
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
  pricing: UgcPricing;
};

export type UgcModel = {
  key: AnyUgcModelKey;
  /** Prompt adapter family (src/lib/ugc/prompt-adapters.ts). */
  family: "veo" | "seedance" | "gemini" | "minimax" | "kling" | "grok";
  displayName: string;
  tier: "draft" | "standard" | "premium";
  description: string;
  providers: Partial<Record<VideoProviderId, ProviderVideoSpec>>;
  /** The provider these top-level fields describe. */
  provider: VideoProviderId;
  providerModel: string;
  providerVariant?: string;
  durations: number[];
  aspectRatios: UgcAspectRatio[];
  resolutions: UgcResolution[];
  defaultResolution: UgcResolution;
  nativeAudio: boolean;
  spokenDialogue: boolean;
  images: ProviderVideoSpec["images"];
  pricing: UgcPricing;
  enabledByDefault: boolean;
  /** A pre-2026-09-25 key: resolves and renders, never offered for new jobs. */
  legacy?: { aliasOf: UgcModelKey };
};

const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

const credits = (unit: "video" | "second", amounts: UgcPricing["amounts"]): UgcPricing => ({
  unit,
  currency: "credits",
  amounts,
});
const usd = (unit: "video" | "second", amounts: UgcPricing["amounts"]): UgcPricing => ({
  unit,
  currency: "usd",
  amounts,
});

type Entry = Omit<
  UgcModel,
  | "provider"
  | "providerModel"
  | "providerVariant"
  | "durations"
  | "aspectRatios"
  | "resolutions"
  | "defaultResolution"
  | "nativeAudio"
  | "spokenDialogue"
  | "images"
  | "pricing"
>;

/** Flatten a provider's spec into the model's top-level capability fields. */
function view(entry: Entry, provider: VideoProviderId): UgcModel {
  const spec = entry.providers[provider] ?? entry.providers.kie ?? entry.providers.openrouter;
  if (!spec) throw new Error(`${entry.key} has no provider spec`);
  return {
    ...entry,
    provider: entry.providers[provider] ? provider : entry.providers.kie ? "kie" : "openrouter",
    providerModel: spec.model,
    providerVariant: spec.variant,
    durations: spec.durations,
    aspectRatios: spec.aspectRatios,
    resolutions: spec.resolutions,
    defaultResolution: spec.defaultResolution,
    nativeAudio: spec.nativeAudio,
    spokenDialogue: spec.spokenDialogue,
    images: spec.images,
    pricing: spec.pricing,
  };
}

// ─── OpenRouter specs (from /api/v1/videos/models) ───
const OR_VEO_FAST: ProviderVideoSpec = {
  model: "google/veo-3.1-fast",
  durations: [4, 6, 8],
  aspectRatios: ["9:16", "16:9"],
  resolutions: ["720p", "1080p"],
  defaultResolution: "720p",
  nativeAudio: true,
  spokenDialogue: true,
  images: { mode: "first_frame", max: 1 },
  // duration_seconds_with_audio_720p 0.10, with_audio (1080p) 0.12.
  pricing: usd("second", { "720p": 0.1, "1080p": 0.12 }),
};
const OR_VEO_LITE: ProviderVideoSpec = {
  ...OR_VEO_FAST,
  model: "google/veo-3.1-lite",
  pricing: usd("second", { "720p": 0.05, "1080p": 0.08 }),
};
const OR_HAILUO_3: ProviderVideoSpec = {
  model: "minimax/hailuo-3",
  durations: range(5, 15),
  aspectRatios: ["9:16", "1:1", "16:9", "4:3", "3:4"],
  resolutions: ["2k"],
  defaultResolution: "2k",
  nativeAudio: true,
  spokenDialogue: true,
  // Reference images are billed per image (reference_images SKU).
  images: { mode: "references", max: 4 },
  pricing: usd("second", { "2k": 0.13 }),
};
const OR_SEEDANCE_FAST: ProviderVideoSpec = {
  model: "bytedance/seedance-2.0-fast",
  durations: range(4, 15),
  aspectRatios: ["9:16", "1:1", "16:9", "4:3", "3:4"],
  resolutions: ["480p", "720p"],
  defaultResolution: "720p",
  nativeAudio: true,
  spokenDialogue: true,
  images: { mode: "first_frame", max: 1 },
  // Billed per video token ($4.2/M); ≈ these per-second figures at 24 fps.
  pricing: usd("second", { "480p": 0.04, "720p": 0.091 }),
};
const OR_GROK_VIDEO: ProviderVideoSpec = {
  model: "x-ai/grok-imagine-video-1.5",
  durations: range(1, 15),
  aspectRatios: ["9:16", "1:1", "16:9", "4:3", "3:4"],
  resolutions: ["480p", "720p", "1080p"],
  defaultResolution: "720p",
  nativeAudio: false,
  spokenDialogue: false,
  images: { mode: "first_frame", max: 1 },
  pricing: usd("second", { "480p": 0.08, "720p": 0.14, "1080p": 0.25 }),
};

// ─── KIE specs ───
const KIE_VEO_FAST: ProviderVideoSpec = {
  model: "veo-3-1",
  variant: "veo3_fast",
  durations: [4, 6, 8],
  aspectRatios: ["9:16", "16:9"],
  resolutions: ["720p", "1080p"],
  defaultResolution: "720p",
  nativeAudio: true,
  spokenDialogue: true,
  images: { mode: "references", max: 3, durations: [8] },
  // Kie: Fast 720p 60, 1080p 65 credits per video.
  pricing: credits("video", { "720p": 60, "1080p": 65 }),
};
const KIE_VEO_LITE: ProviderVideoSpec = {
  ...KIE_VEO_FAST,
  variant: "veo3_lite",
  pricing: credits("video", { "720p": 30, "1080p": 35 }),
};
const KIE_SEEDANCE_FAST: ProviderVideoSpec = {
  model: "bytedance/seedance-2-fast",
  durations: range(4, 15),
  aspectRatios: ["9:16", "1:1", "16:9", "4:3", "3:4"],
  resolutions: ["480p", "720p"],
  defaultResolution: "720p",
  nativeAudio: true,
  spokenDialogue: true,
  images: { mode: "references", max: 9 },
  pricing: credits("second", { "480p": 11.7, "720p": 24.8 }),
};
const KIE_GROK_I2V: ProviderVideoSpec = {
  model: "grok-imagine/image-to-video",
  durations: [5, 10],
  aspectRatios: ["9:16", "1:1", "16:9"],
  resolutions: ["480p", "720p"],
  defaultResolution: "720p",
  nativeAudio: false,
  spokenDialogue: false,
  images: { mode: "first_frame", max: 1 },
  pricing: credits("video", { "480p": 12, "720p": 24 }),
};

const ENTRIES: Record<UgcModelKey, Entry> = {
  standard: {
    key: "standard",
    family: "veo",
    displayName: "Standard",
    tier: "standard",
    description:
      "Realistic creators with lip-synced speech and your product in the shot. The best value for UGC ads.",
    providers: { kie: KIE_VEO_FAST, openrouter: OR_VEO_FAST },
    enabledByDefault: true,
  },
  draft: {
    key: "draft",
    family: "veo",
    displayName: "Draft",
    tier: "draft",
    description: "Quick, low-cost drafts to test hooks and concepts before a final render.",
    providers: { kie: KIE_VEO_LITE, openrouter: OR_VEO_LITE },
    enabledByDefault: true,
  },
  premium: {
    key: "premium",
    family: "gemini",
    displayName: "Premium",
    tier: "premium",
    description: "The most realistic people and product shots, for hero ads.",
    providers: {
      kie: {
        model: "google/gemini-omni-flash-1-1",
        durations: [4, 6, 8, 10],
        aspectRatios: ["9:16", "16:9"],
        resolutions: ["720p", "1080p"],
        defaultResolution: "1080p",
        nativeAudio: true,
        spokenDialogue: true,
        // Up to 7 quota units; images use 1 each. A first frame can't be
        // combined with references, so product photos go in as references.
        images: { mode: "references", max: 7 },
        // Verify on kie.ai/pricing (UGC_PRICE_PREMIUM_<RES>_CREDITS).
        pricing: credits("video", { "720p": 120, "1080p": 160 }),
      },
      // Gemini Omni isn't on OpenRouter; MiniMax H3 is the realism tier there.
      openrouter: OR_HAILUO_3,
    },
    enabledByDefault: true,
  },
  long: {
    key: "long",
    family: "seedance",
    displayName: "Long take",
    tier: "standard",
    description:
      "Takes up to 15 seconds, square video, and up to 9 product photos for accurate packaging.",
    providers: { kie: KIE_SEEDANCE_FAST, openrouter: OR_SEEDANCE_FAST },
    enabledByDefault: true,
  },
  cinematic: {
    key: "cinematic",
    family: "minimax",
    displayName: "Cinematic",
    tier: "premium",
    description: "Controlled camera moves and multi-shot storytelling.",
    providers: {
      kie: {
        model: "minimax-h3/reference-to-video",
        textModel: "minimax-h3/text-to-video",
        firstFrameModel: "minimax-h3/image-to-video",
        durations: range(4, 15),
        aspectRatios: ["9:16", "1:1", "16:9", "4:3", "3:4"],
        resolutions: ["768p", "2k"],
        defaultResolution: "768p",
        nativeAudio: true,
        spokenDialogue: true,
        images: { mode: "references", max: 9 },
        // Verify on kie.ai/pricing (UGC_PRICE_CINEMATIC_<RES>_CREDITS).
        pricing: credits("second", { "768p": 20, "2k": 40 }),
      },
      openrouter: OR_HAILUO_3,
    },
    enabledByDefault: true,
  },
  variation: {
    key: "variation",
    family: "grok",
    displayName: "Quick variation",
    tier: "draft",
    description: "Fast, low-cost animation of a product photo for creative variations.",
    providers: { kie: KIE_GROK_I2V, openrouter: OR_GROK_VIDEO },
    enabledByDefault: true,
  },
};

const LEGACY: Record<LegacyUgcModelKey, { aliasOf: UgcModelKey; displayName: string }> = {
  "veo-3-1-fast": { aliasOf: "standard", displayName: "Veo 3.1 Fast" },
  "veo-3-1-quality": { aliasOf: "premium", displayName: "Veo 3.1 Quality" },
  "veo-3-1-lite": { aliasOf: "draft", displayName: "Veo 3.1 Lite" },
  "seedance-2": { aliasOf: "long", displayName: "Seedance 2.0" },
  "seedance-2-fast": { aliasOf: "long", displayName: "Seedance 2.0 Fast" },
  "kling-3": { aliasOf: "cinematic", displayName: "Kling 3.0" },
  "grok-imagine": { aliasOf: "variation", displayName: "Grok Imagine Video" },
};

/** Models offered for new jobs, as their KIE view (see specFor). */
export const UGC_MODELS: Record<UgcModelKey, UgcModel> = Object.fromEntries(
  Object.entries(ENTRIES).map(([k, e]) => [k, view(e, "kie")]),
) as Record<UgcModelKey, UgcModel>;

export const UGC_MODEL_KEYS = Object.keys(ENTRIES) as UgcModelKey[];
export const LEGACY_UGC_MODEL_KEYS = Object.keys(LEGACY) as LegacyUgcModelKey[];
export const DEFAULT_UGC_MODEL: UgcModelKey = "standard";

/** A key a new job may use. */
export function isUgcModelKey(value: unknown): value is UgcModelKey {
  return typeof value === "string" && value in ENTRIES;
}

/** Any key a stored job may carry (new or legacy). */
export function isKnownUgcModelKey(value: unknown): value is AnyUgcModelKey {
  return isUgcModelKey(value) || (typeof value === "string" && value in LEGACY);
}

/** The current key a stored key maps to (itself for a current key). */
export function canonicalModelKey(key: AnyUgcModelKey): UgcModelKey {
  return isUgcModelKey(key) ? key : LEGACY[key].aliasOf;
}

/**
 * The model for any stored key, viewed for `provider`. A legacy key resolves
 * to its current equivalent (so an old queued job still renders) but keeps
 * its own key and name for history.
 */
export function resolveUgcModel(key: AnyUgcModelKey, provider: VideoProviderId = "kie"): UgcModel {
  if (isUgcModelKey(key)) return view(ENTRIES[key], provider);
  const legacy = LEGACY[key];
  const target = view(ENTRIES[legacy.aliasOf], provider);
  return { ...target, key, displayName: legacy.displayName, legacy: { aliasOf: legacy.aliasOf } };
}

/** The model as the given provider runs it (null when that provider can't). */
export function specFor(model: UgcModel, provider: VideoProviderId): UgcModel | null {
  const key = canonicalModelKey(model.key);
  if (!ENTRIES[key].providers[provider]) return null;
  const viewed = view(ENTRIES[key], provider);
  return model.legacy
    ? { ...viewed, key: model.key, displayName: model.displayName, legacy: model.legacy }
    : viewed;
}

/** The raw provider spec (ids and KIE model variants). */
export function providerSpec(model: UgcModel, provider: VideoProviderId): ProviderVideoSpec | null {
  return ENTRIES[canonicalModelKey(model.key)].providers[provider] ?? null;
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
  model: AnyUgcModelKey;
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

/** Snap settings to the nearest valid combination (switching model, platform or provider). */
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

/** The price of a render in the table's own currency (credits or USD). */
export function renderPrice(
  pricing: UgcPricing,
  resolution: UgcResolution,
  durationSec: number,
): number | null {
  const unit = pricing.amounts[resolution];
  if (unit == null) return null;
  return pricing.unit === "video" ? unit : Math.round(unit * durationSec * 10_000) / 10_000;
}

/** Kie credits for a render (null for a USD-priced table or a missing resolution). */
export function renderCredits(
  pricing: UgcPricing,
  resolution: UgcResolution,
  durationSec: number,
): number | null {
  if (pricing.currency !== "credits") return null;
  const unit = pricing.amounts[resolution];
  if (unit == null) return null;
  return pricing.unit === "video" ? unit : Math.round(unit * durationSec * 100) / 100;
}
