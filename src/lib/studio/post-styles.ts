// post-styles.ts — the kinds of picture posts and carousels strong brands
// really publish on each network, picked by code from the brief and the
// platform (ADR-0051, round 2). Pure, browser-safe.
//
// Round 1 staged every post on a campaign-stunt layout (a monument-sized
// object, a miniature diorama, a portal pop-out, a mirror kaleidoscope).
// Those make striking ads but weird feed posts: a hiring post or a tip came
// back as a surreal sculpture. These styles are what people see in a good
// brand's Instagram or LinkedIn feed today: a real photo, a photo with a
// headline, a bold type post, a clean announcement, a product on a set.
// Ids are stored on posts (`output.postStyle`, `meta.art_direction`): add,
// never rename.
import type { DeliverableId } from "./creative-knowledge";

export type StylePlatform =
  | "instagram"
  | "facebook"
  | "linkedin"
  | "tiktok"
  | "pinterest"
  | "threads"
  | "twitter"
  | "youtube";

export type PostStyleId =
  | "photo-first"
  | "photo-headline"
  | "type-poster"
  | "announcement-card"
  | "product-spotlight"
  | "offer-post"
  | "quote-card"
  | "tip-card"
  | "statement-card"
  | "greeting-card"
  | "candid-team"
  | "side-by-side";

export type PostStyle = {
  id: PostStyleId;
  name: string;
  /** One line for the writer's menu: what it is and when it works. */
  line: string;
  /** How the picture is made, said to the image model. */
  picture: string;
  /** Where the words go and how much there is. */
  words: string;
  /** "photo": a real-looking photograph; "design": a designed graphic; "mixed": both. */
  medium: "photo" | "design" | "mixed";
  /** How many supporting lines it carries at most (besides the headline). */
  maxLines: number;
  /** What the brief asks for that this style serves well, best first. */
  serves: readonly DeliverableId[];
  /** How well it fits each network (0 = never, 3 = what the network rewards). */
  fit: Partial<Record<StylePlatform, number>>;
  /** Needs a physical product to show. */
  needsProduct?: boolean;
};

const PHOTO_REAL =
  "Photographic and real: it must look like a photo a skilled photographer took for the brand (real materials, real light, natural colour, true-to-life detail), never a 3D render, a plastic CGI look or an illustration.";

