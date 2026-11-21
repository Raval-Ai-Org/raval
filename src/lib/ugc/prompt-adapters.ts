import { buildFormatVideoPrompt, formatForRender } from "./formats/prompt";
import { buildVideoPrompt, type PromptInput } from "./prompt";

function withDirection(base: string, direction: string): string {
  return `${base}\n\nMODEL DIRECTION: ${direction}`;
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

export function geminiPromptAdapter(input: PromptInput): string {
  return withDirection(
    buildVideoPrompt(input),
    "Prioritize lifelike people and faithful product detail: natural expressions, accurate quoted dialogue with clean lip sync, true-to-life materials and lighting. Keep the product's shape, label and colours exactly as in the reference photos.",
  );
}

export function minimaxPromptAdapter(input: PromptInput): string {
  return withDirection(
    buildVideoPrompt(input),
    "Treat the beat sheet as a directed shot plan: deliberate, readable camera moves, continuity of subjects and product geometry between shots, and cinematic but purposeful composition.",
  );
}

export function grokPromptAdapter(input: PromptInput): string {
  return withDirection(
    buildVideoPrompt(input),
    "Keep the animation simple and visually legible. Preserve the supplied image as the exact first frame, add one clear motion idea, avoid new objects, and optimize for quick creative iteration rather than complex storytelling.",
  );
}

export function grokVideoPromptAdapter(input: PromptInput): string {
  return withDirection(
    buildVideoPrompt(input),
    "Prioritize real phone footage of a believable person: natural eye lines, accurate quoted dialogue with clean lip sync, natural room sound, and the product's shape, label and colours exactly as in the reference picture. Keep identity and product details the same for the whole take.",
  );
}

export function wanPromptAdapter(input: PromptInput): string {
  return withDirection(
    buildVideoPrompt(input),
    "Keep the exact look of the supplied frame or references: the same art style, line, palette, materials and lighting from the first frame to the last. One clear motion idea per beat, smooth readable timing, no new characters or objects, no morphing of the product, and no words drawn on screen.",
  );
}

/**
 * A library format is a real phone video with real cuts, on every model: the
 * timed shot list is the edit. Families that drift toward a "cinematic" or
 * stylised look are steered back to phone footage.
 */
const FORMAT_DIRECTION =
  "Treat the timed shot list as the edit of a real phone video: make every HARD CUT and SPLIT SCREEN exactly at its time, keep each person's face, hair and clothes identical in every shot, speak the quoted lines exactly with clean lip sync, and keep the true look of phone footage. Never cinematic grading, never advert polish, never a stylised or animated look.";

export function buildModelPrompt(input: PromptInput): string {
  const format = formatForRender(input.brief, input.script);
  // A first-frame animator can't act a scene; it keeps the classic prompt.
  if (format && input.model.family !== "grok")
    return withDirection(buildFormatVideoPrompt(input, format), FORMAT_DIRECTION);
  switch (input.model.family) {
    case "veo":
      return veoPromptAdapter(input);
    case "gemini":
      return geminiPromptAdapter(input);
    case "minimax":
      return minimaxPromptAdapter(input);
    case "kling":
      return klingPromptAdapter(input);
    case "grok":
      return grokPromptAdapter(input);
    case "grok-video":
      return grokVideoPromptAdapter(input);
    case "wan":
      return wanPromptAdapter(input);
    case "seedance":
    default:
      return seedancePromptAdapter(input);
  }
}
