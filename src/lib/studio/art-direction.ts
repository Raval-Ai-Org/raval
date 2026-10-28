// Art direction for generated pictures: a small library of campaign layouts
// that top social and print creatives keep coming back to, distilled from
// real high-performing prompts and written brand-neutral. A layout says how to
// stage the idea (scale, depth, where the headline sits, light, finish); the
// brand still decides colours, fonts and what the picture says.
//
// Pure and browser-safe: the post-image builder (browser and server), Studio's
// carousel prompts and the image brief all read it.
import type { CreativeFormat, CreativeObjective } from "@/lib/creative-strategy";

export type ArchetypeId =
  | "monument-object"
  | "hero-world"
  | "exploded-view"
  | "miniature-diorama"
  | "portal-pop-out"
  | "name-on-the-wall"
  | "peak-action"
  | "pop-collage"
  | "quiet-editorial"
  | "literal-metaphor"
  | "double-exposure"
  | "material-swap"
  | "film-strip-cutout"
  | "clean-split"
  | "number-monument";

type Energy = "calm" | "bold" | "playful";

export type Archetype = {
  id: ArchetypeId;
  name: string;
  /** One line for the concept writer's menu. */
  summary: string;
  /** Formats it serves best. */
  formats: CreativeFormat[];
  energy: Energy[];
  /** "required": the layout is a person; "optional": better with one. */
  person: "required" | "optional" | "none";
  /** Only for brands that sell a physical thing. */
  physicalOnly?: boolean;
  /** The layout depends on a typeset word. */
  needsText?: boolean;
  scene: (hero: string, people: boolean) => string;
  type: string;
  typeWithoutText: string;
  light: string;
  finish: string;
  avoid: string;
};

const PERSON = "a fictional model (never a real or famous person)";