export const POST_STYLES: readonly PostStyle[] = [
  {
    id: "photo-headline",
    name: "Photo with a headline",
    line: "A strong real photo from the brand's world with a short bold headline set on a calm part of it, like a magazine cover. Works for almost anything.",
    picture: `One strong real photo of the subject in its real setting, composed with clear open space (sky, wall, table, plain background) where the headline sits. ${PHOTO_REAL}`,
    words:
      "The headline is big and bold in the open space (top or bottom third), with at most one small supporting line under it.",
    medium: "photo",
    maxLines: 1,
    serves: [
      "launch",
      "brand-moment",
      "product-hero",
      "event",
      "market-entry",
      "milestone",
      "teaser",
      "tips",
    ],
    fit: {
      instagram: 3,
      facebook: 3,
      linkedin: 2,
      tiktok: 3,
      pinterest: 3,
      threads: 2,
      twitter: 2,
      youtube: 2,
    },
  },
  {
    id: "photo-first",
    name: "The photo is the post",
    line: "A beautiful, natural photo with almost no text (a tiny headline or none). The most native Instagram post; best when the picture says it all.",
    picture: `One beautiful, natural photo of the brand's real world: the product in real use, the place, the craft or the people at work, framed like the best posts on a creator's feed. ${PHOTO_REAL} Calm, uncluttered composition with one clear subject.`,
    words:
      "Few or no words: at most a small, elegant headline in a corner or along the bottom, never covering the subject.",
    medium: "photo",
    maxLines: 0,
    serves: ["brand-moment", "product-hero", "teaser", "intro", "greeting"],
    fit: {
      instagram: 3,
      facebook: 2,
      linkedin: 1,
      tiktok: 2,
      pinterest: 3,
      threads: 2,
      twitter: 1,
      youtube: 1,
    },
  },
  {
    id: "type-poster",
    name: "Bold type post",
    line: "The words are the design: a big headline filling most of the frame on the brand's colour, with one small photo or graphic detail. Great for tips, opinions, news and launches.",
    picture:
      "A designed typographic post on a solid or softly textured background in the brand's main colour, with one small supporting element (a small real photo cut-out, a simple shape or an icon from the brand's world) placed so it never competes with the words.",
    words:
      "The headline is huge (it fills 40 to 60% of the frame), set in a confident display face with tight leading; one short supporting line small below it.",
    medium: "design",
    maxLines: 1,
    serves: ["tips", "launch", "humour", "intro", "teaser", "milestone", "mix-up", "quote"],
    fit: {
      instagram: 3,
      facebook: 2,
      linkedin: 3,
      tiktok: 2,
      pinterest: 1,
      threads: 3,
      twitter: 3,
      youtube: 1,
    },
  },
  {
    id: "announcement-card",
    name: "Announcement card",
    line: "A clean, structured news post: small label, big headline, the key details (role, date, place) and how to act, with one supporting picture from the brand's world. Best for hiring, events, launches and news.",
    picture:
      "A clean, professional announcement design: a brand-colour background or a crisp split with one real photo from the brand's world (the place, the team at work, the product), a clear grid, generous margins and a neat hierarchy, like a well-designed company announcement.",
    words:
      "Reading order top to bottom: small label, big headline, two or three short detail lines (each fact on its own line), then a small button-style action at the bottom.",
    medium: "mixed",
    maxLines: 3,
    serves: ["hiring", "event", "launch", "market-entry", "collab", "milestone", "promo-offer"],
    fit: {
      instagram: 3,
      facebook: 3,
      linkedin: 3,
      tiktok: 1,
      pinterest: 1,
      threads: 2,
      twitter: 2,
      youtube: 1,
    },
  },
  {
    id: "product-spotlight",
    name: "Product spotlight",
    line: "The product, sharp and beautiful, on a clean coloured set or a real surface, with its name or a short promise and one benefit. For a post about one product.",
    picture: `The real product as the clear hero, large in the frame, on a clean seamless colour set from the brand's palette or on a real surface (stone, wood, linen) with one or two simple props that belong to it, soft natural studio light and a gentle shadow. ${PHOTO_REAL}`,
    words:
      "A short headline above or beside the product, never over it, and at most one small benefit line.",
    medium: "photo",
    maxLines: 1,
    needsProduct: true,
    serves: ["product-hero", "launch", "feature-board", "promo-offer"],
    fit: {
      instagram: 3,
      facebook: 3,
      linkedin: 1,
      tiktok: 2,
      pinterest: 3,
      threads: 1,
      twitter: 1,
      youtube: 1,
    },
  },
  {
    id: "offer-post",
    name: "Offer post",
    line: "The offer itself is the hero (for example the discount from the brief, in huge type) next to the product or a brand photo, with the condition and the action. Only for a real offer the brief states.",
    picture:
      "A bold, clean sale design: the offer set as the largest element, beside a real photo of the product or the brand's world, on a strong brand-colour background with high contrast.",
    words:
      "The offer (figure and word, exactly as the brief states it) is the biggest thing; a short line with the condition or end date; a button-style action.",
    medium: "mixed",
    maxLines: 2,
    serves: ["promo-offer"],
    fit: {
      instagram: 3,
      facebook: 3,
      linkedin: 1,
      tiktok: 2,
      pinterest: 2,
      threads: 1,
      twitter: 2,
      youtube: 1,
    },
  },
  {
    id: "quote-card",
    name: "Quote card",
    line: "A real quote or testimonial from the brief, set large and elegant, with who said it. Only for words someone really said.",
    picture:
      "An elegant quote design on a calm brand-colour or soft textured background, a large quotation mark as the only ornament, lots of space.",
    words: "The quote is large and centred; the name line small under it.",
    medium: "design",
    maxLines: 1,
    serves: ["quote", "case-study", "milestone"],
    fit: {
      instagram: 2,
      facebook: 2,
      linkedin: 3,
      tiktok: 1,
      pinterest: 2,
      threads: 2,
      twitter: 2,
      youtube: 1,
    },
  },
  {
    id: "tip-card",
    name: "Tip card",
    line: "A clean, saveable card: a headline plus two or three short points with small icons or numbers. For tips, how-tos and 'what's inside'.",
    picture:
      "A clean, saveable info design on the brand's background colour: a clear headline at the top, then two or three short points in a neat column, each with a small number or simple line icon, plus one small real photo or illustration of the subject.",
    words:
      "Headline at the top; each point is one short line (2 to 6 words) on its own row, numbered or with a small icon.",
    medium: "design",
    maxLines: 3,
    serves: ["tips", "feature-board", "comparison", "mix-up"],
    fit: {
      instagram: 3,
      facebook: 2,
      linkedin: 3,
      tiktok: 1,
      pinterest: 3,
      threads: 2,
      twitter: 2,
      youtube: 1,
    },
  },
  {
    id: "statement-card",
    name: "Statement card",
    line: "One honest, relatable sentence on a plain colour, like a thought shared by a person. For opinions, light humour and 'who we are' posts.",
    picture:
      "A minimal text card: a plain or lightly textured background in one brand colour, nothing else but the sentence and the brand's name very small at the bottom. Calm and personal, not salesy. No app interface, no fake buttons.",
    words: "The sentence is centred, medium-large, left-aligned or centred in a clean text face.",
    medium: "design",
    maxLines: 0,
    serves: ["humour", "intro", "teaser", "mix-up"],
    fit: {
      instagram: 2,
      facebook: 2,
      linkedin: 2,
      tiktok: 2,
      pinterest: 0,
      threads: 3,
      twitter: 3,
      youtube: 0,
    },
  },
  {
    id: "greeting-card",
    name: "Greeting",
    line: "A warm, beautiful scene or illustration for the occasion with the greeting in elegant type and the brand small. Never selling.",
    picture:
      "A warm, beautiful image for the occasion: its real symbols and colours (for example lanterns and a crescent for Eid, lights for a festival), softly lit, calm, with plenty of space. Respectful and premium, never cheesy clip-art.",
    words: "The greeting in elegant type in the open space; the brand name small. No sales line.",
    medium: "mixed",
    maxLines: 1,
    serves: ["greeting"],
    fit: {
      instagram: 3,
      facebook: 3,
      linkedin: 2,
      tiktok: 2,
      pinterest: 2,
      threads: 2,
      twitter: 2,
      youtube: 1,
    },
  },
  {
    id: "candid-team",
    name: "Behind the scenes",
    line: "A candid, documentary photo of the people or the work behind the brand, with a short caption band. For team, culture, process, milestones and hiring.",
    picture: `A candid documentary photo of real work happening: hands at work, the workspace, the team in action, natural available light and a little grain, never posed stock smiles. ${PHOTO_REAL}`,
    words:
      "A short headline in a clean band or on a calm area at the bottom or top, never over faces.",
    medium: "photo",
    maxLines: 1,
    serves: ["hiring", "intro", "milestone", "case-study", "brand-moment"],
    fit: {
      instagram: 3,
      facebook: 3,
      linkedin: 3,
      tiktok: 2,
      pinterest: 1,
      threads: 2,
      twitter: 1,
      youtube: 1,
    },
  },
  {
    id: "side-by-side",
    name: "Side by side",
    line: "Two halves compared at a glance (this or that, before and after, myth and truth), each with a short label.",
    picture:
      "A clean split design: two halves of equal weight, each with one clear photo or visual, separated by a crisp line or colour change.",
    words: "A short label on each half and an optional headline across the top.",
    medium: "mixed",
    maxLines: 2,
    serves: ["comparison", "mix-up"],
    fit: {
      instagram: 2,
      facebook: 2,
      linkedin: 2,
      tiktok: 1,
      pinterest: 2,
      threads: 1,
      twitter: 2,
      youtube: 1,
    },
  },
];

