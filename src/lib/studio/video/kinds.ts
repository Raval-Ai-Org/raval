// The kinds of short video Studio makes, and how each one is planned. Pure
// and browser-safe: the composer's "Kind of video" cards, the storyboard
// prompt (prompts.ts), the render (runner.server.ts) and the checks all read
// this one table. Ids are stored on jobs: add a kind, never rename one.
//
// What a senior social media manager would brief: the right kind of video for
// the job, not one "branded marketing video" for everything. A post that is
// already good comes alive; a product gets a showcase; a story keeps one cast
// in one place; words that must be exact are drawn by code, never by a model.

import type { UgcModelKey } from "@/lib/ugc/models";

export type VideoKindId =
  | "living-picture"
  | "motion-post"
  | "product-showcase"
  | "brand-story"
  | "how-it-works"
  | "before-after"
  | "mood-broll"
  | "offer-teaser"
  | "product-motion"
  | "product-demo"
  | "broll-hook"
  | "motion-graphics";

/** How a kind's clips are put together. */
export type VideoJoin =
  /** One clip, never split. */
  | "single"
  /** Each clip starts from the last frame of the one before: the same subject throughout. */
  | "chain"
  /** Clips made at the same time and joined with a short dissolve (mood pieces). */
  | "cut"
  /** No model call: code moves the brand's own picture or slides (FFmpeg). */
  | "code";

export type VideoEnding =
  /** A clean hero frame, held, that also works as the cover. */
  | "hero-frame"
  /** Dissolves back into the exact post picture and holds it. */
  | "back-to-source"
  /** A card drawn by code with the brand's logo and exact words. */
  | "end-card";

export type VideoKind = {
  id: VideoKindId;
  label: string;
  /** One plain line for the composer card. */
  hint: string;
  join: VideoJoin;
  /** People the model may show: none added, hands only, one fixed cast, or as in the source. */
  people: "none" | "hands" | "cast" | "source" | "optional";
  /** Clips in the default length (each clip is the model's whole native length). */
  defaultClips: number;
  maxClips: number;
  ending: VideoEnding;
  /** Needs a finished post picture (or carousel slides) to start from. */
  needsSource?: boolean;
  /** Models in the order this kind prefers them. The first one the plan allows is used. */
  models: readonly UgcModelKey[];
  /**
   * Words on screen: none, one phrase per clip, or one hook line held over
   * the whole video (the B-roll reel). Always drawn by code, never by the model.
   */
  words?: "clip" | "hook";
  /** The craft rules for this kind, written as a director's brief. */
  rules: readonly string[];
};