export const ARCHETYPES: readonly Archetype[] = [
  {
    id: "monument-object",
    name: "Monument object",
    summary:
      "one object scaled up to furniture size in a one-colour studio; a person leans or sits on it; a giant word behind them",
    formats: ["product-focused", "cinematic-campaign", "abstract-metaphorical", "human-lifestyle"],
    energy: ["calm", "bold"],
    person: "optional",
    scene: (hero, people) =>
      `Scale play: ${hero}, enlarged to the size of furniture, rests at a deliberate diagonal on the floor of a seamless one-colour studio.${people ? ` ${cap(PERSON)} in a clean, coordinated outfit that echoes the palette leans, sits or reclines on it naturally, relaxed and confident, as if it were a chair.` : " Nothing else in the room: the object is the sculpture."} A semi-reflective glossy floor carries a soft mirror reflection.`,
    type: "Set the headline as one massive condensed sans-serif word or very short phrase across the background, BEHIND the subject and partly hidden by it, so the layers read as real depth. A small supporting line sits low and centred, a tiny label in one top corner at most.",
    typeWithoutText:
      "Leave a wide, calm band behind and above the subject where a headline can be set later. No letters.",
    light:
      "Soft, even, slightly cool studio light with gentle contact shadows; 85mm lens at eye level, everything crisp.",
    finish:
      "High-concept fashion-campaign polish: monochrome set tinted with one brand colour, ultra-clean, nothing extra.",
    avoid:
      "props scattered around, busy backgrounds, the object floating without a believable contact shadow",
  },
  {
    id: "hero-world",
    name: "Hero in its own world",
    summary:
      "the product floating over a glossy pedestal, the whole scene built from its own ingredients or materials, frozen mid-splash",
    formats: ["product-focused", "cinematic-campaign"],
    energy: ["bold", "playful"],
    person: "none",
    physicalOnly: true,
    scene: (hero) =>
      `${cap(hero)} perfectly centred and dominant, floating just above a glossy sculptural pedestal. The entire environment is built from what the product is made of or what it delivers: its ingredients, materials or effect turned into surreal architecture (ribbons, splashes, arches, suspended pieces, bubbles or crystals), frozen mid-motion around it. Palette pulled only from the product and the brand colours.`,
    type: "A massive headline behind the product, partly hidden by it; under it one secondary line and one small tagline, in a clear three-step hierarchy. At most a few tiny graphic accents (thin rules, a small label).",
    typeWithoutText:
      "Keep a clear zone above the product for a headline added later. No letters, labels or stickers.",
    light:
      "Cinematic product light: soft key, a rim light in the accent colour, gentle volumetric glow, light refracting through liquid or glass, condensation and reflections where real; slight low angle, 85mm, product razor sharp, background a touch soft.",
    finish: "Award-winning key visual, hyper-real materials, premium and energetic.",
    avoid:
      "a supermarket or real-world setting, a distorted or relabelled pack, clutter that competes with the product",
  },
  {
    id: "exploded-view",
    name: "Exploded view",
    summary:
      "the thing taken apart into perfectly aligned floating layers with thin pointer lines, like a premium infographic",
    formats: ["educational-visual", "product-focused", "data-statistic", "comparison"],
    energy: ["calm", "bold"],
    person: "none",
    scene: (hero) =>
      `${cap(hero)} shown as an exploded vertical stack: its parts, layers or steps separated top to bottom with even gaps, in perfect centred alignment, each layer hyper-real (true textures, true materials). Clean studio backdrop in a soft brand-tinted neutral.`,
    type: "Thin pointer lines with small dot markers lead from each layer to a short label. Labels use only words from the supplied copy; if there are none, keep the pointer lines and leave the labels out.",
    typeWithoutText:
      "Thin pointer lines with small dot markers and no labels; leave clean space beside each for labels added later.",
    light: "Soft, even studio light with realistic shadows under each layer; straight-on camera.",
    finish:
      "Premium infographic: precise, airy, elegant, every line hairline-thin and perfectly aligned.",
    avoid: "crooked stacking, heavy arrows, crowded labels, gibberish label text",
  },
  {
    id: "miniature-diorama",
    name: "Miniature diorama",
    summary:
      "a normal-size object treated as a giant site where tiny people work on it, on a clean diorama base",
    formats: ["storytelling", "abstract-metaphorical", "product-focused", "educational-visual"],
    energy: ["playful", "calm"],
    person: "none",
    scene: (hero) =>
      `${cap(hero)} at the centre of a miniature diorama: tiny figures in bright workwear tend to it with scaffolding, ladders, cranes and small machines, as if building, polishing or maintaining it, creating a playful scale contrast. The scene sits on a thin, clean diorama base against a seamless backdrop that matches the hero's tone.`,
    type: "One confident headline in the empty space above the diorama, clean sans-serif, generous margins.",
    typeWithoutText: "Keep the space above the diorama empty for a headline added later.",
    light:
      "Soft, diffused, cinematic light with gentle shadows; tilt-shift-like shallow depth of field on the tiny figures.",
    finish: "Realistic model-maker craftsmanship, polished premium advertising.",
    avoid: "messy crowds, figures without purpose, cartoon styling",
  },
  {
    id: "portal-pop-out",
    name: "Portal pop-out",
    summary:
      "a hand holds a flat thing (ticket, card, phone, page) that opens like a window; one element breaks out of it in 3D",
    formats: ["storytelling", "product-focused", "human-lifestyle", "abstract-metaphorical"],
    energy: ["playful", "bold"],
    person: "optional",
    scene: (hero) =>
      `A close-up hand holds a flat object (a ticket, card, phone screen, page or package front) in front of a clean cream backdrop. The object is a window into a detailed miniature world about ${hero}, and one key element of that world breaks out of the frame in 3D onto a small floating platform. A few light hand-drawn sketch doodles of related things surround the composition.`,
    type: "The headline is printed on the flat object itself, as part of its design; nothing else.",
    typeWithoutText: "The flat object has blank printed areas; no letters.",
    light:
      "Warm golden-hour light, premium paper or glass texture, depth of field that keeps the pop-out sharp.",
    finish: "Paper-craft meets product photography: inventive, tactile, hyper-real.",
    avoid: "a cluttered city, extra hands, warped fingers",
  },
  {
    id: "name-on-the-wall",
    name: "Name on the wall",
    summary:
      "a small figure from behind or in profile, an enormous word across the background, huge negative space and a long shadow",
    formats: ["minimal-typography", "cinematic-campaign", "founder-led", "human-lifestyle"],
    energy: ["bold", "calm"],
    person: "required",
    needsText: true,
    scene: (hero) =>
      `${cap(PERSON)}, seen from behind or in profile, stands confidently in the lower middle of the frame, styled around ${hero}. A smooth single-colour gradient fills the rest, with large negative space above. A dramatic long shadow runs diagonally across the ground.`,
    type: "Enormous bold typography spelling the headline stretches horizontally across the lower background, partly hidden by the figure.",
    typeWithoutText: "Leave the lower background as a wide empty band for a headline added later.",
    light:
      "Low, directional light that makes the long shadow; realistic fabric folds and highlights; symmetrical framing.",
    finish: "Minimal sports-poster branding, crisp edges, wallpaper-clean.",
    avoid: "a busy stadium, crowds, extra figures",
  },
  {
    id: "peak-action",
    name: "Peak action",
    summary:
      "a person frozen at the peak of a jump or lunge, shot from below, the product huge in the foreground, a giant word behind",
    formats: ["cinematic-campaign", "human-lifestyle", "product-focused"],
    energy: ["bold", "playful"],
    person: "required",
    scene: (hero) =>
      `${cap(PERSON)} caught at the peak of movement (mid-air jump, deep lunge or stride), shot from a low angle so ${hero} dominates the foreground. Hair and fabric in motion, a few particles or light streaks in the air, a dark-to-warm or clean colour gradient background in the brand palette.`,
    type: "A massive, bold headline bleeds across the background behind the figure; the brand line and up to three short taglines sit small at the bottom. No type over the face or the product.",
    typeWithoutText: "Keep the background behind the figure clean for a headline added later.",
    light:
      "Cinematic contrast: strong key light, coloured rim light, sharp freeze-frame detail, cinematic grading.",
    finish: "Sportswear campaign energy, ultra-photoreal.",
    avoid: "motion blur on the face or product, impossible anatomy, extra limbs",
  },
  {
    id: "pop-collage",
    name: "Pop editorial collage",
    summary:
      "a cut-out subject on layered paper, torn edges, stickers, halftone dots and chrome accents, like a teen magazine",
    formats: ["meme-style", "storytelling", "ugc-style", "human-lifestyle"],
    energy: ["playful"],
    person: "optional",
    scene: (hero, people) =>
      `${people ? `${cap(PERSON)} or ${hero}` : cap(hero)} as a crisp cut-out in the centre, over a layered graphic collage: paper textures, torn poster edges, halftone dots, bold geometric shapes, stars, hearts, a chrome element and a barcode, all in the brand palette.`,
    type: "Big playful headline as part of the collage, in one bold display face; sticker elements carry no words unless they are from the supplied copy.",
    typeWithoutText: "Stickers and shapes carry no letters at all.",
    light: "Clean studio flash, high contrast, glossy finish.",
    finish: "Premium print collage, deliberate and balanced, never random.",
    avoid: "fake words or gibberish in stickers, messy collage edges, too many elements",
  },
  {
    id: "quiet-editorial",
    name: "Quiet editorial",
    summary:
      "a monochrome photo with vast negative space, one accent-colour circle or mark, thin serif type, gallery calm",
    formats: ["editorial", "minimal-typography", "quote-testimonial", "founder-led"],
    energy: ["calm"],
    person: "optional",
    scene: (hero, people) =>
      `A single black-and-white editorial photograph of ${people ? `${PERSON} with a calm, confident expression, styled around ${hero}` : hero}, placed asymmetrically. Large negative space dominates. One solid circle or mark in the brand's accent colour is the only colour in the frame. Subtle paper grain and a light brush-stroke texture frame the image.`,
    type: "Thin elegant serif headline with wide letter spacing, a tiny sans-serif support line and gallery-style spacing.",
    typeWithoutText: "Keep the negative space empty for type added later.",
    light: "Soft natural grayscale light, gentle shadows, fine-art portrait feel.",
    finish: "Gallery poster: calm luxury, restraint, every element placed on purpose.",
    avoid: "more than one accent colour, decorative clutter, heavy contrast",
  },
  {
    id: "literal-metaphor",
    name: "Literal metaphor",
    summary:
      "the message's idea staged literally as one surreal sculpture (e.g. a person sitting on a giant version of their own head for 'overthinking')",
    formats: ["abstract-metaphorical", "problem-solution", "storytelling"],
    energy: ["calm", "bold", "playful"],
    person: "optional",
    scene: (hero, people) =>
      `Turn the post's core idea into one literal, surreal sculpture about ${hero}: pick the plainest physical picture of the idea and make it real and huge.${people ? ` ${cap(PERSON)} interacts with it casually (sitting on it, walking through it, holding it), which makes the scale believable.` : ""} Minimal neutral studio, nothing else.`,
    type: "Headline at the top in bold minimal type, or as hand-drawn scribble lettering behind the subject; clear magazine-cover hierarchy.",
    typeWithoutText: "Leave the top third calm for a headline added later.",
    light: "Soft diffused studio light, realistic shadows, ultra-detailed textures.",
    finish:
      "Conceptual advertising: one smart idea, read in a second, photoreal craft that makes it feel possible.",
    avoid: "several metaphors at once, abstract shapes with no meaning",
  },
  {
    id: "double-exposure",
    name: "Double exposure",
    summary:
      "a clean profile silhouette filled with a scene that stands for the person, place or promise",
    formats: ["storytelling", "founder-led", "editorial", "abstract-metaphorical"],
    energy: ["calm"],
    person: "optional",
    scene: (hero, people) =>
      `Minimalist double exposure: a clean side-profile silhouette of ${people ? PERSON : "a simple object that stands for the brand"} filled with a scene about ${hero}. Outside the silhouette, a plain light background.`,
    type: "Small, refined headline under or beside the silhouette, plenty of air.",
    typeWithoutText: "No letters; keep one side quiet for type added later.",
    light: "Soft even light, gentle gradients inside the silhouette, crisp outline.",
    finish: "Poster-minimal, travel-poster calm.",
    avoid: "a muddy blend where the silhouette is lost, more than one scene",
  },
  {
    id: "material-swap",
    name: "Material swap",
    summary:
      "the product or a symbolic object remade in a surprising material (mousse cake, glass, chrome, knit, ice), exact silhouette kept",
    formats: ["product-focused", "abstract-metaphorical", "minimal-typography"],
    energy: ["playful", "calm"],
    person: "none",
    scene: (hero) =>
      `${cap(hero)} remade in one unexpected material that says something about the message (soft matte mousse, frosted glass, liquid chrome, knitted wool, ice), keeping the exact silhouette and proportions. Straight front view, centred, on a simple table or plinth, with one natural interaction such as a spoon or a fingertip about to touch it.`,
    type: "One short headline in clean type above or below the object, lots of space.",
    typeWithoutText: "No letters; keep space above for type added later.",
    light: "Soft daylight from a nearby window, realistic gentle shadows, macro detail.",
    finish: "Hyper-real and tactile, premium yet natural styling.",
    avoid: "glossy plastic look, a changed shape, extra objects",
  },
  {
    id: "film-strip-cutout",
    name: "Film-strip cutout",
    summary:
      "rounded strips of black-and-white film stills behind, one vivid colour cut-out of the same person in front",
    formats: ["founder-led", "human-lifestyle", "quote-testimonial", "storytelling"],
    energy: ["bold", "calm"],
    person: "required",
    scene: (hero) =>
      `Behind: three or four layered rounded strips showing black-and-white film-like stills of ${PERSON} in varied poses. In front: a vivid full-colour cut-out of the same person, styled around ${hero}, placed off-centre with dramatic light and depth.`,
    type: "Short headline in a bold display face across one strip edge; one small line of support.",
    typeWithoutText: "No letters; one strip edge stays clean for type added later.",
    light: "Dramatic directional light on the colour cut-out, flat archival tone on the strips.",
    finish: "Luxury portrait campaign, magazine-cover polish.",
    avoid: "different faces in the strips, a messy layout",
  },
  {
    id: "clean-split",
    name: "Clean split",
    summary:
      "two matched halves with the same framing and one thing changed, so the difference reads at a glance",
    formats: ["before-after", "comparison", "problem-solution"],
    energy: ["calm", "bold"],
    person: "optional",
    scene: (hero) =>
      `The frame splits into two matched halves about ${hero}: identical framing, camera and light, with only the one thing that changes between them. One half muted and tense, the other bright and resolved, joined by a crisp divider in the accent colour.`,
    type: "A short label at the top of each half and one headline across the divider, from the supplied copy only.",
    typeWithoutText: "No letters; keep the top of each half clean for labels added later.",
    light: "Identical light on both sides so the change is the only difference.",
    finish: "Clear, credible, editorial; no exaggeration.",
    avoid: "different camera angles on each side, exaggerated results",
  },
  {
    id: "number-monument",
    name: "Number monument",
    summary:
      "the one figure from the copy built as a huge sculptural object in a clean set, with small context beside it",
    formats: ["data-statistic", "minimal-typography", "educational-visual"],
    energy: ["bold", "calm"],
    person: "optional",
    needsText: true,
    scene: (hero) =>
      `The key figure from the supplied copy, built as a huge sculptural 3D object (carved, cast or stacked) in a clean one-colour set about ${hero}, with a small scene element that gives it scale. Use only a number that appears in the supplied copy; if there is none, use one bold symbol instead.`,
    type: "The figure is the headline; one small line of context next to it.",
    typeWithoutText: "A bold symbol instead of a number; no letters.",
    light: "Soft studio light with one strong shadow that gives the figure weight.",
    finish: "Editorial data design: confident, minimal, credible.",
    avoid: "invented numbers, extra charts, decimals the copy doesn't have",
  },
];

