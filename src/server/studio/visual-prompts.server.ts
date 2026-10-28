import "server-only";
import type { CarouselSlide, CarouselSpecOutput } from "@/lib/studio/jobs";
import type { StoryFrame } from "@/lib/stories/frames";
import type { ImageStyleInput } from "@/lib/post-image";
import { onImageCopyLines, type AdFormat, type AdOnImage } from "@/lib/studio/ad-formats";
import { productFidelity } from "@/lib/products/catalog";

type Common = {
  index: number;
  spec?: CarouselSpecOutput;
  brandName: string;
  brandContext: string;
  visualTasteRules?: string;
  ratio?: string;
  style: ImageStyleInput | null;
  revision?: string;
  novelty?: string;
  /** The real product's fidelity rule (productFidelity), when a product is attached. */
  productNote?: string;
};

function visualSystem(args: Common): string {
  const theme = args.spec?.theme;
  return [
    `Create a finished, publishable social media artwork for ${args.brandName}. This entire frame must be created by the image generation model.`,
    "Act as a senior art director. Make an intentional, polished composition with hierarchy, rhythm, negative space and a strong focal point. Avoid generic AI marketing imagery, random gradients, plastic 3D objects and stock-photo clichés.",
    "The series shares one coherent visual language, while each frame has a distinct composition and focal image. Preserve the identity visible in reference images; do not copy their exact composition.",
    theme
      ? `Visual identity: background ${theme.bg}, ink ${theme.ink}, accent ${theme.accent}; heading style ${theme.headingFont}, body style ${theme.bodyFont}. Use these as art direction, not as a flat template.`
      : "",
    args.spec?.design
      ? `Series direction: ${args.spec.design.look} editorial feeling, ${args.spec.design.colorway} colorway, recurring ${args.spec.design.motif} motif interpreted naturally.`
      : "",
    args.style ? `Approved style: ${args.style.block.slice(0, 2000)}` : "",
    args.style?.composition ? `Composition grammar: ${args.style.composition}` : "",
    args.style?.mood ? `Mood and finish: ${args.style.mood}` : "",
    args.style?.references?.count
      ? `Use the ${args.style.references.count} attached visual reference(s) with ${args.style.references.strength} fidelity to the visual language.`
      : "",
    args.brandContext ? `Verified brand context: ${args.brandContext.slice(0, 1100)}` : "",
    args.productNote
      ? `${args.productNote} Show it wherever this frame's visual direction involves the product, and always on the first frame; it must look identical in every frame where it appears.`
      : "",
    args.visualTasteRules,
    args.revision,
    args.novelty,
    "All type must be accurately spelled and legible at phone size. No invented claims, URLs, logos, testimonials, product features or people. No watermark. Respect generous platform safe margins.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function carouselSlidePrompt(
  args: Common & { slide: CarouselSlide; slides: CarouselSlide[] },
): string {
  const slide = args.slide;
  return [
    visualSystem(args),
    `Carousel slide ${args.index + 1} of ${args.slides.length}. Render as one complete ${args.ratio ?? "4:5"} social post frame, with final typography inside the image.`,
    `This slide's job: ${slide.role ?? "point"}. ${args.index === 0 ? "This is the cover: create a striking hook." : args.index === args.slides.length - 1 ? "This is the closing slide: make the next action obvious." : "Advance the narrative with a fresh composition."}`,
    `Exact headline to typeset: ${JSON.stringify(slide.heading)}.`,
    slide.kicker ? `Exact small label: ${JSON.stringify(slide.kicker)}.` : "",
    slide.body ? `Exact supporting copy: ${JSON.stringify(slide.body)}.` : "",
    slide.visual ? `Visual direction: ${slide.visual}` : "",
    `Whole series narrative for continuity: ${args.slides.map((s, i) => `${i + 1}. ${s.heading}`).join(" | ")}`,
    `Do not put any other words in the artwork beyond the exact supplied headline, label and supporting copy. If exact long copy cannot fit legibly, prioritize the headline and leave the supporting copy out rather than inventing or mangling text.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * The one background picture of a connected carousel. It carries no words (the
 * slides' text is drawn over it) and is repeated mirrored across the slides,
 * so it must have no single subject and no edge that stands out.
 */
export function carouselBackdropPrompt(
  args: Omit<Common, "index"> & { slides: CarouselSlide[]; title?: string },
): string {
  const theme = args.spec?.theme;
  return [
    `Create a wide 16:9 background artwork for ${args.brandName}. It will sit behind text across a whole social media carousel, so it is atmosphere, not an illustration of one thing.`,
    "Act as a senior art director. One continuous abstract or environmental scene that flows evenly from the left edge to the right edge: soft light, depth, texture, gentle movement. No single focal subject, no centre of attention, nothing important near any edge. Even density and brightness across the whole width.",
    theme
      ? `Colour: build the image in tones close to ${theme.bg}, with restrained touches of ${theme.accent}. Low contrast and calm, so ${theme.ink} text stays easy to read on top of it.`
      : "Low contrast and calm, so text stays easy to read on top of it.",
    `What the carousel is about, for mood only: ${[args.title, ...args.slides.map((s) => s.heading)].filter(Boolean).join(" | ").slice(0, 600)}`,
    args.style ? `Approved style: ${args.style.block.slice(0, 1600)}` : "",
    args.style?.mood ? `Mood and finish: ${args.style.mood}` : "",
    args.brandContext ? `Verified brand context: ${args.brandContext.slice(0, 800)}` : "",
    args.visualTasteRules,
    args.revision,
    args.novelty,
    "Absolutely no text, letters, numbers, logos, watermarks, people, faces, hands, products, frames, borders or panels. Avoid generic AI marketing imagery, plastic 3D objects and stock-photo clichés.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function storyFramePrompt(
  args: Common & { frame: StoryFrame; frames: StoryFrame[] },
): string {
  const frame = args.frame;
  return [
    visualSystem(args),
    `Vertical Story frame ${args.index + 1} of ${args.frames.length}. Render as one complete 9:16 image with the final typography integrated in the image.`,
    "Leave the top 15% and bottom 20% clear for native Story controls. Keep all words within the center safe zone.",
    `Frame role: ${frame.role}. Exact headline: ${JSON.stringify(frame.heading)}.`,
    frame.kicker ? `Exact small label: ${JSON.stringify(frame.kicker)}.` : "",
    frame.body ? `Exact supporting copy: ${JSON.stringify(frame.body)}.` : "",
    frame.options?.length
      ? `Exact reply choices to typeset as clear visual options: ${frame.options.map((option) => JSON.stringify(option)).join(", ")}. These are prompts to reply, not interactive poll stickers.`
      : "",
    frame.visual ? `Visual direction: ${frame.visual}` : "",
    `Series narrative: ${args.frames.map((f, i) => `${i + 1}. ${f.heading}`).join(" | ")}`,
    "Do not draw simulated app controls, progress bars or reply boxes. Do not add any extra words.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * A finished, designed static ad in one of the proven layouts (ad-formats.ts):
 * the real product, the exact on-image copy, the brand's colours. Replaces the
 * old text-free "ad visual", which read as a mood photo, not an ad.
 */
export function adImagePrompt(args: {
  format: AdFormat;
  copy: AdOnImage;
  scene: string;
  brandName: string;
  brandContext: string;
  palette: string[];
  fonts: string[];
  ratio: string;
  style: ImageStyleInput | null;
  visualTasteRules?: string;
  /** Which attached image is the product, or none. */
  product?: { name: string; position: number } | null;
  /** The corner kept clear for the real logo, added afterward. */
  logoCorner?: string | null;
  revision?: string;
  novelty?: string;
}): string {
  const vertical = args.ratio === "9:16";
  const lines = onImageCopyLines(args.copy);
  return [
    `Create a finished, ready-to-run paid social ad for ${args.brandName}, ${args.ratio} format. It must look like a top-performing ad made by a professional performance creative team: one clear focal point, an obvious reading order (badge, headline, product, supporting line, button), strong contrast, and every word legible on a phone held at arm's length.`,
    `Layout: ${args.format.layout}`,
    args.scene ? `Scene and subject: ${args.scene}` : "",
    args.product ? productFidelity(args.product.name, args.product.position) : "",
    args.palette.length
      ? `Brand colours, use these and close tints only: ${args.palette.slice(0, 5).join(", ")}. The first is the main colour; use the strongest contrasting one for the button and badge.`
      : "",
    args.fonts.length
      ? `Typography: clean, confident type in the spirit of ${args.fonts.slice(0, 2).join(" and ")}; a heavy weight for the headline, regular for the rest. Never more than two typefaces.`
      : "Typography: one clean, confident sans-serif; heavy weight for the headline, regular for the rest.",
    args.style ? `Approved brand style: ${args.style.block.slice(0, 1600)}` : "",
    args.style?.mood ? `Mood and finish: ${args.style.mood}` : "",
    args.brandContext ? `Verified brand context: ${args.brandContext.slice(0, 900)}` : "",
    args.visualTasteRules,
    lines.length
      ? [
          "Typeset exactly these words, spelled exactly as given, and no other words anywhere in the ad:",
          ...lines,
          "If a line cannot fit cleanly, leave it out rather than shrinking it until it is unreadable or changing its words.",
        ].join("\n")
      : "No words in the image.",
    `Keep all text at least 6% away from every edge${vertical ? ", and keep the top 14% and bottom 20% free of text for the platform's own buttons" : ""}.`,
    args.logoCorner
      ? `Leave the ${args.logoCorner} corner clear (about 16% of the width): the brand's real logo is placed there afterward. Do not draw any logo.`
      : "Do not draw a logo.",
    args.revision,
    args.novelty,
    "Never: invented claims, prices, discounts, ratings, reviews or people's names; another brand's logo or product; fake app screens, status bars or social media buttons; watermarks; gibberish text.",
  ]
    .filter(Boolean)
    .join("\n\n");
}