export const VIDEO_KINDS: readonly VideoKind[] = [
  {
    id: "living-picture",
    label: "Bring a post to life",
    hint: "Your post, gently moving",
    // Longer takes continue from the exact last frame and settle back on the post.
    join: "chain",
    people: "source",
    defaultClips: 1,
    maxClips: 3,
    ending: "back-to-source",
    needsSource: true,
    models: ["standard", "premium", "draft"],
    rules: [
      "This is the post itself, alive: open on exactly the supplied picture as the first frame and keep its composition, product, colours, people and words.",
      "Choose one or two natural motions the picture suggests: a slow push in, gentle parallax, light sweeping across the product, steam, fabric, water, hair or leaves moving. Nothing new enters the frame.",
      "Words, logos and packaging text stay perfectly still and readable. Never re-letter, morph or add text.",
      "The camera never reveals a side of the product the picture does not show.",
      "The last second settles back to the opening framing, so the video ends on the post and loops.",
      "In a longer video each clip finds one new, gentle moment in the same picture (a closer detail, light moving, a slow drift) and the last clip returns to the post.",
    ],
  },
  {
    id: "product-motion",
    label: "Animate the product",
    hint: "Your product in motion, no people",
    join: "chain",
    people: "none",
    defaultClips: 3,
    maxClips: 4,
    ending: "back-to-source",
    models: ["standard", "draft"],
    rules: [
      "The product is the only subject: the same shape, colour, label and proportions as in the picture or product photo, in every shot. No people, faces or hands.",
      "Move like a premium product ad: a slow orbit that stops before the unseen side, a push in to a detail, light sweeping across the surface, the product turning on a surface, a rack focus from a texture to the whole product.",
      "Between hero shots, cut away to B-roll that belongs to the product's world: a macro of its texture or material, an ingredient or part, the place it is used, steam, water, fabric or light reacting to it. Every B-roll shot keeps the same palette and light.",
      "Labels, logos and printed words stay perfectly still and readable; never re-letter or add text.",
      "End on the hero frame: the product centred and still, matching the opening picture, so the video can loop.",
    ],
  },
  {
    id: "motion-post",
    label: "Motion post",
    hint: "Smooth moves over your post, no AI",
    join: "code",
    people: "none",
    defaultClips: 1,
    maxClips: 1,
    ending: "back-to-source",
    needsSource: true,
    models: [],
    rules: [],
  },
  {
    id: "product-showcase",
    label: "Product showcase",
    hint: "Close-ups and reveals of one product",
    join: "chain",
    people: "hands",
    defaultClips: 3,
    maxClips: 4,
    ending: "hero-frame",
    models: ["premium", "standard", "draft"],
    rules: [
      "One product is the hero of every shot and looks exactly like the supplied product photo: the same shape, colour, label and proportions in every clip.",
      "Shots a product film is made of: a reveal from shadow or from behind something, a macro slide along a detail or texture, a slow orbit that stops before the unseen side, the product in a hand or in use, a pour, press, open or click.",
      "Hands only, never a face. A clean set that suits the brand, one light direction kept in every clip.",
      "Each clip shows one new angle or detail; never repeat the reveal.",
      "End on the hero frame: the product centred, lit, still and held, with room above for the brand.",
    ],
  },
  {
    id: "brand-story",
    label: "Short story",
    hint: "A tiny story with one person and one place",
    join: "chain",
    people: "cast",
    defaultClips: 3,
    maxClips: 4,
    ending: "hero-frame",
    models: ["premium", "standard", "draft"],
    rules: [
      "A complete story in three moves: a relatable moment or problem, the moment the brand helps, the payoff. Every clip moves the story on; none starts it again.",
      "One cast, described once in the bible and kept identical in every clip: the same face, hair, clothes and age. One place and one time of day.",
      "People are fictional and act naturally: no talking to camera, no dialogue unless a script was supplied.",
      "The product or service appears in the middle move, used the way a real customer would.",
      "The last clip ends on the payoff: a calm, resolved frame held for a second, never mid-action.",
    ],
  },
  {
    id: "how-it-works",
    label: "How it works",
    hint: "Three to five clear steps",
    join: "chain",
    people: "hands",
    defaultClips: 3,
    maxClips: 4,
    ending: "hero-frame",
    models: ["standard", "premium", "draft"],
    rules: [
      "Three to five steps in order, one action per step, each step clearly finished before the next begins.",
      "The same hands, tools, surface and light from the first step to the last, shot mostly from one steady angle so the steps can be followed.",
      "Start on the satisfying result for one second as the hook, then go back to step one.",
      "End on the finished result, held still.",
    ],
  },
  {
    id: "before-after",
    label: "Before and after",
    hint: "One clear change, then the result",
    join: "chain",
    people: "optional",
    defaultClips: 2,
    maxClips: 2,
    ending: "hero-frame",
    models: ["standard", "premium", "draft"],
    rules: [
      "Before and after are the same place, framing and light, so only the change itself is different.",
      "The before is shown briefly and honestly; the change happens in one motivated move (a wipe, a pass of the hand, a pull back).",
      "Show only a change the brand really offers; never exaggerate the result.",
      "End on the after, held still for a second.",
    ],
  },
  {
    id: "mood-broll",
    label: "Mood",
    hint: "The feeling of your brand, shot by shot",
    join: "cut",
    people: "optional",
    defaultClips: 3,
    maxClips: 4,
    ending: "hero-frame",
    models: ["standard", "premium", "draft"],
    rules: [
      "Atmosphere over story: textures, light, places and small moments that feel like the brand.",
      "Every clip shares one palette, one light quality and one lens look, so the clips cut together as one film.",
      "People, if any, are seen from behind, in silhouette or in detail; no faces that must match between clips.",
      "Each clip ends on a still moment, so the dissolve between clips is calm.",
    ],
  },
  {
    id: "product-demo",
    label: "Product demo",
    hint: "Hands show what it does, one feature at a time",
    join: "chain",
    people: "hands",
    defaultClips: 2,
    maxClips: 3,
    ending: "hero-frame",
    models: ["standard", "premium", "draft"],
    rules: [
      "Show the product doing what it really does, the way a customer uses it: open, press, pour, apply, wear, plug in, switch on. One feature per shot, each one visibly working.",
      "Only features, results and parts the product facts state. If the facts don't say it does something, it is not shown doing it.",
      "The product looks exactly like its photo in every shot: the same shape, colour, label and size relative to the hands.",
      "Hands only, never a face. One clean surface or one real place of use, one light direction, mostly close and steady so every action can be followed.",
      "Open on the most satisfying moment of use as the hook, then show the features in order, then end on the product at rest, its label to camera, held.",
    ],
  },
  {
    id: "broll-hook",
    label: "B-roll with a hook",
    hint: "Aesthetic shots of your world, one line of text on top",
    // Quick, separate shots joined with cuts: the Reels format where the
    // words carry the message and the footage carries the feeling.
    join: "cut",
    people: "optional",
    defaultClips: 2,
    maxClips: 3,
    ending: "hero-frame",
    models: ["standard", "draft"],
    words: "hook",
    rules: [
      "This is a text-on-B-roll reel: one line of words sits over the whole video and says the message; the footage is beautiful, calm B-roll that makes people stop and read.",
      "Every shot is B-roll from the brand's real world: the product in its place, a macro of its texture or material, an ingredient or part, hands at work, the space, light moving across a surface, steam, pouring, wrapping. Never a person posing for the camera.",
      "Several short shots per clip (two to three seconds each), each a different angle or detail, all in one palette, one light quality and one lens look so they cut together.",
      "Keep the middle of the frame calm and uncluttered, where the words sit; the action happens around it.",
      "No words, signs, screens or labels that must be read in the footage, apart from the product's own label.",
    ],
  },
  {
    id: "offer-teaser",
    label: "Offer",
    hint: "Moving shots, then your offer in exact words",
    join: "chain",
    people: "optional",
    defaultClips: 2,
    maxClips: 3,
    ending: "end-card",
    models: ["standard", "premium", "draft"],
    rules: [
      "Fast, bright, desirable shots of what the offer is for. The offer's words are not drawn in the video: Mellox adds them on a card at the end, exactly as written.",
      "No numbers, prices, dates or percentages on screen in the footage.",
      "End on a calm frame with plenty of empty space, so the offer card follows it smoothly.",
    ],
  },
  {
    // Designed by Opus as HTML/SVG + CSS, checked and drawn frame by frame by
    // code (src/server/studio/motion/, ADR-0043). No video model.
    id: "motion-graphics",
    label: "Motion graphics",
    hint: "Animated type and shapes, words always exact",
    join: "code",
    people: "none",
    defaultClips: 1,
    maxClips: 1,
    ending: "hero-frame",
    models: [],
    rules: [],
  },
];

