// Ad formats: the static ad layouts that keep winning on Meta, TikTok and
// LinkedIn, each written as a precise composition an image model can follow.
// An ad used to be a text-free mood photo; with a format it is a finished,
// designed ad: the real product, a headline, a supporting line and a button,
// placed where people actually read them.
//
// Pure (no React, no server) so the prompt engine and the picker share it.
// Ids are stored on jobs: add formats, never rename ids.
import { applyLean } from "@/lib/taste/bias";
import type { Lean } from "@/lib/taste/contracts";
import type { AdObjective } from "./ad-objectives";
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
  // ── Round 6 (docs/studio/reference-study-2026-10.md): small-business ads ──
  {
    id: "photo-band",
    label: "Headline band",
    tagline: "A colour band with the promise, a real scene, a button strip",
    needsProduct: false,
    goals: ["leads", "offer", "awareness"],
    layout:
      "Three stacked zones. Top 30%: a solid band in the brand's darkest colour with a small calm corner for the logo (added later) and a two-line headline, the first line regular weight and the second line bold. Middle: a real, candid photograph of the service happening to a customer, full width, natural light. Bottom 12%: a strip in the accent colour holding a small white rectangular button on the left and one short line beside it.",
    copy: "headline: two short lines, 3-6 words each; the first sets the scene, the second is the payoff. support: one short line for the bottom strip with a real price or condition from the brief, else empty. badge: empty.",
    thumb: "lifestyle",
  },
  {
    id: "founder-promise",
    label: "Built for you",
    tagline: "Why the brand exists, said plainly, over a real moment",
    needsProduct: false,
    goals: ["leads", "awareness"],
    layout:
      "The top third is a rich gradient in the brand's main colour that melts smoothly into a candid editorial photograph filling the rest (a person relaxed in a real place, natural light). Top-left: a large serif headline over three short lines in white; under it one small monospaced line in white; leave a calm spot under that for the logo, added later. Bottom-right over the photo: a small white pill button.",
    copy: "headline: the brand's reason to exist in plain first-person plural, 6-10 words (e.g. 'We built the … we wish we'd had'), only if the brand details support it. support: one proof line of 6-12 words with a real figure copied from the brief or brand details, else a plain statement of what it does. badge: empty.",
    thumb: "hero",
  },
  {
    id: "negation-trio",
    label: "No, no, just",
    tagline: "Strip away what people dread, then name the one thing that matters",
    needsProduct: false,
    goals: ["awareness", "leads", "launch"],
    layout:
      "A near-black or deep brand-colour background with a faint large outline motif. A tiny tracked caps line at the top left. In the middle-left, three short statements stacked in a tall condensed serif, each on its own line, the last word of the last line in the accent colour. A small support line below in light grey, then a small solid accent-colour button with a small arrow.",
    copy: "headline: three short sentences in the shape 'No X. No Y. Just Z.', each X and Y something the audience really dreads and Z the brand's real promise, 6-10 words in all. support: 8-16 words with real details from the brief. badge: a 3-6 word place or audience line for the top, or empty.",
    thumb: "type",
  },
  {
    id: "not-equal",
    label: "Not the same",
    tagline: "Two things people confuse, set as an equation",
    needsProduct: false,
    goals: ["education", "engagement", "awareness"],
    layout:
      "A calm, airy photo set acting out balance (two stones balanced on a plank over still water, or a soft plant shadow on a pale wall), low contrast. Centred in the upper two thirds: the first idea, a large ≠ sign in the accent colour, the second idea, stacked on three lines in one heavy typeface; optionally a thin accent-colour circle loosely around them. Logo small in the top-right corner, added later. No button.",
    copy: "headline: the two ideas joined by ' ≠ ', 2-4 words each (e.g. 'Revenue ≠ profit'), a distinction the brand really teaches. support: empty. badge: empty.",
    thumb: "versus",
  },
  {
    id: "live-moment",
    label: "Right now",
    tagline: "A real figure about today, set big on a real photo",
    needsProduct: false,
    goals: ["awareness", "offer", "engagement"],
    layout:
      "A full-bleed, sunny, real photograph of the experience (people enjoying the place, a hand on the water, a view). Top-left over the calm part of the photo (sky or water): one large figure in the accent colour followed by the headline in heavy white caps, with a small simple line icon beside it; under it one short white line. The logo in white bottom-left, added later. No panel and no box behind the words.",
    copy: "badge: one real current figure copied exactly from the brief (a temperature, a count of places left, today's catch), else empty. headline: 3-6 words that place the figure in time ('by the water this week'). support: a short 3-6 word line that repeats the moment ('Exactly now. Exactly this week.'). Never invent a figure.",
    thumb: "stat",
  },
  {
    id: "checklist-split",
    label: "Services list",
    tagline: "What you get, as a short checklist, with one clear button",
    needsProduct: false,
    goals: ["leads", "offer", "education"],
    layout:
      "The frame is split by one clean diagonal: the upper area white, the lower area the brand's darkest colour. Upper area: a large heavy headline over three lines with two key words in the accent colour, then three short service lines each led by a small accent-colour dot. Lower area: a rounded accent-colour button with dark text and one short white line under it; a few accent-colour dots of growing size scattered toward the bottom-right corner, echoing the brand's mark.",
    copy: "headline: 5-8 words naming the result the customer comes back to. points: exactly 3 real services from the brief or brand details, 1-4 words each. support: one short line with a real condition or place, 4-8 words. badge: empty.",
    thumb: "split",
  },
  {
    id: "stat-card-photo",
    label: "Photo with a figure",
    tagline: "A close, real moment with one proof figure on a small card",
    needsProduct: false,
    goals: ["leads", "education"],
    layout:
      "A close, candid photograph of the product or service in use (hands, a phone, a tool) filling the frame, with shallow depth of field. In the lower-right, a small dark rounded card holding one huge figure in the accent colour and two short lines in white under it, with a thin accent line at the bottom of the card. Nothing else on the picture.",
    copy: "badge: one real figure copied exactly from the brief or brand details (e.g. '100%', '24h'); if there is none, use a 1-2 word outcome instead. headline: empty unless needed, at most 4 words. support: 5-9 words that explain the figure. Never invent a figure.",
    thumb: "stat",
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
 * does the ad's job (its objective's layouts, else the goal's), not used in
 * the last few ads, picked by the job's seed.
 */
export function pickAdFormat(args: {
  chosen?: string | null;
  goal?: GoalId;
  /** What the ad is for (ad-objectives.ts); its layouts come first. */
  objective?: AdObjective | null;
  hasProduct: boolean;
  seed: string;
  recent?: (string | null | undefined)[];
  /** The brand's taste for ad layouts (ADR-0038). */
  lean?: Lean | null;
}): AdFormat {
  const chosen = getAdFormat(args.chosen);
  if (chosen && (args.hasProduct || !chosen.needsProduct)) return chosen;
  const usable = adFormatsFor(args.hasProduct);
  const byObjective = args.objective
    ? usable.filter((f) => args.objective!.formats.includes(f.id))
    : [];
  const goal = args.goal ?? args.objective?.goal;
  const byGoal = goal ? usable.filter((f) => f.goals.includes(goal)) : usable;
  const pool = byObjective.length ? byObjective : byGoal.length ? byGoal : usable;
  const recent = new Set((args.recent ?? []).filter(Boolean).slice(0, 3));
  const fresh = pool.filter((f) => !recent.has(f.id));
  const choices = applyLean(fresh.length ? fresh : pool, args.lean, args.seed, (f) => f.id);
  // With a product, lead with formats that show it.
  const ranked = args.hasProduct
    ? [...choices.filter((f) => f.needsProduct), ...choices.filter((f) => !f.needsProduct)]
    : choices;
  // The shortlist: with a product, its layouts plus a couple of others, so
  // adding non-product layouts never crowds the product out.
  const withProduct = args.hasProduct ? ranked.filter((f) => f.needsProduct).length : 0;
  const size = withProduct ? withProduct + 2 : Math.ceil(ranked.length / 2);
  const top = ranked.slice(0, Math.max(3, size));
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
