// How a product hero poster is staged (ADR-0040). Pure.
//
// The product is cut out of its own photo and becomes the subject of a
// designed scene, the way a brand's own campaign shoot looks: the whole frame
// in the product's colour, the product big and lit like a shoot, its own
// formula around it, and a few exact words. Never the photo in a frame.
//
// Written brand-neutral from studied reference posts (docs/studio/
// reference-study-2026-10.md, round 3). Ids are stored on posts
// (`meta.art_direction`): add, never rename.
import { hash } from "../art-direction";

const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

export type StagingId =
  | "glow-sweep"
  | "texture-burst"
  | "benefit-column"
  | "macro-crop"
  | "wet-glass"
  | "podium-stack"
  | "floating"
  | "shadow-play"
  | "colour-split"
  | "type-wall"
  | "ingredient-world";

export type Staging = {
  id: StagingId;
  name: string;
  /** The scene, given the product's words, its formula and its named ingredients. */
  scene: (product: string, texture: string | null, ingredients?: readonly string[]) => string;
  /** Where the product sits and how much of the frame it fills. */
  placement: string;
  /** Typography with words; `typeWithoutText` when the look allows none. */
  type: string;
  typeWithoutText: string;
  light: string;
  finish: string;
  avoid: string;
  needs: {
    /** The product's formula is known (gel, cream, foam, juice...). */
    texture?: boolean;
    /** At least this many short benefits from the stored facts. */
    benefits?: number;
    /** A headline to set. */
    text?: boolean;
    /** Ingredients the product's own facts name. */
    ingredients?: boolean;
  };
  /** Brief words that ask for this staging. */
  asks?: RegExp;
};

