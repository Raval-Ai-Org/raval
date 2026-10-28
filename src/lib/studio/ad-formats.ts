// Ad formats: the static ad layouts that keep winning on Meta, TikTok and
// LinkedIn, each written as a precise composition an image model can follow.
// An ad used to be a text-free mood photo; with a format it is a finished,
// designed ad: the real product, a headline, a supporting line and a button,
// placed where people actually read them.
//
// Pure (no React, no server) so the prompt engine and the picker share it.
// Ids are stored on jobs: add formats, never rename ids.
import type { GoalId } from "./jobs";

export type AdFormatThumb =
  | "hero"
  | "callouts"
  | "versus"
  | "split"
  | "quote"
  | "offer"
  | "question"
  | "stat"
  | "note"
  | "lifestyle"
  | "flatlay"
  | "steps"
  | "grid"
  | "type";

export type AdFormat = {
  id: string;
  label: string;
  /** One plain sentence for the picker. */
  tagline: string;
  /** Needs a product photo to work. Without one it is never picked automatically. */
  needsProduct: boolean;
  goals: GoalId[];
  /** The composition, sent to the image model. */
  layout: string;
  /** What each piece of on-image copy should be, sent to the copy model. */
  copy: string;
  thumb: AdFormatThumb;
};

export const AD_FORMATS: AdFormat[] = [
  {
    id: "product-hero",
    label: "Product hero",
    tagline: "Your product, big and beautiful, with one clear promise",
    needsProduct: true,
    goals: ["awareness", "leads", "launch", "offer"],
    layout:
      "Studio product shot. The product fills 45-60% of the frame, centred slightly below the middle, on a clean seamless backdrop in a brand colour with a soft floor shadow and one gentle highlight. Headline in large bold type across the top third. The supporting line in smaller type under the headline. A rounded button with the button label near the bottom centre. Nothing else.",
    copy: "headline: the single biggest promise in 3-6 words. support: one concrete reason to believe, 6-12 words. badge: empty.",
    thumb: "hero",
  },
  {
    id: "benefit-callouts",
    label: "Feature callouts",
    tagline: "The product in the middle, its best points pointing at it",
    needsProduct: true,
    goals: ["education", "leads", "launch"],
    layout:
      "The product centred, filling about 40% of the frame, on a plain light backdrop. Three or four short callout labels placed around it, each joined to the relevant part of the product by a thin straight leader line with a small dot at the product end. Headline at the top. Generous empty space between callouts; nothing overlaps the product.",
    copy: "headline: 3-6 words naming what the product does. points: 3-4 callouts of 2-4 words each, each a real feature from the product facts. support: empty.",
    thumb: "callouts",
  },
  {
    id: "us-vs-them",
    label: "Us vs. the usual way",
    tagline: "A side-by-side that makes the choice obvious",
    needsProduct: false,
    goals: ["leads", "offer", "education"],
    layout:
      "Split vertically into two equal panels. Left panel muted and desaturated, labelled with the 'usual way' label, showing a list of 3 rows each with a small cross icon. Right panel in the brand colour, labelled with the brand name, showing the same 3 rows with check icons, and the product (if supplied) at the bottom of the right panel. Headline across the top spanning both panels. Never show or name another company.",
    copy: "headline: 3-6 words framing the choice. points: exactly 3 short rows of 2-5 words, each a real difference the brand offers. support: the 'usual way' label, 2-3 words, e.g. 'The usual way'. Never name a competitor.",
    thumb: "versus",
  },
  {
    id: "before-after",
    label: "Before / after",
    tagline: "The problem on one side, life with you on the other",
    needsProduct: false,
    goals: ["leads", "education", "awareness"],
    layout:
      "Split into two equal halves with a clean dividing line. Left half: the problem state, slightly cooler and duller, with a small 'Before' tag. Right half: the same scene improved, warmer and brighter, with a small 'After' tag and the product (if supplied) clearly present. Headline in a band across the top or bottom. The two halves share the same camera angle so the change reads instantly.",
    copy: "headline: 3-7 words naming the change. support: empty. Only show a change the brand's facts support; no invented results or numbers.",
    thumb: "split",
  },
  {
    id: "testimonial",
    label: "Customer quote",
    tagline: "A real customer's words, front and centre",
    needsProduct: false,
    goals: ["leads", "engagement", "offer"],
    layout:
      "A large quote card taking most of the frame on a brand-colour background, the quote in big readable type with oversized quotation marks. The product (if supplied) small in a lower corner, partly overlapping the card edge. The attribution line in small type under the quote. No stars, ratings or faces unless they are supplied.",
    copy: "headline: a real customer quote copied word for word from the brief or brand details, at most 18 words. support: the attribution exactly as supplied. If no real quote is supplied, write headline as a plain statement the brand makes (no quotation marks) and leave support empty. Never invent a quote, name or rating.",
    thumb: "quote",
  },
  {
    id: "offer-banner",
    label: "Offer",
    tagline: "A deal people see before anything else",
    needsProduct: true,
    goals: ["offer", "launch"],
    layout:
      "The offer badge is the first thing seen: a bold circular or ribbon badge in the accent colour near the top right, holding the badge text. The product large in the centre-left. Headline in bold type above or beside the product, the supporting line smaller below it, a rounded button at the bottom. High contrast, energetic but clean.",
    copy: "badge: the offer exactly as stated in the brief (e.g. '20% off', 'Free shipping'), 1-4 words. If the brief states no offer, badge is empty and the headline leads with the product's promise instead. headline: 3-6 words. support: one line with any real condition or deadline from the brief, or empty.",
    thumb: "offer",
  },
  {
    id: "problem-question",
    label: "Problem question",
    tagline: "Ask the question your customer is already asking",
    needsProduct: false,
    goals: ["engagement", "leads", "awareness"],
    layout:
      "The headline question set very large, filling the upper half, in heavy type on a solid brand-colour or near-black background. The product (if supplied) or a simple object that represents the answer in the lower half, lit dramatically. The supporting line small just above the bottom edge.",
    copy: "headline: a question the audience really asks, 4-9 words, ending with '?'. support: the short answer, 4-10 words, pointing to the brand.",
    thumb: "question",
  },
  {
    id: "big-number",
    label: "Big number",
    tagline: "One striking figure the brand can stand behind",
    needsProduct: false,
    goals: ["awareness", "leads", "education"],
    layout:
      "One huge figure as the visual centre, taking a third of the frame, in the accent colour. The headline under it explaining the figure. The product (if supplied) smaller to one side. Minimal background with plenty of space.",
    copy: "badge: one figure copied exactly from the brand details or brief (e.g. '10,000+', '3x', '24h'). If there is no real figure, choose another layout's style: badge empty and headline a bold claim. headline: 3-8 words explaining the figure. support: empty.",
    thumb: "stat",
  },
  {
    id: "note-card",
    label: "Simple note",
    tagline: "Looks like a quick handwritten-style list, reads like a friend",
    needsProduct: false,
    goals: ["engagement", "education", "awareness"],
    layout:
      "A plain note card or paper sheet seen straight on, filling most of the frame, with a slightly off-white tone and subtle paper texture. The headline as the note's title, then 3 short list lines with simple bullets or hand-drawn ticks, in a clean casual typeface. The product (if supplied) resting at the bottom edge, partly over the note. Looks native and unpolished on purpose, but stays legible. No app interface, status bar or buttons.",
    copy: "headline: a casual title, 3-7 words. points: exactly 3 list lines of 3-7 words. support: empty.",
    thumb: "note",
  },
  {
    id: "lifestyle",
    label: "In real life",
    tagline: "The product being used in a believable everyday moment",
    needsProduct: true,
    goals: ["awareness", "engagement"],
    layout:
      "A natural, candid lifestyle photograph shot on a phone camera feel: the product being used or held in a believable everyday setting that fits the audience, daylight, shallow depth of field, slight imperfection. A short caption in a simple white rounded bar or plain bold text over the lower third, like a creator's post. No faces looking at the camera unless supplied; hands and partial figures are fine.",
    copy: "headline: a short first-person-feeling caption, 3-8 words, without claiming to be a real customer. support: empty.",
    thumb: "lifestyle",
  },
  {
    id: "flat-lay",
    label: "Flat lay",
    tagline: "Overhead shot of the product with what goes with it",
    needsProduct: true,
    goals: ["awareness", "launch"],
    layout:
      "An overhead flat-lay photograph: the product in the centre surrounded by a few related props and textures that fit the brand, neatly arranged with even spacing on a textured surface in brand tones. Soft even daylight. The headline in clean type in a clear area of negative space at the top.",
    copy: "headline: 3-6 words. support: empty.",
    thumb: "flatlay",
  },
  {
    id: "three-steps",
    label: "How it works",
    tagline: "Three simple steps from problem to result",
    needsProduct: false,
    goals: ["education", "leads"],
    layout:
      "Headline across the top. Below it three equal panels in a row (or stacked for vertical formats), each with a large step number in a circle, a small simple icon or picture, and a short step label. The product (if supplied) in the last panel. Clean, evenly spaced, lots of air.",
    copy: "headline: 3-6 words. points: exactly 3 steps of 2-5 words each, in order. support: empty.",
    thumb: "steps",
  },
  {
    id: "detail-grid",
    label: "Close-up grid",
    tagline: "Four close-ups that show the quality",
    needsProduct: true,
    goals: ["education", "launch"],
    layout:
      "A 2x2 grid of four close-up crops of the product, each showing a different detail (material, texture, label, use), separated by thin gutters. A short label on each tile in small type. The headline in a band across the middle or top.",
    copy: "headline: 3-6 words. points: exactly 4 tile labels of 1-3 words, each a real detail from the product facts. support: empty.",
    thumb: "grid",
  },
  {
    id: "bold-type",
    label: "Bold statement",
    tagline: "A poster-style headline that stops the scroll",
    needsProduct: false,
    goals: ["awareness", "engagement", "launch"],
    layout:
      "Typography is the image: the headline in huge, tightly set heavy type filling most of the frame, in the brand colours with strong contrast. One accent word highlighted in the accent colour. The supporting line small at the bottom with the button label. The product (if supplied) small in a corner. No photo background.",
    copy: "headline: a bold, specific statement in 3-7 words. support: 4-10 words. badge: empty.",
    thumb: "type",
  },
];

