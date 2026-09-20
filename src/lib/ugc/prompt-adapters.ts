import type { UgcModel } from "./models";
import { buildVideoPrompt, type PromptInput } from "./prompt";

function withDirection(base: string, direction: string): string {
  return `${base}\n\nMODEL DIRECTION: ${direction}`.slice(0, 8000);
}

export function seedancePromptAdapter(input: PromptInput): string {
  return withDirection(
    buildVideoPrompt(input),
    "Prioritize a strong first-second hook, faithful reference-product geometry, clear social composition and efficient, controlled creative motion. Keep the subject stable between beats.",
  );
}

export function veoPromptAdapter(input: PromptInput): string {
  return withDirection(
    buildVideoPrompt(input),
    "Prioritize photorealistic human performance, natural eye lines, believable skin and fabric, accurate quoted dialogue, clean lip sync and natural room audio. Preserve identity and product details across the full take.",
  );
}

export function klingPromptAdapter(input: PromptInput): string {
  return withDirection(
    buildVideoPrompt(input),
    "Treat the beat sheet as a connected shot plan. Prioritize deliberate camera movement, physical continuity, readable transitions between shots, consistent subjects and product geometry, and cinematic but purposeful composition.",
  );
}

export function grokPromptAdapter(input: PromptInput): string {
  return withDirection(
    buildVideoPrompt(input),
    "Keep the animation simple and visually legible. Preserve the supplied image as the exact first frame, add one clear motion idea, avoid new objects, and optimize for quick creative iteration rather than complex storytelling.",
  );
}

export function buildModelPrompt(input: PromptInput): string {
  switch (input.model.family) {
    case "veo":
      return veoPromptAdapter(input);
    case "kling":
      return klingPromptAdapter(input);
    case "grok":
      return grokPromptAdapter(input);
    case "seedance":
    default:
      return seedancePromptAdapter(input);
  }
}