const BY_ID = new Map(ARCHETYPES.map((a) => [a.id, a]));

export function archetypeById(id: unknown): Archetype | null {
  return typeof id === "string" ? (BY_ID.get(id as ArchetypeId) ?? null) : null;
}

export const ARCHETYPE_IDS = ARCHETYPES.map((a) => a.id) as [ArchetypeId, ...ArchetypeId[]];

function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function hash(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const PHYSICAL =
  /\b(shoe|sneaker|apparel|clothing|fashion|wear|jewel|watch|bag|drink|beverage|coffee|tea|juice|soda|water|beer|wine|spirit|snack|food|bakery|cake|chocolate|restaurant|cafe|skincare|skin care|cosmetic|beauty|makeup|fragrance|perfume|candle|furniture|decor|toy|bottle|can|cup|supplement|vitamin|pet food|device|gadget|headphone|camera|phone case|bike|car|eyewear|sunglass)/;
const NOT_PHYSICAL =
  /\b(saas|software|platform|app\b|api|consult|agency|service|coaching|course|b2b|fintech|insurance|legal|recruit|marketing)/;

/** Does the brand sell something you can hold? Read from its own words only. */
export function sellsPhysicalProduct(brandText: string): boolean {
  const text = brandText.toLowerCase();
  return PHYSICAL.test(text) && !NOT_PHYSICAL.test(text);
}

function brandEnergy(brandText: string): Energy | null {
  const text = brandText.toLowerCase();
  if (/(sport|fitness|athlet|energy|performance|power|gym|run|bold|fearless)/.test(text))
    return "bold";
  if (/(playful|fun|quirky|youth|gen z|vibrant|colorful|colourful|cheeky|kids)/.test(text))
    return "playful";
  if (/(premium|luxury|elegant|calm|minimal|refined|wellness|mindful|editorial|quiet)/.test(text))
    return "calm";
  return null;
}

export type ArtDirectionInput = {
  format?: CreativeFormat | null;
  objective?: CreativeObjective | null;
  /** Brand DNA text (voice, industry, products, values) used for fit only. */
  brandText: string;
  /** Overrides the guess from brandText. */
  physicalProduct?: boolean;
  /** False when the brand rules out people in its pictures. */
  allowPeople?: boolean;
  /** False when nothing may be written in the picture. */
  allowText?: boolean;
  /** Same seed, same layout: keeps every size and retry of one piece together. */
  seed: string;
  exclude?: ArchetypeId[];
};

/** Pick the layout that fits this piece and brand; deterministic per seed. */
export function pickArchetype(input: ArtDirectionInput): Archetype {
  const physical = input.physicalProduct ?? sellsPhysicalProduct(input.brandText);
  const energy = brandEnergy(input.brandText);
  const allowPeople = input.allowPeople !== false;
  const allowText = input.allowText !== false;
  const exclude = new Set(input.exclude ?? []);
  const scored = ARCHETYPES.filter(
    (a) =>
      !exclude.has(a.id) &&
      (physical || !a.physicalOnly) &&
      (allowPeople || a.person !== "required") &&
      (allowText || !a.needsText),
  ).map((a) => {
    let score = 0;
    if (input.format && a.formats.includes(input.format)) score += 3;
    if (energy && a.energy.includes(energy)) score += 2;
    if (physical && (a.physicalOnly || a.formats.includes("product-focused"))) score += 1;
    if (
      (input.objective === "product-launch" || input.objective === "conversion") &&
      a.formats.includes("product-focused")
    )
      score += 1;
    return { a, score };
  });
  const pool = scored.length ? scored : ARCHETYPES.map((a) => ({ a, score: 0 }));
  const best = Math.max(...pool.map((p) => p.score));
  // The top tier and the one just below it, so the same brand doesn't get the
  // same layout every time while a poor fit is never chosen.
  const shortlist = pool.filter((p) => p.score >= best - 1);
  return shortlist[hash(input.seed) % shortlist.length].a;
}

/**
 * What top campaign creatives have in common, whatever the layout. Applies to
 * every generated picture.
 */
export const CRAFT_RULES: readonly string[] = [
  "One hero, one idea: a single dominant subject that reads in under a second at thumbnail size.",
  "Make it a picture people stop for: a scale surprise, an unexpected material or a striking pose, never a stock scene of people at a laptop.",
  "Build real depth: foreground, subject and background layers, with type able to sit between them.",
  "Art-direct the light like a shoot: name-able key light, rim or edge light, believable contact shadows and reflections.",
  "Real materials: true textures, fabric folds, condensation, glass and metal reflections; nothing plastic or waxy.",
  "Palette comes from the brand and the product: one dominant colour, one accent, neutrals; no rainbow gradients.",
  "Type hierarchy of three steps at most (headline, one support line, one tiny detail), in no more than two typefaces, high contrast against what is behind it.",
  "Avoid AI tells: extra or fused fingers, warped faces, duplicated subjects, melted product shapes, gibberish lettering, over-smoothed skin, oversaturated colour.",
];

/** Lines for an image prompt that stage the picture with one layout. */
export function archetypePromptLines(
  archetype: Archetype,
  opts: { hero: string; allowPeople?: boolean; allowText?: boolean; deferToStyle?: boolean },
): string[] {
  const people = opts.allowPeople !== false && archetype.person !== "none";
  return [
    `ART DIRECTION — "${archetype.name}": stage the picture on this proven campaign layout, adapted to this brand and message.${opts.deferToStyle ? " The brand style above still decides colours, fonts and medium; this decides the staging." : ""}`,
    `• Scene: ${archetype.scene(opts.hero, people)}`,
    opts.allowText === false
      ? `• Typography: ${archetype.typeWithoutText}`
      : `• Typography: ${archetype.type} Every word comes from the supplied copy and stays within the text limit; drop the smaller lines before inventing any.`,
    `• Light and camera: ${archetype.light}`,
    "• Product truth: keep any real product's true shape and proportions; where its exact look isn't supplied, keep the pack clean and unlabelled rather than inventing a label, logo or claim.",
    `• Finish: ${archetype.finish}`,
    `• Avoid for this layout: ${archetype.avoid}.`,
    "CRAFT — what the world's best social creatives share:",
    ...CRAFT_RULES.map((rule) => `• ${rule}`),
  ];
}

/** The hero subject, from what the brand sells; never an invented product. */
export function heroSubject(args: { products?: string | null; physical: boolean }): string {
  const products = (args.products ?? "").replace(/\s+/g, " ").trim().slice(0, 90);
  if (args.physical && products) return `the brand's own product (${products})`;
  return "one simple, physical everyday object that stands for the post's message";
}

/** The concept writer's menu: id, name and when to use it. */
export function archetypeMenu(): string {
  return ARCHETYPES.map(
    (a) =>
      `- ${a.id}: ${a.name}, ${a.summary}. Best for ${a.formats.join(", ")}.${a.physicalOnly ? " Only for a physical product." : ""}${a.person === "required" ? " Needs a person." : ""}`,
  ).join("\n");
}

/**
 * How a carousel's slides belong together, the way agency carousels do: a
 * locked system with a poster for a cover and varied rhythm inside.
 */
export function carouselSeriesRules(position: "cover" | "middle" | "last"): string[] {
  return [
    "SERIES SYSTEM — design the set the way a top agency carousel is designed: lock the grid, outer margins (at least 7% each side), headline position, type scale and colour roles across every slide, so the set reads as one piece in the profile grid.",
    position === "cover"
      ? "This cover is a poster: the headline is the largest element (it can fill a third of the frame), one hero image built on the layout below, no body-copy clutter. It must earn the swipe on its own."
      : position === "last"
        ? "This closing slide is calm and type-led: the recurring motif small, the action the clear focal point, lots of space."
        : "Inside slides: headline in the same place as the other inside slides, one supporting visual built from the recurring motif, and a layout rhythm that changes from the slide before (full-bleed picture, split, type-led) without breaking the system.",
    "Two typefaces at most, three sizes at most; tight tracking on headlines; text always high-contrast against what is behind it.",
  ];
}