const BY_ID = new Map(VIDEO_KINDS.map((kind) => [kind.id, kind]));

export const VIDEO_KIND_IDS = VIDEO_KINDS.map((kind) => kind.id) as readonly VideoKindId[];

export function isVideoKind(value: unknown): value is VideoKindId {
  return typeof value === "string" && BY_ID.has(value as VideoKindId);
}

export function videoKind(id: VideoKindId): VideoKind {
  return BY_ID.get(id)!;
}

/** The Studio video templates, each made as one kind. Absent: picked from the brief. */
const TEMPLATE_KIND: Record<string, VideoKindId> = {
  "video-product-reveal": "product-showcase",
  "video-process": "how-it-works",
  "video-transformation": "before-after",
  "video-mood-broll": "mood-broll",
  "video-in-use": "brand-story",
  "video-offer-teaser": "offer-teaser",
  "video-place-tour": "mood-broll",
  "video-unboxing": "product-showcase",
  "video-demo": "product-demo",
  "video-broll-hook": "broll-hook",
};

export function kindForTemplate(template: string | undefined): VideoKindId | null {
  return (template && TEMPLATE_KIND[template]) || null;
}

// Narrow on purpose: "handmade", "made with love", "bring it to life" or
// "the result" must never turn a product video into a tutorial or a story.
const HOW = /\b(how to|how it works|step[- ]by[- ]step|steps|tutorial|recipe|process)\b/i;
const BEFORE = /\b(before (and|&) after|transformation|makeover|glow[- ]up)\b/i;
const OFFER = /\b(sale|discount|offer|deal|% ?off|promo|coupon|free shipping|limited time)\b/i;
const MOOD = /\b(mood|vibe|atmosphere|ambien\w*|tour)\b/i;
/** The Reels format: aesthetic footage with a line of text over it. */
const BROLL =
  /\b(b-?roll|aesthetic|text (on|over)|with (a )?text|pov|things (you|nobody|no one)|reasons (to|why)|tips?)\b/i;
/** The brief asks to see the product working. */
const DEMO =
  /\b(demo|demonstrat\w*|in action|how (it|to) use|show (how|what) it|features?|use it|using it)\b/i;
const STORY = /\b(story|day in the life|customers?|when you|pov)\b/i;
const ANIMATE =
  /\b(animate|animation|bring (it|this|my \w+) to life|in motion|moving|spin|rotate|360)\b/i;
/** The brief asks for someone on screen. */
const ASKS_FOR_PEOPLE =
  /\b(person|people|man|woman|men|women|girl|boy|guy|lady|creator|influencer|face|presenter|talking|testimonial|founder|team|family|friends?|kids?|child(ren)?|couple|someone|customers?|users?|clients?)\b/i;

