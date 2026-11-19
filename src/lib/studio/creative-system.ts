// creative-system.ts — Mellox's house creative standard (ADR-0052). Pure.
//
// Distilled from the posts Mellox shows on its own website
// (public/Home/wall): every one is built on ONE visual idea (a child's
// shadow is a caped hero for "fuel for the future", a vinyl record for a "CD
// mock" exam, a crane lifting a concrete block for "strength from the ground
// up", a burger riding a skateboard), set with bold, confident type and
// finished like a top agency's work.
//
// ADR-0051 round 2 banned visual metaphors and "stunts" for every post
// because a hiring post once came back as a surreal sculpture. That ban made
// every post safe and generic. Here the technique is gated by what the post
// is for instead: a hiring post stays plain and clear, a product, offer,
// launch, service or brand post may use a big idea.
//
// These are idea techniques, not layouts: the director weighs three, picks
// one and writes the picture itself. Ids are stored on posts: add, never
// rename.
import type { DeliverableId } from "./creative-knowledge";

export type TechniqueId =
  | "visual-metaphor"
  | "hero-drama"
  | "type-and-subject"
  | "symbolic-object"
  | "number-hero"
  | "object-pun"
  | "culture-tie"
  | "character-product"
  | "bold-statement"
  | "contrast"
  | "real-moment"
  | "clean-announcement"
  | "editorial-portrait";

export type Technique = {
  id: TechniqueId;
  label: string;
  /** How it works, said to the director. Brand-neutral; never names a brand. */
  how: string;
  /** One worked example of the idea, brand-neutral. */
  example: string;
};

export const TECHNIQUES: readonly Technique[] = [
  {
    id: "visual-metaphor",
    label: "Visual metaphor",
    how: "Show the benefit as one believable image that means more than it shows: an everyday scene with one twist that carries the message.",
    example:
      "A child drinks a glass of milk in a kitchen; behind him, his shadow on the red wall is a caped superhero. Headline: 'Fuel for the future'.",
  },
  {
    id: "hero-drama",
    label: "Hero product drama",
    how: "The product is the star, shot like a premium campaign: low angle or tight crop, dramatic light, motion or one surprising setting that says what it is like.",
    example:
      "A juicy burger riding a skateboard down a sunny street, motion blur on the road, low angle. Few or no words.",
  },
  {
    id: "type-and-subject",
    label: "Giant type with the subject",
    how: "A huge headline fills the frame and the subject sits in front of or between the letters, so type and picture are one layered composition with depth.",
    example:
      "Massive orange letters 'MADE FOR YOU' fill a cream poster; a hand slides a plated burger in front of them, the plate overlapping the letters.",
  },
  {
    id: "symbolic-object",
    label: "Symbolic object (for a service)",
    how: "A service is shown by one strong object that stands for its value (strength, speed, care, security, growth), photographed or rendered with drama on a bold field.",
    example:
      "A crane hook lifting a heavy concrete block against a clean white and orange design, for a builder: 'Strength from the ground up'.",
  },
  {
    id: "number-hero",
    label: "The number is the hero",
    how: "One real figure from the brief (a milestone, a price, a count) is set enormous, with one object that celebrates it (a trophy, a podium, a ribbon) and premium light.",
    example:
      "'1,000+' huge in chrome-white over a dark ground, a silver trophy on a dark rock lit in the brand colour, 'New users' beside it.",
  },
  {
    id: "object-pun",
    label: "Everyday object pun",
    how: "An object whose name or shape echoes the message becomes the layout: the details of the post are placed on it.",
    example:
      "A black vinyl record fills the top half for an exam called 'CD mock'; the date, time and branch sit on the record's label and grooves.",
  },
  {
    id: "culture-tie",
    label: "Culture tie-in",
    how: "Connect the brand to the moment everyone is talking about (a launch, a match, a season) through the brand's own world, with a wink. Never use the other side's logo, characters, artwork or name in a way that suggests a partnership.",
    example:
      "On a big game's launch day, a café's cup sits next to a controller at 3 a.m. under neon light: 'Your co-op partner tonight'.",
  },
  {
    id: "character-product",
    label: "Character with the product",
    how: "A stylised person (illustrated or photographed) holds or uses the product or app, confident and on-brand, on a bold single-colour field with the headline beside them.",
    example:
      "An illustrated woman in bold blue holds out a phone showing the app's real screen; 'Speed & Security you can trust' set big on the left.",
  },
  {
    id: "bold-statement",
    label: "Bold statement on colour",
    how: "Type carries the post: a strong line in a heavy condensed face on the brand colour, with one or two key words in the accent colour, a thin rule and one small graphic accent.",
    example:
      "'Strength starts from the foundation' in heavy white and orange condensed caps over a dark orange construction site at sunset, diagonal lines in a corner.",
  },
  {
    id: "contrast",
    label: "Contrast",
    how: "Two states side by side or top and bottom (before / after, them / us, problem / fix), one clear divider, the better state brighter.",
    example:
      "A dull, crumpled shirt on the left and the same shirt crisp on the right, split by one clean line.",
  },
  {
    id: "real-moment",
    label: "Real moment",
    how: "A believable photograph of the brand's real world (the people, the craft, the place) with a calm area for the headline.",
    example:
      "A barista's hands pouring latte art at a worn wooden counter, warm window light, the headline on the dark top third.",
  },
  {
    id: "clean-announcement",
    label: "Clean announcement",
    how: "A clear, well-designed announcement: the headline leads, the details are easy to scan, one supporting picture or object, generous space.",
    example:
      "'We're hiring two senior baristas' over a deep green band under a real photo of the bar, the branch and the date below.",
  },
  {
    id: "editorial-portrait",
    label: "Editorial portrait",
    how: "A strong, honest portrait of a real person (founder, team member, customer) lit like a magazine cover, with a short quote or line set editorially.",
    example:
      "The founder at their workbench, side light, looking at the camera; one line of their own words in a fine serif beside them.",
  },
];