const BY_ID = new Map(POST_STYLES.map((s) => [s.id, s]));

export function postStyleById(id: unknown): PostStyle | null {
  return typeof id === "string" ? (BY_ID.get(id as PostStyleId) ?? null) : null;
}

export function stylePlatform(platform: string | null | undefined): StylePlatform {
  const p = (platform ?? "").toLowerCase();
  return (
    [
      "instagram",
      "facebook",
      "linkedin",
      "tiktok",
      "pinterest",
      "threads",
      "twitter",
      "youtube",
    ] as const
  ).includes(p as StylePlatform)
    ? (p as StylePlatform)
    : "instagram";
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * The styles that fit this brief on this network, best first. Deterministic for
 * a seed; never a style the brand used in its last two posts unless nothing
 * else fits; never a product style without a product, never an offer or quote
 * style when the brief has no offer or quote.
 */
export function pickPostStyles(args: {
  deliverable: DeliverableId;
  platform?: string | null;
  physicalProduct?: boolean;
  productAsked?: boolean;
  /** The brief states a figure (an offer needs one). */
  hasFacts?: boolean;
  /** The brief quotes someone's words. */
  hasQuote?: boolean;
  recent?: readonly (string | null | undefined)[];
  seed?: string;
  limit?: number;
}): PostStyle[] {
  const platform = stylePlatform(args.platform);
  const recent = new Set((args.recent ?? []).slice(0, 2).filter(Boolean) as string[]);
  const seed = args.seed ?? "";
  const scored = POST_STYLES.filter((s) => {
    if (
      s.needsProduct &&
      !(args.physicalProduct && (args.productAsked || s.serves[0] === args.deliverable))
    )
      return false;
    if (s.id === "offer-post" && (args.deliverable !== "promo-offer" || !args.hasFacts))
      return false;
    if (s.id === "quote-card" && !args.hasQuote && args.deliverable !== "quote") return false;
    if (s.id === "greeting-card" && args.deliverable !== "greeting") return false;
    if (s.id === "side-by-side" && !["comparison", "mix-up"].includes(args.deliverable))
      return false;
    return (s.fit[platform] ?? 1) > 0;
  }).map((s) => {
    const rank = s.serves.indexOf(args.deliverable);
    const serve = rank < 0 ? 0 : 6 - Math.min(rank, 3);
    const fit = (s.fit[platform] ?? 1) * 2;
    const fresh = recent.has(s.id) ? -4 : 0;
    const jitter = (hash(`${seed}:${s.id}`) % 100) / 100;
    return { s, score: serve + fit + fresh + jitter };
  });
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, args.limit ?? 3)
    .map((x) => x.s);
}