export type KindSource = {
  /** The video starts from a finished post picture. */
  picture?: boolean;
  /** The source is a carousel with drawn slides. */
  carousel?: boolean;
  /** A catalogue product is featured. */
  product?: boolean;
  /** A reviewed script is the source. */
  script?: boolean;
};

/**
 * The kind a video is made as when the person left "Auto". A post's picture
 * comes alive; a carousel moves by code; otherwise the brief decides.
 */
export function pickVideoKind(
  brief: string,
  source: KindSource = {},
  template?: string,
): VideoKindId {
  const fromTemplate = kindForTemplate(template);
  if (fromTemplate) return fromTemplate;
  if (source.carousel) return "motion-post";
  // A product's picture becomes a product film; any other picture comes alive.
  if (source.picture) return source.product ? "product-motion" : "living-picture";
  if (source.script) return "brand-story";
  if (OFFER.test(brief)) return "offer-teaser";
  if (BEFORE.test(brief)) return "before-after";
  if (DEMO.test(brief)) return "product-demo";
  if (HOW.test(brief)) return "how-it-works";
  if (ANIMATE.test(brief)) return "product-motion";
  if (BROLL.test(brief)) return "broll-hook";
  if (STORY.test(brief)) return "brand-story";
  if (MOOD.test(brief)) return "mood-broll";
  if (source.product && ASKS_FOR_PEOPLE.test(brief)) return "product-showcase";
  return "product-motion";
}

/** A chosen kind that can't run without its source falls back to one that can (never a cast story). */
export function usableKind(kind: VideoKindId, source: KindSource): VideoKindId {
  const spec = videoKind(kind);
  if (!spec.needsSource || source.picture || source.carousel) return kind;
  return "product-motion";
}

export type PeopleRule = VideoKind["people"];

const ASKS_FOR_VOICE =
  /\b(voice ?-?over|vo|narrat\w*|narrator|voice|spoken|explain\w*|tell (them|people|viewers))\b/i;

/** A spoken voiceover is planned only when the brief, a script or the followed reference has one. */
export function wantsVoiceover(args: {
  brief?: string;
  script?: boolean;
  reference?: { voice?: boolean };
}): boolean {
  return Boolean(args.script || args.reference?.voice || ASKS_FOR_VOICE.test(args.brief ?? ""));
}

/**
 * Who may be on screen. Nobody is added unless someone asked: the person
 * chose the kind, the brief names a person, the picture already has them, or
 * the Inspo reference the video follows shows people. Code decides; the
 * storyboard and the render only follow.
 */
export function peoplePolicy(
  kind: VideoKindId,
  args: {
    brief?: string;
    /** The person picked this kind themselves (not Auto). */
    chosen?: boolean;
    /** The Inspo reference video's own rule, when the video follows one. */
    reference?: "none" | "people";
  } = {},
): PeopleRule {
  const spec = videoKind(kind);
  if (spec.people === "none" || spec.people === "source") return spec.people;
  if (args.reference === "none") return spec.people === "cast" ? "hands" : "none";
  const asked = ASKS_FOR_PEOPLE.test(args.brief ?? "") || args.reference === "people";
  if (spec.people === "hands") return "hands";
  if (spec.people === "cast") return asked || args.chosen ? "cast" : "hands";
  return asked ? "optional" : "hands";
}

/** Economy, Standard and Premium are the Studio choices; the rest belong to UGC. */
export const STUDIO_VIDEO_MODEL_KEYS = ["draft", "standard", "premium"] as const;
export type StudioVideoModelKey = (typeof STUDIO_VIDEO_MODEL_KEYS)[number];

/** A Studio video with no model chosen is made on this one. */
export const DEFAULT_STUDIO_VIDEO_MODEL: StudioVideoModelKey = "standard";

/**
 * The model a Studio video is made on: the person's choice when there is
 * one, else the kind's first preference the plan allows, else the default.
 * `allowed` answers whether the plan sells a model (the server still checks).
 */
export function studioVideoModelFor(
  kind: VideoKindId,
  requested: UgcModelKey | undefined,
  allowed: (key: UgcModelKey) => boolean = () => true,
): UgcModelKey {
  if (requested) return requested;
  const preferred = videoKind(kind).models.find((key) => key !== "premium" && allowed(key));
  return preferred ?? DEFAULT_STUDIO_VIDEO_MODEL;
}

/** The model a kind recommends when the plan allows it (shown as "Recommended"). */
export function recommendedModel(
  kind: VideoKindId,
  allowed: (key: UgcModelKey) => boolean = () => true,
): UgcModelKey {
  return videoKind(kind).models.find(allowed) ?? DEFAULT_STUDIO_VIDEO_MODEL;
}
