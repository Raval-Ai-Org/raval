// The image prompt for a product hero poster (ADR-0040). Pure.
//
// The first reference is the real product, cut out of its photo. The model
// builds a designed, lit scene around it and may relight and touch it with
// the scene's light and liquid, but the product's shape, colours and every
// word on its label stay as they are. It is never a photo in a frame.
import { CRAFT_RULES } from "../art-direction";
import { qualityCheckLines, TYPE_SYSTEM, verbatimTextBlock } from "../creative-knowledge";
import { paletteLines, type ProductPalette } from "./palette";
import type { Staging } from "./stagings";
import { lightById, setById, type HeroLook, type Occasion } from "./variety";

export type ProductHeroCopy = {
  headline?: string | null;
  support?: string | null;
  benefits?: readonly string[];
};

export type ProductHeroPromptInput = {
  staging: Staging;
  palette: ProductPalette;
  productName: string;
  texture: string | null;
  /** Ingredients the product's facts name (the ingredient staging shows them). */
  ingredients?: readonly string[];
  copy: ProductHeroCopy;
  /** This poster's light, set and own idea (variety.ts, concept.ts). */
  look?: Partial<HeroLook> | null;
  occasion?: Occasion | null;
  /** False when the brand's look allows no words on pictures. */
  allowText: boolean;
  /** True: the first reference is a clean cut-out. False: the original photo. */
  cutout: boolean;
  /** The product runs off its photo's edge: show it entering from the frame, never completed. */
  cropped?: boolean;
  /** The original photo follows the cut-out, as the truth for the label's words. */
  original?: boolean;
  /** Earlier hero posts of this brand follow the product reference. */
  series: boolean;
  brandName: string;
  brandContext?: string | null;
  lookBlock?: string | null;
  fonts?: readonly string[];
  /** The team's own picture rules: one block of text or a list. */
  visualTasteRules?: string | readonly string[] | null;
  logoCorner?: string | null;
  revision?: string | null;
  novelty?: string | null;
  emphasisSeed?: string;
};

/** The lines the poster may set, in order, empty ones left out. */
export function heroCopyLines(copy: ProductHeroCopy, staging: Staging) {
  const lines: { label: string; text: string }[] = [];
  if (copy.headline?.trim()) lines.push({ label: "Headline", text: copy.headline });
  if (staging.id === "benefit-column")
    (copy.benefits ?? []).forEach((text, i) => lines.push({ label: `Benefit ${i + 1}`, text }));
  else if (
    copy.support?.trim() &&
    ["macro-crop", "texture-burst", "ingredient-world"].includes(staging.id)
  )
    lines.push({ label: "Support line", text: copy.support });
  return lines;
}

export const HERO_NEVER: readonly string[] = [
  "The product is never shown as a flat photo: never inside a frame, card, box, window, circle, rounded panel, polaroid or screen, never as a picture-in-picture, never with the original photo's background around it.",
  "Only this product, once (or exactly the products the reference shows, each once). No other products, no invented variants.",
  "No people, hands or faces.",
  "No clip-art, doodles, outline icons in the corners, leaves, flowers, droppers, flames or props that neither the staging, the occasion nor this poster's idea names.",
  "No logo, wordmark or brand name set as separate type; the product's own label is the only branding besides the exact copy.",
  "No prices, badges, stars, review counts, quotes, percentages or claims unless they are in the exact copy.",
];