export const STAGINGS: readonly Staging[] = [
  {
    id: "glow-sweep",
    name: "Glow sweep",
    scene: (product) =>
      `${product} stands alone, upright and centred, seen from a slightly low angle on a seamless curved sweep whose horizon bends gently behind it. Two or three small four-point star glints catch the product's edges.`,
    placement:
      "Product centred, filling 55–65% of the frame height, its base on the curved horizon about two thirds down.",
    type: "One short headline at most, small and quiet at the top or bottom, in the deep shade of the background colour. The product does the talking.",
    typeWithoutText: "No words; the product's own label is the only lettering.",
    light:
      "Soft wrap-around key light, a bright rim on both edges, a gentle radial glow behind the product, a soft contact shadow.",
    finish: "Clean studio gradient in one colour family, crisp and luminous, no grain.",
    avoid: "props, plants, people, extra products, busy backgrounds",
    needs: {},
    asks: /\b(?:new|launch|introduc|meet|hero|spotlight|glow)\w*/i,
  },
  {
    id: "texture-burst",
    name: "Its own texture",
    scene: (product, texture) =>
      `${product} is caught mid-moment with its own ${texture ?? "formula"}: a glossy pour landing on the top, a swirl or splash wrapping around it, a few drops running down its side and pooling on the surface below. The ${texture ?? "formula"} is the same colour family as the product, slightly translucent.`,
    placement:
      "Product on the right half or centre, tilted 10–25 degrees, filling 55–70% of the frame height; the texture leads the eye into it.",
    type: "Headline top left in a bold display face, up to two short lines, with an optional one-sentence support line in a light serif under it. Type sits on calm background, never on the texture.",
    typeWithoutText: "No words; the texture and the product carry it.",
    light:
      "Bright high-key studio light with specular highlights on the wet texture and the pack, a soft reflection in the pool beneath.",
    finish:
      "Macro-sharp, glossy, real liquid physics: surface tension, beads, drips, frozen in a fast shutter.",
    avoid:
      "textures that aren't the product's own, fruit or ingredients the facts don't name, splashes of other colours",
    needs: { texture: true },
    asks: /\b(?:texture|formula|gel|cream|foam|lather|splash|pour|drip|swirl|feel)\w*/i,
  },
  {
    id: "benefit-column",
    name: "Benefit column",
    scene: (product) =>
      `${product} stands on a thin glass ledge on the right, slightly turned, a few clear droplets on the ledge. The left side of the frame is calm open background for a column of benefits.`,
    placement:
      "Product on the right, filling 55–65% of the frame height, its edge never crossing into the text column.",
    type: "A centred column on the left, one benefit per row, evenly spaced from top to bottom. Each benefit is two or three short lines in a friendly serif in the deep shade of the background, with one small simple icon above it in the accent colour (a droplet, a sparkle, a heart, a leaf or a check), the same size each time.",
    typeWithoutText: "No words; show the product alone on the ledge, the left side quiet.",
    light:
      "Fresh daylight from the upper left, a crisp shadow and reflection on the glass, a soft bloom on the product's edge.",
    finish: "Clean, bright and even; the background a soft gradient of one colour.",
    avoid: "more than five benefits, long sentences, icons of different styles, emoji clutter",
    needs: { benefits: 3 },
    asks: /\b(?:benefits?|why|what it does|features?|reasons?|how it helps|results?)\b/i,
  },
  {
    id: "macro-crop",
    name: "Macro crop",
    scene: (product) =>
      `${product} is shot enormous and close, lying on its side or entering from the edge, so part of it is cropped off the frame. A mirror-like surface reflects it below. The brand name on the pack reads huge.`,
    placement:
      "Product fills the lower or right two thirds of the frame and bleeds off one edge; the top left third stays open for words.",
    type: "Headline top left in a heavy serif or display face, up to three short lines, then one short paragraph in the same colour in a light weight, left aligned with a generous margin.",
    typeWithoutText: "No words; the giant pack and its reflection fill the frame.",
    light:
      "Hard bright studio light from above, glossy highlights along the pack, a clean reflection fading out below.",
    finish:
      "Editorial and graphic: white or very light background, the product's colour as the only strong colour.",
    avoid: "a second product, props, shrinking the product to fit the frame",
    needs: { text: true },
    asks: /\b(?:close.?up|detail|macro|different|difference|more than|story)\b/i,
  },
  {
    id: "wet-glass",
    name: "Wet glass shelf",
    scene: (product) =>
      `${product} stands on a clear glass shelf seen at a slight angle, covered in fresh water droplets, with a little water running off the shelf's edge in frozen drops. Where the photo shows several products of the range, they stand together in a tight, staggered group.`,
    placement:
      "Products in the middle third, the tallest filling about 60% of the frame height; the shelf crosses the lower third diagonally.",
    type: "One short headline at the top in a bold display face, or none. Never over the products.",
    typeWithoutText: "No words; the wet glass and the products carry it.",
    light:
      "Cool bright light with sparkling star glints on the cap edges, sharp caustics through the glass, droplets catching the light.",
    finish: "Fresh, wet and sharp; one cool colour family.",
    avoid: "ice cubes, fruit, plants, a bathroom setting, people",
    needs: {},
    asks: /\b(?:routine|range|set|kit|collection|bundle|fresh|water|hydrat)\w*/i,
  },
  {
    id: "podium-stack",
    name: "Podium stack",
    scene: (product) =>
      `${product} stands on top of two or three stacked round podiums of different heights in tints of its own colour, with one or two simple matching shapes (an arch, a sphere, a half circle) behind it. Nothing else.`,
    placement:
      "Product on the highest podium, slightly off centre, filling 50–60% of the frame height.",
    type: "Headline across the top in a bold display face, up to two short lines; an optional short line at the bottom.",
    typeWithoutText: "No words; the set and the product carry it.",
    light:
      "Warm soft daylight from one side with a long, soft shadow across the podiums, a gentle rim on the product.",
    finish: "Matte painted set surfaces, tone-on-tone, like a real set build.",
    avoid: "more than three shapes, other colours, props that aren't geometric",
    needs: {},
    asks: /\b(?:offer|sale|price|deal|shop|buy|gift)\w*/i,
  },
  {
    id: "floating",
    name: "Floating",
    scene: (product) =>
      `${cap(product)} floats in mid-air, tilted at a confident angle, as if caught a moment after being tossed up, with a soft shadow on the ground far below.`,
    placement:
      "Product slightly above centre, tilted 15–30 degrees, filling 50–60% of the frame height.",
    type: "Headline at the bottom or top in a bold display face, up to two short lines, clear of the product.",
    typeWithoutText: "No words; the floating product carries it.",
    light:
      "Bright soft key light from above, a crisp rim along the product's edges, the shadow below soft and distant.",
    finish: "Weightless and crisp, frozen with a fast shutter, one colour family.",
    avoid: "strings or hands holding it, motion blur on the label, other products",
    needs: {},
    asks: /\b(?:weightless|effortless|float\w*|airy|lightweight)\b/i,
  },
  {
    id: "shadow-play",
    name: "Shadow play",
    scene: (product) =>
      `${cap(product)} stands alone in strong, low sunlight that throws a long graphic shadow behind it, crossed by crisp shadows of window frames or simple shapes across the set.`,
    placement:
      "Product off centre on one third line, filling 45–60% of the frame height; its long shadow leads across the frame.",
    type: "Headline small and confident in one calm corner, in the deep shade of the background.",
    typeWithoutText: "No words; the light and shadows carry it.",
    light:
      "One hard, warm sun-like light from low to one side; deep crisp shadows, warm highlights on the product.",
    finish: "Architectural and calm, gallery-like, one colour family.",
    avoid: "plants, leaves, people, soft flat light, busy shapes",
    needs: {},
    asks: /\b(?:sunlight|sunny|calm|slow|minimal|weekend)\b/i,
  },
  {
    id: "colour-split",
    name: "Colour split",
    scene: (product) =>
      `The frame is divided into two flat colour blocks: a tint of the product's own colour and the accent colour. ${cap(product)} stands across the line where they meet, bridging both.`,
    placement: "Product centred on the dividing line, filling 55–65% of the frame height.",
    type: "Headline in a heavy display face set on one block, up to two short lines; an optional short line on the other block.",
    typeWithoutText: "No words; the two colour blocks and the product carry it.",
    light: "Even, bright studio light with a soft contact shadow that falls across both blocks.",
    finish:
      "Bold, graphic and flat, like a poster print; only the two block colours and the product.",
    avoid: "gradients, more than two block colours, textures, props",
    needs: {},
    asks: /\b(?:bold|pop|vs|versus|before and after|contrast)\b/i,
  },
  {
    id: "type-wall",
    name: "Type wall",
    scene: (product) =>
      `The headline is set enormous across the background like a wall of type, and ${product} stands in front of it, overlapping some of the letters while every word stays readable.`,
    placement:
      "Product centred in the lower two thirds, filling 55–65% of the frame height, in front of the giant type.",
    type: "The headline is the background: huge, heavy display type filling the width, in a tint a little deeper than the background. Nothing else is set.",
    typeWithoutText: "No words; a plain wall with the product in front.",
    light: "Soft frontal studio light with a clear shadow of the product falling on the type wall.",
    finish: "Confident and editorial, two tones of one colour plus the product.",
    avoid: "letters hidden so the words can't be read, more than one line of small type, props",
    needs: { text: true },
    asks: /\b(?:statement|loud|announc\w*|big news)\b/i,
  },
  {
    id: "ingredient-world",
    name: "Its ingredients",
    scene: (product, _texture, ingredients) =>
      `${cap(product)} stands among its own ingredients${ingredients?.length ? ` (${ingredients.slice(0, 3).join(", ")})` : ""}, fresh and real, styled with care so the product stays the clear hero.`,
    placement:
      "Product centred or on one third line, filling 55–65% of the frame height; the ingredients frame it and never cover its label.",
    type: "Headline top left in a bold display face, up to two short lines, with an optional one-sentence support line in a light serif under it.",
    typeWithoutText: "No words; the product and its ingredients carry it.",
    light:
      "Fresh, natural daylight from one side, crisp detail on the ingredients, a soft contact shadow.",
    finish: "Fresh, tactile and honest, macro-sharp, tinted towards the product's colour.",
    avoid:
      "ingredients the product's facts don't name, a messy pile, ingredients in front of the label",
    needs: { ingredients: true },
    asks: /\b(?:ingredients?|made with|natural|infused)\b/i,
  },
];

