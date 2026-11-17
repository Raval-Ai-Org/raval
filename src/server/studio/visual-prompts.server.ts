import "server-only";
import type { CarouselSlide, CarouselSpecOutput } from "@/lib/studio/jobs";
import type { StoryFrame } from "@/lib/stories/frames";
import { styleLead, type ImageStyleInput } from "@/lib/post-image";
import { onImageCopyLines, type AdFormat, type AdOnImage } from "@/lib/studio/ad-formats";
import type { DeliverableId } from "@/lib/studio/creative-knowledge";
import type { CarouselStyle, PostStyle } from "@/lib/studio/post-styles";
import type { AdObjective } from "@/lib/studio/ad-objectives";
import {
  archetypeById,
  carouselSeriesRules,
  heroSubject,
  pickArchetype,
  sellsPhysicalProduct,
} from "@/lib/studio/art-direction";
import {
  TYPE_SYSTEM,
  deliverableById,
  deliverablePromptLines,
  detectDeliverable,
  qualityCheckLines,
  verbatimTextBlock,
} from "@/lib/studio/creative-knowledge";

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
  /** Picks the cover's campaign layout; same seed, same layout. */
  seed?: string;
  /** The words are drawn by Mellox afterward; the picture carries none. */
  noText?: boolean;
  /** Carousels: the native carousel style (post-styles.ts) every slide follows. */
  carouselStyle?: CarouselStyle | null;
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
    args.spec?.design && !args.carouselStyle
      ? `Series direction: ${args.spec.design.look} editorial feeling, ${args.spec.design.colorway} colorway, recurring ${args.spec.design.motif} motif interpreted naturally.`
      : "",
    args.style ? `Approved style: ${args.style.block.slice(0, 2000)}` : "",
    args.style?.composition ? `Composition grammar: ${args.style.composition}` : "",
    args.style?.mood ? `Mood and finish: ${args.style.mood}` : "",
    args.style?.references?.count
      ? `Use the ${args.style.references.count} attached visual reference(s) with ${args.style.references.strength} fidelity to the visual language.`
      : "",
    args.brandContext ? `Verified brand context: ${args.brandContext.slice(0, 1100)}` : "",
    args.visualTasteRules,
    args.revision,
    args.novelty,
    "All type must be accurately spelled and legible at phone size. No invented claims, URLs, logos, testimonials, product features or people. No watermark. Respect generous platform safe margins.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function carouselSlidePrompt(
  args: Common & {
    slide: CarouselSlide;
    slides: CarouselSlide[];
    /** Slide 1 is attached as the first reference (ADR-0051). */
    anchoredToCover?: boolean;
  },
): string {
  const slide = args.slide;
  const position =
    args.index === 0 ? "cover" : args.index === args.slides.length - 1 ? "last" : "middle";
  return [
    visualSystem(args),
    `Carousel slide ${args.index + 1} of ${args.slides.length}. Render as one complete ${args.ratio ?? "4:5"} social post frame, with final typography inside the image.`,
    args.anchoredToCover
      ? "The first reference image is slide 1 of this carousel. Keep its grid, margins, headline position, typefaces, type sizes, colour roles, background treatment and recurring motif exactly, so the set reads as one designed piece; give this slide a new composition and its own words. Never copy slide 1's words."
      : "",
    `This slide's job: ${slide.role ?? "point"}. ${args.index === 0 ? "This is the cover: create a striking hook." : args.index === args.slides.length - 1 ? "This is the closing slide: make the next action obvious." : "Advance the narrative with a fresh composition."}`,
    ...(args.carouselStyle
      ? [
          `CAROUSEL STYLE: ${args.carouselStyle.name}. ${args.carouselStyle[position]}`,
          carouselSeriesRules(position)[0],
          carouselSeriesRules(position)[2],
          args.carouselStyle.medium === "photo"
            ? "Photographs must look real: true-to-life materials, natural light and colour, never a 3D render, plastic CGI look or illustration."
            : "",
          "Never surreal scale tricks, floating objects, miniature worlds or visual metaphors: a real, simple, well-made slide.",
        ]
      : [
          carouselSeriesRules(position).join("\n"),
          position === "cover" ? coverArtDirection(args, slide) : "",
        ]),
    verbatimTextBlock({
      lines: [
        { label: "Exact small label", text: slide.kicker ?? "" },
        { label: "Exact headline to typeset", text: slide.heading },
        { label: "Exact supporting copy", text: slide.body },
      ],
      emphasis: slide.emphasis,
      emphasisSeed: args.brandName,
    }).join("\n"),
    TYPE_SYSTEM.join("\n"),
    slide.visual ? `Visual direction: ${slide.visual}` : "",
    // Roles only, never the other slides' words: an image model draws every
    // headline it is shown (the same lesson as Story frames).
    `Where this slide sits (for pacing only, draw none of it): ${args.slides.map((s, i) => (i === args.index ? `${i + 1}. this slide` : `${i + 1}. ${s.role ?? "point"}`)).join(" → ")}.`,
    `Do not put any other words in the artwork beyond the exact supplied headline, label and supporting copy. If exact long copy cannot fit legibly, prioritize the headline and leave the supporting copy out rather than inventing or mangling text.`,
    qualityCheckLines({ hasText: true, hasProduct: sellsPhysicalProduct(args.brandContext) }).join(
      "\n",
    ),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * The cover is staged on one proven campaign layout, unless the brand's own
 * style already fixes the layout.
 */
function coverArtDirection(args: Common, slide: CarouselSlide): string {
  if (args.style?.composition || args.style?.references?.strength === "exact") return "";
  const physical = sellsPhysicalProduct(args.brandContext);
  const deliverable = detectDeliverable({
    text: [slide.kicker, slide.heading, slide.body].filter(Boolean).join("\n"),
    physicalProduct: physical,
  });
  const archetype = pickArchetype({
    brandText: args.brandContext,
    physicalProduct: physical,
    seed: args.seed ?? `${args.brandName}::${slide.heading}`,
    prefer: deliverable.prefer,
  });
  // One condensed layout line, never the full craft list: the cover's words
  // sit on a calm area, never behind the subject (ADR-0051).
  const hero = slide.visual
    ? `the subject named in this slide's visual direction (${slide.visual.slice(0, 160)})`
    : heroSubject({ products: null, physical });
  return [
    ...(deliverable.id === "brand-moment" ? [] : deliverablePromptLines(deliverable)),
    `Cover layout "${archetype.name}": ${archetype.summary}, built around ${hero}. Light: ${archetype.light} Finish: ${archetype.finish} Avoid: ${archetype.avoid}. The headline sits on a calm area of the frame, never hidden behind the subject.${args.style ? " The brand style above still decides colours, fonts and medium." : ""}`,
  ].join("\n");
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
    "Art-direct it like a premium campaign backdrop: a real material and real light (paper grain, frosted glass, soft fabric folds, light falling through haze, brushed metal), never a generic gradient mesh or bokeh wallpaper.",
    "Absolutely no text, letters, numbers, logos, watermarks, people, faces, hands, products, frames, borders or panels. Avoid generic AI marketing imagery, plastic 3D objects and stock-photo clichés.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * How each Story frame is staged, by position. Each frame of a Story is its
 * own post at the network, so frames must not look alike: a fixed, different
 * camera and layout per position keeps three frames from coming back as the
 * same picture three times.
 */
const STORY_FRAME_STAGING = [
  "Staging for this frame: a bold close-up of one subject filling most of the frame, headline large over a calm area of the picture.",
  "Staging for this frame: a wider scene with depth and space around the subject, the headline set in a clean block, a clearly different camera angle and crop from the frame before.",
  "Staging for this frame: a type-led layout on a flat or softly textured colour field from the brand palette, with only a small supporting visual detail, so it reads as the closing frame.",
  "Staging for this frame: an overhead (top-down) arrangement with the headline beside the subject, not over it.",
  "Staging for this frame: a split layout, picture in one half and the words in the other.",
  "Staging for this frame: a macro detail or texture shot with the headline across the middle third.",
  "Staging for this frame: a person-free environment shot of where the brand's work happens, headline at the top of the safe zone.",
] as const;

export function storyFrameStaging(index: number, count: number): string {
  // The last frame of a multi-frame Story is always the type-led close.
  if (count > 1 && index === count - 1) return STORY_FRAME_STAGING[2];
  const order = [0, 1, 3, 4, 5, 6];
  return STORY_FRAME_STAGING[order[index % order.length]];
}

export function storyFramePrompt(
  args: Common & { frame: StoryFrame; frames: StoryFrame[] },
): string {
  const frame = args.frame;
  const count = args.frames.length;
  return [
    visualSystem(args),
    `Vertical Story frame ${args.index + 1} of ${count}. Render as one complete 9:16 image with the final typography integrated in the image.`,
    "Leave the top 15% and bottom 20% clear for native Story controls. Keep all words within the center safe zone.",
    `Frame role: ${frame.role}.`,
    count > 1
      ? `${storyFrameStaging(args.index, count)} This frame is seen on its own, one after the other frames: it must look clearly different from them (composition, camera, scale and colour balance), never a copy or a near-copy, and it never repeats another frame's words.`
      : "",
    verbatimTextBlock({
      lines: [
        { label: "Exact small label", text: frame.kicker ?? "" },
        { label: "Exact headline", text: frame.heading },
        { label: "Exact supporting copy", text: frame.body },
      ],
      emphasis: frame.emphasis,
      emphasisSeed: args.brandName,
    }).join("\n"),
    args.noText ? "" : TYPE_SYSTEM.join("\n"),
    frame.options?.length
      ? `Exact reply choices to typeset as clear visual options: ${frame.options.map((option) => JSON.stringify(option)).join(", ")}. These are prompts to reply, not interactive poll stickers.`
      : "",
    frame.visual ? `Visual direction: ${frame.visual}` : "",
    // The other frames' roles only, never their words: an image model draws
    // whatever headlines it is shown, which made every frame the whole Story.
    count > 1
      ? `Where this frame sits in the Story (for pacing only, draw none of it): ${args.frames.map((f, i) => (i === args.index ? `${i + 1}. this frame` : `${i + 1}. ${f.role}`)).join(" → ")}.`
      : "",
    "Do not draw simulated app controls, progress bars or reply boxes. The only words in this image are the exact lines above; do not add any extra words.",
    qualityCheckLines({ hasText: !args.noText }).join("\n"),
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
  /** What the ad is for: decides what the picture must make obvious. */
  objective?: AdObjective | null;
  copy: AdOnImage;
  scene: string;
  brandName: string;
  brandContext: string;
  palette: string[];
  fonts: string[];
  ratio: string;
  style: ImageStyleInput | null;
  visualTasteRules?: string;
  /** The corner kept clear for the real logo, added afterward. */
  logoCorner?: string | null;
  revision?: string;
  novelty?: string;
}): string {
  const vertical = args.ratio === "9:16";
  const lines = onImageCopyLines(args.copy);
  return [
    `Create a finished, ready-to-run paid social ad for ${args.brandName}, ${args.ratio} format. It must look like a top-performing ad made by a professional performance creative team: one clear focal point, an obvious reading order (badge, headline, product, supporting line, button), strong contrast, and every word legible on a phone held at arm's length.`,
    args.objective
      ? `This ad's job: ${args.objective.label.toLowerCase()} (${args.objective.tagline.toLowerCase()}). ${args.objective.visual}`
      : "",
    "A paid ad, not an organic post: the offer or promise and the button are part of the design, and the whole message is understood with the sound off in one glance.",
    `Layout: ${args.format.layout}`,
    args.scene ? `Scene and subject: ${args.scene}` : "",
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
    lines.length ? TYPE_SYSTEM.join("\n") : "",
    `Keep all text at least 6% away from every edge${vertical ? ", and keep the top 14% and bottom 20% free of text for the platform's own buttons" : ""}.`,
    args.logoCorner
      ? `Leave the ${args.logoCorner} corner clear (about 16% of the width): the brand's real logo is placed there afterward. Do not draw any logo.`
      : "Do not draw a logo.",
    args.revision,
    args.novelty,
    "Never: invented claims, prices, discounts, ratings, reviews or people's names; another brand's logo or product; fake app screens, status bars or social media buttons; watermarks; gibberish text.",
    qualityCheckLines({
      hasText: lines.length > 0,
      hasProduct: sellsPhysicalProduct(args.brandContext),
    }).join("\n"),
  ]
    .filter(Boolean)
    .join("\n\n");
}

/** The real canvas, said once in plain words (no pixel maths). */
export function canvasLine(ratio: string): string {
  switch (ratio) {
    case "4:5":
      return "Portrait 4:5 feed post. It is rendered a little taller and trimmed about 4% at the top and bottom, so keep every word and the focal subject at least 8% away from the top and bottom edges and 6% from the sides.";
    case "9:16":
      return "Vertical 9:16 frame. Keep the top 14% and bottom 20% free of words and faces for the app's own buttons; everything important sits in the middle.";
    case "16:9":
      return "Landscape 16:9 post. Keep words and the focal subject inside the central 85%, with 6% margins on every side.";
    default:
      return "Square 1:1 feed post. Keep words and the focal subject inside the central 88%, with 6% margins on every side.";
  }
}

const LINE_LABEL: Record<string, string> = {
  eyebrow: "Exact small label",
  body: "Exact supporting line",
  item: "Exact list item",
  button: "Exact button text",
};

/** "role: text" lines from the writer as labelled exact copy. */
export function supportCopy(lines: readonly string[] | null | undefined) {
  return (lines ?? [])
    .map((line) => {
      const match = /^\s*(eyebrow|body|item|button)\s*:\s*(.+)$/i.exec(line);
      return match
        ? { label: LINE_LABEL[match[1].toLowerCase()], text: match[2].trim() }
        : { label: "Exact supporting line", text: line.trim() };
    })
    .filter((line) => line.text)
    .slice(0, 4);
}

/**
 * One picture post (ADR-0051), built like a Story frame: the art director's
 * paragraph (post-plan.ts) leads, then only short hard rules. It stays well
 * under the image model's 10,000-character cut, so the exact words and the
 * final check are never lost; nothing in it contradicts anything else.
 */
export function postImagePrompt(args: {
  brandName: string;
  /** The writer's art direction for this picture. */
  concept: string;
  /** The native post style it is made in (post-styles.ts, ADR-0051). */
  postStyle?: PostStyle | null;
  /** Older posts: the campaign layout they were staged on (art-direction.ts). */
  layout?: string | null;
  deliverable?: DeliverableId | null;
  headline?: string | null;
  lines?: readonly string[] | null;
  /** No words in the picture: the look allows none, or Mellox sets them afterward. */
  noText?: boolean;
  ratio: string;
  style: ImageStyleInput | null;
  palette?: string[];
  fonts?: string[];
  visualTasteRules?: string;
  logoCorner?: string | null;
  physicalProduct?: boolean;
  revision?: string;
  /** A source photo's rule (edit or inspire). */
  source?: string;
  /** Layouts the brand's latest pictures used. */
  avoidLayouts?: readonly string[];
  emphasisSeed?: string;
}): string {
  const postStyle = args.postStyle ?? null;
  const layout = postStyle ? null : archetypeById(args.layout);
  const deliverable = deliverableById(args.deliverable);
  const copy = args.noText
    ? []
    : [
        ...(args.headline?.trim() ? [{ label: "Exact headline", text: args.headline.trim() }] : []),
        ...supportCopy(args.lines),
      ];
  const look = args.style ? styleLead(args.style).join("\n").slice(0, 1400) : "";
  const palette = (args.style?.colors.length ? args.style.colors : (args.palette ?? []))
    .filter(Boolean)
    .slice(0, 5);
  const fonts = (args.style?.fonts.length ? args.style.fonts : (args.fonts ?? []))
    .filter(Boolean)
    .slice(0, 2);
  const avoid = (postStyle ? [] : (args.avoidLayouts ?? []))
    .map((id) => archetypeById(id)?.name)
    .filter((name): name is string => !!name && name !== layout?.name);
  return [
    `Create a finished, publishable social media post for ${args.brandName}. The entire design, including its typography, is made in this image. It must look like a real post a strong brand published on its feed this year: simple, believable and made for the person scrolling.`,
    "Act as a senior art director: an intentional, polished composition with one focal point, a clear reading order, real materials and light, and generous negative space. Avoid generic AI marketing imagery, surreal scale tricks, floating objects, random gradients, 3D icons, plastic objects and stock-photo clichés.",
    postStyle
      ? `POST STYLE: ${postStyle.name}. ${postStyle.picture}
Words: ${postStyle.words}`
      : "",
    canvasLine(args.ratio),
    args.revision ?? "",
    args.source ?? "",
    `ART DIRECTION (follow it):\n${args.concept.trim().slice(0, 1900)}`,
    layout ? `Layout: "${layout.name}", ${layout.summary}, adapted to this message.` : "",
    deliverable && deliverable.id !== "brand-moment"
      ? `This is a ${deliverable.name.toLowerCase()}: ${deliverable.readingOrder}. Never invent ${deliverable.neverInvent}.`
      : "",
    look,
    !look && palette.length
      ? `Brand colours, use these and close tints only: ${palette.join(", ")}; the first is the main colour, one accent used sparingly.`
      : "",
    !look && fonts.length ? `Type character in the spirit of ${fonts.join(" and ")}.` : "",
    args.visualTasteRules ? args.visualTasteRules.trim().slice(0, 500) : "",
    copy.length
      ? verbatimTextBlock({ lines: copy, emphasisSeed: args.emphasisSeed ?? args.brandName }).join(
          "\n",
        )
      : "Absolutely no words, letters, numbers, labels or logos anywhere in the image.",
    copy.length
      ? "Words always sit on a calm area (a clean background, a solid band, open space), never over busy detail and never covered by the subject."
      : "",
    copy.length ? TYPE_SYSTEM.join("\n") : "",
    args.logoCorner
      ? `Leave the ${args.logoCorner} corner clear (about 16% of the width): the brand's real logo is placed there afterward. Do not draw any logo.`
      : "Do not draw any logo.",
    avoid.length ? `Stage it differently from the brand's latest posts (${avoid.join(", ")}).` : "",
    "Never: invented prices, discounts, dates, ratings, reviews, quotes or names; another brand's logo or product; fake app screens or social media buttons; watermarks; gibberish text; extra or fused fingers.",
    qualityCheckLines({ hasText: copy.length > 0, hasProduct: args.physicalProduct }).join("\n"),
  ]
    .filter(Boolean)
    .join("\n\n");
}