export function productHeroPrompt(input: ProductHeroPromptInput): string {
  const { staging } = input;
  const product = `the product (${input.productName.replace(/\s+/g, " ").trim().slice(0, 80)})`;
  const copy = input.allowText ? heroCopyLines(input.copy, staging) : [];
  const hasText = copy.length > 0;
  const light = lightById(input.look?.light);
  const set = input.look?.set ? setById(staging.id, input.look.set) : null;
  return [
    `Design a finished, premium social media poster for ${input.brandName}: a cinematic product hero shot, the kind a top beauty, food or lifestyle brand shoots in a studio for its own feed.`,
    "",
    "THE PRODUCT — the first reference image:",
    input.cutout
      ? `• It is the real ${input.productName}, already cut out on transparency.`
      : `• It is a photo of the real ${input.productName}. Use only the product from it; leave out everything else in that photo (its background, surface, hands, props and any other items).`,
    "• Place this exact product into a new, fully designed scene as its hero. Keep its true shape, proportions, colours, materials, cap and closure, and every word, number and logo on its label exactly as in the reference: same spelling, same layout, sharp and readable.",
    "• You may relight it, turn it a little, and let the scene's light, water or texture touch it. Never redraw it as a different product, never simplify or blank its label.",
    "• It must belong to the scene: real contact shadow, reflections and the same light direction as everything around it.",
    input.cutout && input.original
      ? "• The second reference image is the original photo the product was cut from. Where a word on the label is unclear or differs on the cut-out, the original photo is right; never copy anything else from it (its background, props or layout)."
      : "",
    input.cropped
      ? "• The reference shows only part of the product, cut off by its photo's edge. Show it the same way, entering from the edge of the frame and cropped there; never draw or guess the missing part or its lettering."
      : "",
    input.series
      ? "• The remaining reference images are this brand's earlier product posts: keep the same colour handling, type and finish so the posts read as one series. Never copy their products, words or exact layout."
      : "",
    "",
    `STAGING — "${staging.name}":`,
    `• Scene: ${staging.scene(product, input.texture, input.ingredients)}`,
    set ? `• Set: ${set.text}.` : "",
    input.look?.concept
      ? `• This poster's own idea (build exactly this, inside the staging): ${input.look.concept}`
      : "",
    `• Placement: ${staging.placement}`,
    `• Typography: ${hasText ? staging.type : staging.typeWithoutText}`,
    `• Light and camera: ${staging.light}${light ? ` Mood: ${light.text}.` : ""}`,
    `• Finish: ${staging.finish}`,
    `• Avoid: ${staging.avoid}.`,
    input.occasion
      ? `\nOCCASION — ${input.occasion.mood}. The only extra touches allowed: ${input.occasion.touches}.`
      : "",
    "",
    ...paletteLines(input.palette),
    input.lookBlock
      ? `\nBRAND LOOK (colours, type and finish follow it where it is specific):\n${input.lookBlock}`
      : "",
    input.fonts?.length
      ? `Fonts: ${input.fonts.slice(0, 2).join(", ")}, or the closest match.`
      : "",
    "",
    ...(hasText
      ? [
          ...verbatimTextBlock({ lines: copy, emphasisSeed: input.emphasisSeed }),
          ...TYPE_SYSTEM.map((rule) => `• ${rule}`),
        ]
      : ["TEXT: none. No letters anywhere except what is printed on the product itself."]),
    "",
    "NEVER:",
    ...HERO_NEVER.map((rule) => `• ${rule}`),
    input.logoCorner
      ? `• The real logo is placed afterwards in the ${input.logoCorner} corner: keep that corner calm and empty.`
      : "",
    "",
    "CRAFT:",
    ...CRAFT_RULES.map((rule) => `• ${rule}`),
    input.visualTasteRules?.length
      ? `\nThe team's own rules for pictures:\n${
          typeof input.visualTasteRules === "string"
            ? input.visualTasteRules
            : input.visualTasteRules.map((r) => `• ${r}`).join("\n")
        }`
      : "",
    input.revision ? `\n${input.revision}` : "",
    input.novelty ? `\n${input.novelty}` : "",
    input.brandContext
      ? `\nAbout the brand and the product (context only, never set as text):\n${input.brandContext.slice(0, 1800)}`
      : "",
    "",
    ...qualityCheckLines({ hasText, hasProduct: true }),
    "• The product is big, sharp and real; its label reads exactly as in the reference; it is not in a frame or card.",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/** The prompt that cuts the product out of its photo. */
export function cutoutPrompt(productName: string): string {
  return [
    `Cut out the product (${productName.replace(/\s+/g, " ").trim().slice(0, 80)}) from this photo onto a fully transparent background.`,
    "Keep only the product itself, or the products when the photo shows several packs of the range. Remove everything else: background, surface, shadows, reflections, hands, people, props, bags and decorations.",
    "Keep the product exactly as photographed: the same shape, proportions, colours, materials, angle and every word, number and logo on its label, sharp and readable. Do not redraw, restyle, relight or tidy it.",
    "Clean, crisp edges with no glow, halo, shadow or fringe of the old background: every pixel that isn't the product is fully transparent. Centre it with a little empty space around it.",
  ].join("\n");
}