const BY_ID = new Map(AD_FORMATS.map((f) => [f.id, f]));

export function getAdFormat(id: string | null | undefined): AdFormat | null {
  return id ? (BY_ID.get(id) ?? null) : null;
}

/** Formats that work for this piece: product formats only when there is a product. */
export function adFormatsFor(hasProduct: boolean): AdFormat[] {
  return AD_FORMATS.filter((f) => hasProduct || !f.needsProduct);
}

function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * The format an ad uses: the person's choice when it fits, else one that
 * suits the goal, not used in the last few ads, picked by the job's seed.
 */
export function pickAdFormat(args: {
  chosen?: string | null;
  goal?: GoalId;
  hasProduct: boolean;
  seed: string;
  recent?: (string | null | undefined)[];
}): AdFormat {
  const chosen = getAdFormat(args.chosen);
  if (chosen && (args.hasProduct || !chosen.needsProduct)) return chosen;
  const usable = adFormatsFor(args.hasProduct);
  const byGoal = args.goal ? usable.filter((f) => f.goals.includes(args.goal!)) : usable;
  const pool = byGoal.length ? byGoal : usable;
  const recent = new Set((args.recent ?? []).filter(Boolean).slice(0, 3));
  const fresh = pool.filter((f) => !recent.has(f.id));
  const choices = fresh.length ? fresh : pool;
  // With a product, lead with formats that show it.
  const ranked = args.hasProduct
    ? [...choices.filter((f) => f.needsProduct), ...choices.filter((f) => !f.needsProduct)]
    : choices;
  const top = ranked.slice(0, Math.max(3, Math.ceil(ranked.length / 2)));
  return top[hash(args.seed) % top.length];
}