/** The writer's menu: a few styles that fit, best first. */
export function postStyleMenu(styles: readonly PostStyle[]): string {
  return styles.map((s) => `- ${s.id}: ${s.name}. ${s.line}`).join("\n");
}

// ---------------------------------------------------------------------------
// Carousels

export type CarouselStyleId = "editorial-text" | "photo-story" | "step-by-step" | "product-tour";

export type CarouselStyle = {
  id: CarouselStyleId;
  name: string;
  /** For the writer: how the slides look, so the words and visuals fit. */
  writer: string;
  /** For the image model, per position. */
  cover: string;
  middle: string;
  last: string;
  medium: "photo" | "design" | "mixed";
  serves: readonly DeliverableId[];
  fit: Partial<Record<StylePlatform, number>>;
  needsProduct?: boolean;
};

export const CAROUSEL_STYLES: readonly CarouselStyle[] = [
  {
    id: "editorial-text",
    name: "Editorial text carousel",
    writer:
      "Clean, saveable text slides like the best educational carousels on Instagram and LinkedIn: one idea per slide, a big heading and one or two short lines. Each slide's visual is one small supporting photo or icon, never a scene.",
    cover:
      "The cover is a bold type-led poster: the headline very large on the brand's main colour, with one real photo or a simple graphic from the brand's world beside or under it, and a small 'swipe' arrow at the bottom right.",
    middle:
      "An inside slide on the same background as the cover: a small slide number at the top, the heading large in the same place on every slide, the short lines under it, and one small supporting photo, icon or simple diagram. Calm, generous margins, nothing decorative.",
    last: "The last slide is calm and type-led on the same background: the takeaway as the heading and the action as a clear button-style line.",
    medium: "design",
    serves: [
      "tips",
      "feature-board",
      "comparison",
      "mix-up",
      "case-study",
      "intro",
      "brand-moment",
    ],
    fit: {
      instagram: 3,
      linkedin: 3,
      facebook: 2,
      tiktok: 2,
      pinterest: 2,
      threads: 2,
      twitter: 2,
      youtube: 1,
    },
  },
  {
    id: "photo-story",
    name: "Photo story carousel",
    writer:
      "A story told in real photos, like a creator's photo carousel: every slide is one real photo of a moment (the place, the work, the product in use, the people), with a short caption line set on it. Each slide's visual names exactly what its photo shows; headings stay short (2 to 6 words).",
    cover:
      "The cover is the strongest real photo of the set, with the headline big on a calm part of it.",
    middle:
      "An inside slide: one real, natural photo of this slide's moment filling the frame, with the heading as a short caption line in the same position and size on every slide (a clean band or a calm area), and the short line small under it if there is one.",
    last: "The last slide is a calm real photo with lots of open space and the action in clear type.",
    medium: "photo",
    serves: [
      "brand-moment",
      "case-study",
      "intro",
      "milestone",
      "event",
      "launch",
      "hiring",
      "market-entry",
    ],
    fit: {
      instagram: 3,
      tiktok: 3,
      facebook: 3,
      linkedin: 2,
      pinterest: 2,
      threads: 2,
      twitter: 1,
      youtube: 1,
    },
  },
  {
    id: "step-by-step",
    name: "Step-by-step carousel",
    writer:
      "A how-to: the cover promises the result, each inside slide is one step (a big step number, the step as a short heading, one line), and its visual shows that step being done. The last slide shows the result and the action.",
    cover:
      "The cover shows the finished result as a real photo with the headline big on a calm area.",
    middle:
      "An inside slide: a large step number in the brand's accent colour in the same corner on every slide, the step heading beside it, and one clear real photo or simple illustration of this step being done. Clean background, same grid every slide.",
    last: "The last slide shows the finished result and the action in clear type.",
    medium: "mixed",
    serves: ["tips"],
    fit: {
      instagram: 3,
      tiktok: 3,
      pinterest: 3,
      linkedin: 2,
      facebook: 2,
      threads: 1,
      twitter: 1,
      youtube: 1,
    },
  },
  {
    id: "product-tour",
    name: "Product tour carousel",
    writer:
      "A tour of one product: the cover shows it whole, each inside slide zooms on one real feature or benefit with a short heading, the last slide gives the action. Only features the brand states.",
    cover:
      "The cover is the real product as the hero on a clean colour set, with the headline big above or beside it, never over it.",
    middle:
      "An inside slide: a close, real photo of one part or use of the product on the same colour set, the heading in the same place on every slide, and a thin callout line pointing at the detail it names.",
    last: "The last slide shows the whole product again, smaller, with the action in clear type.",
    medium: "photo",
    needsProduct: true,
    serves: ["product-hero", "launch", "feature-board"],
    fit: {
      instagram: 3,
      facebook: 3,
      pinterest: 3,
      tiktok: 2,
      linkedin: 1,
      threads: 1,
      twitter: 1,
      youtube: 1,
    },
  },
];

