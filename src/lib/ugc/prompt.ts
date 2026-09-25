// The UGC production prompt. Deterministic and pure: the same product, brief,
// script and settings always produce the same prompt, so a render can be
// reproduced and the prompt is testable.
//
// Video models follow concrete direction far better than adjectives, so the
// prompt is a shot list: who is on camera, where, how it is filmed, a
// timestamped beat sheet with the exact quoted dialogue, how the product must
// look, and hard restrictions. Captions are never rendered into the video —
// models garble on-screen text — they are returned separately for editing.
import type { UgcAspectRatio, UgcModel } from "./models";
import {
  CREATOR_VIBES,
  LANGUAGES,
  SETTINGS,
  labelOf,
  platformPreset,
  type ToneId,
} from "./options";
import type { Brief, Product, Scene, Script } from "./schemas";

/** Natural conversational speech runs ~2.5 words/s; leave room to breathe. */
export const WORDS_PER_SECOND = 2.3;

export function dialogueWordBudget(durationSec: number): number {
  return Math.max(4, Math.floor(durationSec * WORDS_PER_SECOND));
}

const CHARACTER_LANGUAGES = new Set(["zh", "ja"]);

/** Spoken-length estimate: words, or characters/2 for languages without spaces. */
export function spokenWords(text: string, language = "en"): number {
  const clean = text.replace(/["“”]/g, "").trim();
  if (!clean) return 0;
  if (CHARACTER_LANGUAGES.has(language)) return Math.ceil(clean.replace(/\s+/g, "").length / 2);
  return clean.split(/\s+/).filter(Boolean).length;
}

export function scriptWordCount(script: Pick<Script, "scenes">, language = "en"): number {
  return script.scenes.reduce((n, s) => n + spokenWords(s.dialogue, language), 0);
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Scale scene timings so the beat sheet spans exactly the clip length. */
export function fitScenes(scenes: Scene[], durationSec: number): Scene[] {
  if (!scenes.length) return scenes;
  const sorted = [...scenes].sort((a, b) => a.start - b.start);
  const span = Math.max(...sorted.map((s) => s.end), 0.1);
  const factor = durationSec / span;
  return sorted.map((s, i) => {
    const start = i === 0 ? 0 : round1(s.start * factor);
    const end =
      i === sorted.length - 1 ? durationSec : round1(Math.max(s.end * factor, start + 0.5));
    return { ...s, start, end };
  });
}

const TONE_DIRECTION: Record<ToneId, string> = {
  authentic:
    "genuine and unpolished, like a real customer filming on their phone, small natural pauses and imperfections",
  energetic: "upbeat and quick, animated expressions and gestures, fast natural pacing",
  professional: "composed and credible, steady framing and clean light, still personal and direct",
  emotional: "sincere and heartfelt, softer delivery, visible genuine reaction",
  funny: "light and playful with natural comic timing, never slapstick",
  bold: "confident and direct, strong eye contact with the lens",
  minimal: "calm and understated, few words, the product does the talking",
};

const CAMERA_BY_TONE: Record<ToneId, string> = {
  authentic: "handheld smartphone front camera at arm's length, slight natural shake",
  energetic: "handheld smartphone, quick natural reframes as the creator moves",
  professional: "smartphone on a small tripod at eye level, mostly steady",
  emotional: "handheld smartphone close to the face, gentle movement",
  funny: "handheld smartphone, casual framing",
  bold: "smartphone at eye level, close framing, direct to lens",
  minimal: "steady smartphone framing, slow deliberate movement",
};

function aspectPhrase(ratio: UgcAspectRatio): string {
  switch (ratio) {
    case "9:16":
      return "vertical 9:16";
    case "16:9":
      return "horizontal 16:9";
    case "1:1":
      return "square 1:1";
    case "4:3":
      return "4:3";
    case "3:4":
      return "vertical 3:4";
  }
}

function creatorPhrase(brief: Brief): string {
  const who =
    brief.creator.gender === "woman" ? "woman" : brief.creator.gender === "man" ? "man" : "person";
  const age = brief.creator.age === "any" ? "" : ` aged ${brief.creator.age.replace("-", " to ")}`;
  const vibe =
    CREATOR_VIBES.find((v) => v.id === brief.creator.vibe)?.prompt ?? "warm and approachable";
  const audience = brief.audience
    ? `, someone the target audience (${brief.audience}) relates to`
    : "";
  return `One everyday content creator: a ${who}${age}, ${vibe}${audience}. Natural look, real skin texture, casual clothing. The same person throughout.`;
}

function settingPhrase(brief: Brief, product: Product): string {
  const chosen = SETTINGS.find((s) => s.id === brief.creator.setting)?.prompt;
  if (chosen)
    return `${chosen[0].toUpperCase()}${chosen.slice(1)}, lived-in and realistic, natural window light.`;
  const useCase = product.useCases[0];
  return useCase
    ? `A realistic everyday place where someone would ${useCase.replace(/\.$/, "").toLowerCase()}, natural light.`
    : "A realistic, lived-in everyday home setting with natural window light.";
}

export type PromptInput = {
  product: Product;
  brief: Brief;
  script: Script;
  model: UgcModel;
  durationSec: number;
  aspectRatio: UgcAspectRatio;
  /** Images actually sent with the request. */
  imageCount: number;
  /** One line of brand voice from Brand DNA, if any. */
  brandVoice?: string;
  /** Look and pacing from the Brand Kit Style (ugcStyleNotes), if any. */
  styleNotes?: string;
};

export function buildVideoPrompt(input: PromptInput): string {
  const { product, brief, model, durationSec, aspectRatio } = input;
  const language = labelOf(LANGUAGES, brief.language);
  const platform = platformPreset(brief.platform);
  const scenes = fitScenes(input.script.scenes, durationSec);
  const productName = productDisplayName(product);
  const imageMode = input.imageCount > 0 ? model.images?.mode : undefined;

  const factIds = new Set(input.script.factIds);
  const facts = product.facts
    .filter((f) => factIds.size === 0 || factIds.has(f.id))
    .slice(0, 6)
    .map((f) => f.text);

  const lines: string[] = [];
  lines.push(
    `${aspectPhrase(aspectRatio)} ${durationSec}-second user-generated-content (UGC) video ad for ${productName}, filmed as a ${platform.native}.`,
  );
  lines.push("");
  lines.push(`CREATOR: ${creatorPhrase(brief)}`);
  lines.push(`SETTING: ${settingPhrase(brief, product)}`);
  lines.push(
    `CAMERA & LOOK: ${CAMERA_BY_TONE[brief.tone]}. Realistic smartphone footage, true-to-life colour, no cinematic grading, no film look, no slow-motion, no drone or crane shots.`,
  );
  lines.push(`PERFORMANCE: ${TONE_DIRECTION[brief.tone]}.`);
  if (aspectRatio === "9:16" || aspectRatio === "3:4") {
    lines.push(
      "FRAMING: keep the creator's face and the product in the centre of the frame, clear of the top and bottom edges where the app's buttons and captions sit.",
    );
  }
  lines.push("");

  const productLine = [
    `PRODUCT: ${productName}${product.category ? ` (${product.category})` : ""}.`,
  ];
  if (imageMode === "references") {
    productLine.push(
      "It must look exactly like the product in the reference image(s): same shape, colours, materials, label and packaging design. Do not redesign, recolour or add parts.",
    );
  } else if (imageMode === "first_frame") {
    productLine.push(
      "The video opens on the provided product image; keep the product identical to that image for the whole video.",
    );
  } else if (product.description) {
    productLine.push(`What it is: ${truncate(product.description, 240)}`);
  }
  productLine.push(
    "Show the product clearly, in focus and well lit, held naturally in hand or in use. It is the only branded product in the video.",
    "Hands look natural, and the product keeps the same size, shape and label in every shot: it never morphs, melts, duplicates or changes colour.",
  );
  lines.push(productLine.join(" "));
  if (facts.length)
    lines.push(`TRUE PRODUCT FACTS (only these may be claimed): ${facts.join("; ")}.`);
  if (input.brandVoice) lines.push(`BRAND VOICE: ${truncate(input.brandVoice, 200)}.`);
  if (input.styleNotes) lines.push(`BRAND LOOK: ${truncate(input.styleNotes, 400)}.`);
  lines.push("");

  lines.push("BEAT SHEET:");
  scenes.forEach((scene, i) => {
    const label = i === 0 ? "HOOK" : i === scenes.length - 1 ? "CALL TO ACTION" : "BEAT";
    const parts = [`[${fmt(scene.start)}–${fmt(scene.end)}s] ${label}:`];
    if (scene.shot) parts.push(sentence(scene.shot));
    if (scene.action) parts.push(sentence(scene.action));
    if (scene.productPlacement) parts.push(`Product: ${sentence(scene.productPlacement)}`);
    if (scene.dialogue.trim()) {
      parts.push(`The creator says: "${scene.dialogue.trim().replace(/"/g, "'")}"`);
    } else {
      parts.push("No speech in this beat.");
    }
    lines.push(parts.join(" "));
  });
  if (scenes.length && scenes[0].start === 0) {
    lines.push(
      "The hook must land in the first 1.5 seconds: the creator starts talking or the key moment happens immediately, no intro, no logo.",
    );
  }
  lines.push("");

  if (model.spokenDialogue) {
    lines.push(
      `AUDIO: The creator speaks only the quoted lines, in ${language}, word for word, in a natural conversational voice with accurate lip sync — not a voice-over, not robotic, not announcer-style. Light natural room sound. No background music, no sound effects over the speech.`,
    );
  }
  const restrictions = [
    "no on-screen text, captions, subtitles, titles, stickers or watermarks",
    "no logos except those printed on the product itself",
    "no other brands or competitor products",
    "no invented features, results, prices or statistics",
    "no split screens or transitions between different people",
  ];
  if (brief.instructions) lines.push(`CREATIVE NOTES: ${truncate(brief.instructions, 400)}`);
  lines.push(`DO NOT INCLUDE: ${restrictions.join("; ")}.`);

  return lines.join("\n").slice(0, 8000);
}

function fmt(n: number) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function sentence(text: string) {
  const t = text.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

function truncate(text: string, max: number) {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/** "Brand Name" without repeating a brand the product name already starts with. */
export function productDisplayName(product: Pick<Product, "brand" | "name">): string {
  const brand = product.brand.trim();
  const name = product.name.trim();
  if (!brand || name.toLowerCase().startsWith(brand.toLowerCase())) return name;
  return `${brand} ${name}`;
}