/**
 * Stagings that can show a product its photo cuts off: it enters from the
 * frame's edge, so the missing part is never drawn.
 */
export const CROP_SAFE: readonly StagingId[] = [
  "macro-crop",
  "texture-burst",
  "colour-split",
  "type-wall",
  "shadow-play",
];

export const STAGING_IDS = STAGINGS.map((s) => s.id) as [StagingId, ...StagingId[]];

export function stagingById(id: unknown): Staging | null {
  return STAGINGS.find((s) => s.id === id) ?? null;
}

/** The stagings the brand's latest product posts used, newest first. */
export function recentStagings(
  recent: readonly { artDirection?: string | null }[],
  n = 2,
): StagingId[] {
  const ids: StagingId[] = [];
  for (const item of recent) {
    const staging = stagingById(item.artDirection);
    if (staging && !ids.includes(staging.id)) ids.push(staging.id);
    if (ids.length >= n) break;
  }
  return ids;
}

export type StagingInput = {
  seed: string;
  brief: string;
  texture: string | null;
  benefits: number;
  /** Ingredients the product's facts name. */
  ingredients?: readonly string[];
  /** The product runs off its photo's edge: only crop-safe stagings. */
  cropped?: boolean;
  /** Stagings the occasion suits: tried before the seed on three seeds in four. */
  preferred?: readonly StagingId[];
  /** A headline will be set (the look allows words and there is copy). */
  hasText: boolean;
  /** Latest stagings, newest first: the next post uses another one. */
  recent?: readonly string[];
  /** The team's taste (ADR-0038): avoided stagings are dropped, loved ones lead. */
  lean?: { liked: string[]; avoided: string[] } | null;
};