const CAROUSEL_BY_ID = new Map(CAROUSEL_STYLES.map((s) => [s.id, s]));

export function carouselStyleById(id: unknown): CarouselStyle | null {
  return typeof id === "string" ? (CAROUSEL_BY_ID.get(id as CarouselStyleId) ?? null) : null;
}

/** The one carousel style for this brief on this network (code decides). */
export function pickCarouselStyle(args: {
  deliverable: DeliverableId;
  platform?: string | null;
  physicalProduct?: boolean;
  productAsked?: boolean;
  /** Text of the brief: "how to", "steps" makes it a step-by-step. */
  brief?: string;
  seed?: string;
}): CarouselStyle {
  const platform = stylePlatform(args.platform);
  const brief = (args.brief ?? "").toLowerCase();
  if (/\b(how to|step[- ]by[- ]step|steps?\b|guide|tutorial|recipe)\b/.test(brief))
    return CAROUSEL_BY_ID.get("step-by-step")!;
  if (args.productAsked && args.physicalProduct) return CAROUSEL_BY_ID.get("product-tour")!;
  const scored = CAROUSEL_STYLES.filter(
    (s) =>
      !(s.needsProduct && !(args.physicalProduct && args.productAsked)) && s.id !== "step-by-step",
  ).map((s) => {
    const rank = s.serves.indexOf(args.deliverable);
    const serve = rank < 0 ? 0 : 6 - Math.min(rank, 3);
    const jitter = (hash(`${args.seed ?? ""}:${s.id}`) % 100) / 100;
    return { s, score: serve + (s.fit[platform] ?? 1) * 2 + jitter };
  });
  return scored.sort((a, b) => b.score - a.score)[0]?.s ?? CAROUSEL_STYLES[0];
}