const BY_ID = new Map(TECHNIQUES.map((t) => [t.id, t]));

export function techniqueById(id: string | null | undefined): Technique | null {
  return id ? (BY_ID.get(id as TechniqueId) ?? null) : null;
}

/** Big-idea techniques: offered only where a twist helps the post. */
const BIG_IDEAS: readonly TechniqueId[] = [
  "visual-metaphor",
  "hero-drama",
  "type-and-subject",
  "symbolic-object",
  "object-pun",
  "character-product",
  "contrast",
];

/**
 * Which techniques fit this kind of post. A hiring post, greeting or event
 * must be clear first, so it gets clean, plain techniques plus an object pun
 * (which carries details well). Selling, launch, service and brand posts get
 * every big idea. Order is the suggestion order.
 */
export function techniquesFor(args: {
  deliverable?: DeliverableId | null;
  /** The brand sells a service, not a physical product. */
  service?: boolean;
  /** A live trend or moment is part of this brief. */
  trend?: boolean;
}): Technique[] {
  const d = args.deliverable ?? "brand-moment";
  let ids: TechniqueId[];
  switch (d) {
    case "hiring":
      ids = ["clean-announcement", "real-moment", "bold-statement", "symbolic-object"];
      break;
    case "greeting":
      ids = ["visual-metaphor", "real-moment", "bold-statement", "type-and-subject"];
      break;
    case "event":
      ids = ["object-pun", "clean-announcement", "type-and-subject", "bold-statement"];
      break;
    case "milestone":
      ids = ["number-hero", "visual-metaphor", "bold-statement"];
      break;
    case "intro":
    case "case-study":
    case "quote":
      ids = ["editorial-portrait", "bold-statement", "real-moment", "symbolic-object"];
      break;
    case "tips":
    case "feature-board":
    case "comparison":
      ids = ["bold-statement", "contrast", "symbolic-object", "object-pun"];
      break;
    case "promo-offer":
      ids = ["number-hero", "hero-drama", "type-and-subject", "bold-statement"];
      break;
    case "launch":
    case "teaser":
      ids = [
        "hero-drama",
        "visual-metaphor",
        "symbolic-object",
        "type-and-subject",
        "character-product",
      ];
      break;
    case "product-hero":
      ids = ["hero-drama", "type-and-subject", "visual-metaphor", "character-product"];
      break;
    default:
      ids = args.service
        ? [
            "symbolic-object",
            "visual-metaphor",
            "bold-statement",
            "character-product",
            "type-and-subject",
          ]
        : [...BIG_IDEAS];
  }
  if (args.service && !ids.includes("symbolic-object")) ids.push("symbolic-object");
  if (args.trend) ids.unshift("culture-tie");
  return [...new Set(ids)].map((id) => BY_ID.get(id)!).filter(Boolean);
}

/** Posts that must read as clear information before they are clever. */
export function mustBeClear(deliverable?: DeliverableId | null): boolean {
  return deliverable === "hiring" || deliverable === "event" || deliverable === "greeting";
}

/**
 * The house craft every Mellox picture follows (learned from the wall posts).
 * Said to the director as guidance; it writes the picture itself.
 */
export const HOUSE_CRAFT: readonly string[] = [
  "One idea, one focal point. The picture says the brief in one second, before anyone reads a word.",
  "Type is designed, not placed: a bold, confident headline (heavy condensed sans or the brand's display face), set big with tight leading, one or two key words in the brand's accent colour, aligned to a clear grid with generous margins.",
  "At most one short supporting line (12 words or fewer) set small and quiet, well apart from the headline, plus only the details the brief needs (date, place, how to apply).",
  "Colour: one strong field from the brand's own hex colours (or a dark, premium ground), with the accent used sparingly. Never a beige template card, never muddy gradients.",
  "Finish like a top agency: cinematic, directional light, real materials, crisp detail, depth (foreground, subject, background). Photographs look like real photographs; 3D looks like a premium product render.",
  "One or two graphic accents at most, used with intent: a thin rule under the headline, a circle or arc, diagonal lines in a corner, a dot grid, or the brand's word repeated large as a texture.",
  "Leave clear, calm space for the brand logo, small, at the top (top-left or top-centre); never draw a logo yourself.",
];

/** The test the director scores its concepts on before picking one. */
export const CONCEPT_TEST =
  "Score each concept 1-10 on: would a top global brand post this (Apple, McDonald's, Nike level); does it stop the thumb; is the brief's point clear in one second; does it fit this brand's world. Pick the highest total; a concept that is clever but unclear loses.";

/** Lines for the director: the techniques that fit, the craft and the test. */
export function creativeSystemLines(args: {
  deliverable?: DeliverableId | null;
  service?: boolean;
  trend?: boolean;
}): string[] {
  const offered = techniquesFor(args);
  return [
    mustBeClear(args.deliverable)
      ? "This post must be clear first: the facts readable at a glance. Make it beautiful with craft, a strong photo or an object that carries the details, not with a puzzle."
      : "Great brand posts are built on one idea. Look for the twist that makes this brief memorable, then execute it simply and believably.",
    "Idea techniques that fit this post (consider them, pick the best for this brief):",
    ...offered.map((t) => `- ${t.id} (${t.label}): ${t.how} Example: ${t.example}`),
    "House craft:",
    ...HOUSE_CRAFT.map((rule) => `- ${rule}`),
  ];
}