/** What a staging needs, from what the piece really has. */
export function stagingFits(staging: Staging, input: StagingInput): boolean {
  if (staging.needs.texture && !input.texture) return false;
  if ((staging.needs.benefits ?? 0) > input.benefits) return false;
  if (staging.needs.text && !input.hasText) return false;
  if (staging.needs.ingredients && !input.ingredients?.length) return false;
  if (input.cropped && !CROP_SAFE.includes(staging.id)) return false;
  return true;
}

/**
 * One staging for this piece: one the brief asks for wins, then the team's
 * taste, then the seed, always kept off the latest two when another fits.
 */
export function pickStaging(input: StagingInput): Staging {
  const fitting = STAGINGS.filter((s) => stagingFits(s, input));
  const pool = fitting.length
    ? fitting
    : STAGINGS.filter(
        (s) => !Object.keys(s.needs).length && (!input.cropped || CROP_SAFE.includes(s.id)),
      );
  const recent = new Set(input.recent ?? []);
  const fresh = pool.filter((s) => !recent.has(s.id));
  const open = fresh.length ? fresh : pool;
  const avoided = new Set(input.lean?.avoided ?? []);
  const kept = open.filter((s) => !avoided.has(s.id));
  const usable = kept.length ? kept : open;
  const asked = usable.filter((s) => s.asks?.test(input.brief));
  if (asked.length) return asked[hash(`ask:${input.seed}`) % asked.length];
  const suited = usable.filter((s) => input.preferred?.includes(s.id));
  if (suited.length && hash(`occasion:${input.seed}`) % 4 !== 3)
    return suited[hash(input.seed) % suited.length];
  const liked = new Set(input.lean?.liked ?? []);
  const loved = usable.filter((s) => liked.has(s.id));
  // Loved stagings lead on two seeds out of three, never all of them.
  if (loved.length && hash(`lean:${input.seed}`) % 3 !== 2)
    return loved[hash(input.seed) % loved.length];
  return usable[hash(input.seed) % usable.length];
}