// ---------------------------------------------------------------------------
// Surprise me: what brands really post, so a brief needs no settings.

export type SurpriseIdeaId =
  | "product-spotlight"
  | "how-to"
  | "behind-the-scenes"
  | "customer-benefit"
  | "faq"
  | "meet-the-brand"
  | "occasion"
  | "offer"
  | "trend"
  | "founder-story"
  | "service-object"
  | "myth-truth"
  | "brand-idea";

export type SurpriseIdea = {
  id: SurpriseIdeaId;
  /** Said to the brief writer: the kind of post and what it does. */
  line: string;
};

export const SURPRISE_IDEAS: readonly SurpriseIdea[] = [
  {
    id: "product-spotlight",
    line: "A product spotlight: one real product or service the brand sells, what it is and the one benefit that matters most to its customers. Start the Idea with 'A product spotlight on <its name>'.",
  },
  {
    id: "how-to",
    line: "A useful tip or how-to from the brand's own expertise that its customers can use today (saveable). Start the Idea with 'A tip post:' or 'How to'.",
  },
  {
    id: "behind-the-scenes",
    line: "A behind-the-scenes look at how the brand makes or does its work (the craft, the place, the people). Start the Idea with 'Behind the scenes:'.",
  },
  {
    id: "customer-benefit",
    line: "One real problem the brand's customers have and how the brand solves it, said plainly, with the product or service as the answer.",
  },
  {
    id: "faq",
    line: "The one question customers ask most about this kind of product or service, answered clearly by the brand.",
  },
  {
    id: "meet-the-brand",
    line: "Who the brand is and what it stands for, in one warm, specific post. Start the Idea with 'Meet <brand>'.",
  },
  {
    id: "occasion",
    line: "A post for the real occasion or season named in 'Timely signal', tied to what the brand does; a greeting if it is a holiday.",
  },
  {
    id: "offer",
    line: "The brand's real current offer exactly as the brand context states it, made clear and inviting. Start the Idea with the offer itself.",
  },
  {
    id: "trend",
    line: "A post that ties the brand to the trend in 'Timely signal' (from Mellox Trend Radar), with wit, in the brand's own world and about what it really sells. Never use the trend owner's logos, characters or artwork. Start the Idea with 'Trend post:'.",
  },
  {
    id: "founder-story",
    line: "A founder story: why the brand exists, told as one honest moment or decision (no invented names, dates or numbers; only what the brand context says). Start the Idea with 'Founder story:'.",
  },
  {
    id: "service-object",
    line: "One strong idea that shows what the brand's main product or service really gives its customers, through one symbolic object or a visual metaphor (for example a crane lifting a block for a builder's strength), with a bold headline.",
  },
  {
    id: "myth-truth",
    line: "A myth people in this market still believe, and the truth, told by the brand with confidence (only facts the brand context supports).",
  },
  {
    id: "brand-idea",
    line: "A big-idea brand post: the brand's core promise said through one memorable picture idea and a short, sharp headline, the way the best global brands post.",
  },
];

/**
 * Picks what a Surprise me post is about: a rotation of what good brands post,
 * never the kind used in the last two Surprise posts, an occasion only when one
 * is close, an offer only when the brand states one.
 */