/** The on-image copy the ad model writes for its format. */
export type AdOnImage = {
  headline: string;
  support: string;
  badge: string;
  points: string[];
  cta: string;
};

/** Words the image model must typeset, and nothing else. */
export function onImageCopyLines(copy: AdOnImage): string[] {
  return [
    copy.badge && `Badge text: ${JSON.stringify(copy.badge)}`,
    copy.headline && `Headline: ${JSON.stringify(copy.headline)}`,
    copy.support && `Supporting line: ${JSON.stringify(copy.support)}`,
    ...copy.points.map((point, i) => `Point ${i + 1}: ${JSON.stringify(point)}`),
    copy.cta && `Button label: ${JSON.stringify(copy.cta)}`,
  ].filter((line): line is string => !!line);
}

/** For the copy model: which layout this ad uses and what each piece of copy is. */
export function adFormatDirective(format: AdFormat): string {
  return [
    `This ad is a designed static ad in the "${format.label}" layout: ${format.tagline}.`,
    `Layout: ${format.layout}`,
    `Write \`onImage\` for this layout. ${format.copy}`,
    "On-image copy is read in under two seconds on a phone: short, concrete, no hashtags, no emoji, no em dashes. `onImage.cta` is the button label (2-3 words). Every fact must come from the brief, the brand or the product facts.",
  ].join("\n");
}
