import type { Brief, Product, Script } from "./schemas";
import type { UgcModelKey } from "./models";

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
  const premiumHuman =
    input.script.scenes.some((scene) => scene.dialogue.trim().length > 0) ||
    hasAny(text, ["ugc", "talking", "founder", "person", "creator", "dialogue", "lip-sync", "lipsync"]);
  const realism = hasAny(text, ["realistic", "photoreal", "natural audio", "premium commercial", "high-end"]);
  const cinematic = hasAny(text, ["cinematic", "multi-shot", "multi scene", "storytelling", "action", "camera movement", "complex movement"]);
  const variation = input.tier === "variations" || hasAny(text, ["variation", "iterate", "experiment", "cheap", "quick"]);

  if ((premiumHuman || realism) && available.has("veo-3-1-quality")) {
    signals.push("human realism or premium audio/photorealism");
    return { model: "veo-3-1-quality", reason: "Premium realism, human performance and natural audio fit Veo best.", strategy: "shot-plan-ready", signals };
  }
  if (cinematic && available.has("kling-3")) {
    signals.push("complex motion or multi-shot storytelling");
    return { model: "kling-3", reason: "The brief needs controlled motion or cinematic multi-shot continuity.", strategy: "shot-plan-ready", signals };
  }
  if (variation && available.has("grok-imagine")) {
    signals.push("rapid low-cost variation");
    return { model: "grok-imagine", reason: "This is a fast iteration task where low cost matters.", strategy: "single-model", signals };
  }
  if (available.has("seedance-2")) {
    signals.push("default social balance of quality, references and cost");
    return { model: "seedance-2", reason: "Seedance is the best balanced default for professional social content.", strategy: "shot-plan-ready", signals };
  }
  return {
    model: enabled[0] ?? "seedance-2",
    reason: "Using the first enabled video model because the preferred route is unavailable.",
    strategy: "single-model",
    signals: ["fallback availability"],
  };
}