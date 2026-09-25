import type { Brief, Product, Script } from "./schemas";
import { UGC_MODELS, type UgcModelKey } from "./models";

export type VideoGenerationTier = "draft" | "standard" | "premium" | "variations";

export type VideoRouteInput = {
  product: Product;
  brief: Brief;
  script: Script;
  platform: string;
  durationSec: number;
  referenceCount: number;
  brand: Record<string, unknown>;
  requestedModel?: UgcModelKey | "auto";
  tier?: VideoGenerationTier;
};

export type VideoRoute = {
  model: UgcModelKey;
  reason: string;
  strategy: "single-model" | "shot-plan-ready";
  signals: string[];
};

const textOf = (input: VideoRouteInput) =>
  [
    input.brief.instructions,
    input.brief.format,
    input.brief.tone,
    input.script.hook,
    ...input.script.scenes.map((scene) => `${scene.shot} ${scene.action} ${scene.dialogue}`),
  ]
    .join(" ")
    .toLowerCase();

const hasAny = (text: string, words: string[]) => words.some((word) => text.includes(word));

/** Whether a purpose can render a take this long (extra photos are trimmed, not refused). */
function fits(key: UgcModelKey, durationSec: number, referenceCount: number): boolean {
  const model = UGC_MODELS[key];
  const durations =
    referenceCount > 0 && model.images?.durations?.length
      ? model.images.durations
      : model.durations;
  return durationSec <= Math.max(...durations);
}

/**
 * Pick a model for a render:
 *   premium realism or a hero ad          → premium
 *   cinematic / controlled camera motion  → cinematic
 *   fast, cheap variations                → variation
 *   more than 3 product photos or > 8 s   → long
 *   everything else (talking-creator UGC) → standard
 * A pick that can't render the requested length falls through to `long`.
 */
export function routeVideo(input: VideoRouteInput, enabled: readonly UgcModelKey[]): VideoRoute {
  const available = new Set(enabled);
  const requested = input.requestedModel;
  const explicit = requested !== undefined && requested !== "auto";
  if (explicit && available.has(requested)) {
    return {
      model: requested,
      reason: "Using the model selected in Advanced Settings.",
      strategy: "single-model",
      signals: ["explicit model override"],
    };
  }

  const text = textOf(input);
  const signals: string[] = [];
  const realism =
    input.tier === "premium" ||
    hasAny(text, ["realistic", "photoreal", "premium commercial", "high-end", "hero ad", "luxury"]);
  const cinematic = hasAny(text, [
    "cinematic",
    "multi-shot",
    "multi scene",
    "storytelling",
    "action",
    "camera movement",
    "complex movement",
  ]);
  const variation =
    input.tier === "variations" ||
    hasAny(text, ["variation", "iterate", "experiment", "cheap", "quick"]);
  const needsLong = input.referenceCount > 3 || input.durationSec > 8;

  const choose = (
    key: UgcModelKey,
    reason: string,
    signal: string,
    strategy: VideoRoute["strategy"],
  ): VideoRoute | null => {
    if (!available.has(key) || !fits(key, input.durationSec, Math.min(input.referenceCount, 9)))
      return null;
    signals.push(signal);
    return { model: key, reason, strategy, signals };
  };

  return (
    (realism &&
      choose(
        "premium",
        "Premium realism and human performance for a hero ad.",
        "premium realism",
        "shot-plan-ready",
      )) ||
    (cinematic &&
      choose(
        "cinematic",
        "The brief needs controlled motion or cinematic multi-shot continuity.",
        "complex motion or multi-shot storytelling",
        "shot-plan-ready",
      )) ||
    (variation &&
      choose(
        "variation",
        "This is a fast iteration task where low cost matters.",
        "rapid low-cost variation",
        "single-model",
      )) ||
    (needsLong &&
      choose(
        "long",
        "More than 3 product photos or a take longer than 8 seconds.",
        "long take or many product photos",
        "shot-plan-ready",
      )) ||
    choose(
      "standard",
      "Talking-creator UGC with lip-synced dialogue: the best value default.",
      "default social balance of quality and cost",
      "shot-plan-ready",
    ) ||
    choose(
      "long",
      "The standard model can't render this length, so a long-take model is used.",
      "length fallback",
      "shot-plan-ready",
    ) || {
      model: enabled[0] ?? "standard",
      reason: "Using the first enabled video model because the preferred route is unavailable.",
      strategy: "single-model",
      signals: ["fallback availability"],
    }
  );
}