export function pickSurpriseIdea(args: {
  seed: string;
  hasOffer?: boolean;
  hasOccasion?: boolean;
  physicalProduct?: boolean;
  recent?: readonly string[];
  /** A Trend Radar trend reaches this brand now. */
  hasTrend?: boolean;
  /** Round 9 relevance pack (ADR-0053): the service idea shows the real work. */
  relevance?: boolean;
}): SurpriseIdea {
  const idea = pickSurpriseIdeaBase(args);
  return args.relevance && idea.id === "service-object" ? SERVICE_WORK_IDEA : idea;
}

/** The relevance pack's service idea: the work itself first, no stock example of one trade. */
const SERVICE_WORK_IDEA: SurpriseIdea = {
  id: "service-object",
  line: "One strong idea that shows what the brand's main product or service really gives its customers: the real work, the result or the moment it matters, specific enough that a stranger could name the business, with a bold headline.",
};

function pickSurpriseIdeaBase(args: {
  seed: string;
  hasOffer?: boolean;
  hasOccasion?: boolean;
  recent?: readonly string[];
  hasTrend?: boolean;
}): SurpriseIdea {
  const recent = new Set(args.recent?.slice(0, 2) ?? []);
  const pool = SURPRISE_IDEAS.filter((i) => {
    if (i.id === "offer" && !args.hasOffer) return false;
    if (i.id === "occasion" && !args.hasOccasion) return false;
    if (i.id === "trend" && !args.hasTrend) return false;
    return !recent.has(i.id);
  });
  // A Trend Radar trend that reaches this brand is the most timely post of
  // all (ADR-0052): picked one time in two while it is live.
  if (args.hasTrend && pool.some((i) => i.id === "trend") && hash(args.seed) % 2 === 0)
    return SURPRISE_IDEAS.find((i) => i.id === "trend")!;
  // A close occasion is the most timely post there is.
  if (args.hasOccasion && pool.some((i) => i.id === "occasion") && hash(args.seed) % 3 === 0)
    return SURPRISE_IDEAS.find((i) => i.id === "occasion")!;
  const list = pool.length ? pool : SURPRISE_IDEAS.slice(0, 3);
  return list[hash(args.seed) % list.length];
}

/**
 * The styles offered for one picture post: the same for the writer's menu and
 * the runner's check, so a pick outside them is replaced by the best fit.
 */
export function offeredPostStyles(args: {
  read: { deliverable: DeliverableId; productAsked: boolean; facts: string[]; quoted: string[] };
  platform?: string | null;
  physicalProduct: boolean;
  recent: readonly (string | null | undefined)[];
  /** A revision stays in its style. */
  refine?: boolean;
  seed: string;
}): PostStyle[] {
  return pickPostStyles({
    deliverable: args.read.deliverable,
    platform: args.platform,
    physicalProduct: args.physicalProduct,
    productAsked: args.read.productAsked,
    hasFacts: args.read.facts.length > 0,
    hasQuote: args.read.quoted.length > 0,
    recent: args.refine ? [] : args.recent,
    seed: args.seed,
  });
}

/** How each network's feed looks, in one line for the writer. */
export const PLATFORM_FEEL: Record<StylePlatform, string> = {
  instagram:
    "Instagram feed (4:5 portrait): visual first, the picture stops the thumb; one idea, few words, set big; it must look like a post from a top brand's feed, never a template.",
  facebook:
    "Facebook feed: clear and friendly, the message readable at a glance; a real photo or a clean graphic.",
  linkedin:
    "LinkedIn feed: professional and confident; one clear idea, real people and real work or a strong symbolic object, clear structured type, useful information.",
  tiktok:
    "TikTok photo post (vertical): native and casual, real photos, short bold text like a creator would add; never a polished ad.",
  pinterest:
    "Pinterest pin (tall 2:3): beautiful, saveable and useful; a clear title on the image; real photography.",
  threads: "Threads: conversational; a plain statement or a real photo, very few words.",
  twitter: "X: a simple, bold picture that makes the point in one look.",
  youtube: "YouTube community post: a clear picture with a short bold headline.",
};
