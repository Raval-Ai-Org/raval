// brief-read.ts — what the person actually asked for, read once at the start
// of a Studio job (pure, browser-safe).
//
// Every writer and picture prompt is built on this, so a hiring post stays a
// hiring post and the brief's own facts (a date, "3 roles", "20% off") reach
// the words on the picture. It replaces the old order, where a random post
// kind, angle and opening were picked first and the brief was one short
// section among twenty louder ones (ADR-0051).
import { detectDeliverable, type DeliverableId } from "./creative-knowledge";

export type BriefRead = {
  /** What kind of asset the brief asks for (creative-knowledge.ts DELIVERABLES). */
  deliverable: DeliverableId;
  /** Numbers, prices, percentages, dates and times the brief states, verbatim. */
  facts: string[];
  /** Words the person put in quotes: set exactly as written. */
  quoted: string[];
  /** The brief's own subject words, used to check the copy stays on it. */
  keyTerms: string[];
  /** The brief really names a product from the catalogue. */
  productAsked: boolean;
};

/** Deliverables that are never about selling a product. */
export const NON_SELLING: ReadonlySet<DeliverableId> = new Set([
  "hiring",
  "greeting",
  "event",
  "milestone",
  "intro",
  "humour",
  "teaser",
  "collab",
  "market-entry",
  "case-study",
  "quote",
  "tips",
  "mix-up",
]);

const MONTHS =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const DAYS = "monday|tuesday|wednesday|thursday|friday|saturday|sunday";

const FACT_PATTERNS: RegExp[] = [
  // Prices and currency amounts.
  /(?:[$€£¥₹]|rs\.?\s?|pkr\s?|usd\s?|aed\s?)\d[\d,.]*(?:\s?[kKmM])?/gi,
  /\b\d[\d,.]*\s?(?:usd|eur|gbp|pkr|aed|inr|dollars|rupees)\b/gi,
  // Percentages.
  /\b\d+(?:\.\d+)?\s?%(?:\s?off)?/gi,
  // Dates: "5 Dec", "Dec 5", "December 5th", "5/12", "2026-12-05".
  new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS})\\b(?:\\s+\\d{4})?`, "gi"),
  new RegExp(`\\b(?:${MONTHS})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?\\b(?:,?\\s+\\d{4})?`, "gi"),
  /\b\d{4}-\d{2}-\d{2}\b/g,
  /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g,
  new RegExp(`\\b(?:${DAYS})\\b`, "gi"),
  // Times.
  /\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/gi,
  /\b\d{1,2}:\d{2}\b/g,
  // Counts with what they count: "3 roles", "10 years", "500 customers".
  /\b\d+(?:[.,]\d+)?\s?k?\+?\s+[a-z][a-z-]{2,20}\b/gi,
  // Codes: "use code SAVE20".
  /\bcode\s+[A-Z0-9]{3,20}\b/g,
];

const STOP = new Set(
  `a an the and or but for nor so yet to of in on at by with from into onto over under about above below
  this that these those it its we our us you your they their them i me my he she his her be is are was were
  been being do does did have has had will would can could should may might must shall make made post posts
  create write design want need please some any more most very just also like new get our using use about
  image picture photo graphic social media instagram facebook linkedin tiktok story stories carousel slide
  slides banner ad ads caption brand company business today now here there what which who when where why how
  all each every one two three not no yes really actually something someone people
  we're we've we'll you're you've it's let's don't can't won't isn't aren't that's there's`
    .split(/\s+/)
    .filter(Boolean),
);

function unique(list: string[], max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const item = raw.replace(/\s+/g, " ").trim();
    const key = item.toLowerCase();
    if (!item || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= max) break;
  }
  return out;
}

/** Numbers, prices, dates and times stated in the text, verbatim. */
export function briefFacts(text: string): string[] {
  const found: string[] = [];
  for (const pattern of FACT_PATTERNS) {
    for (const match of text.matchAll(pattern)) found.push(match[0]);
  }
  // Drop a fact contained in a longer one ("20%" inside "20% off").
  const all = unique(found, 40);
  return all
    .filter(
      (f) => !all.some((other) => other !== f && other.toLowerCase().includes(f.toLowerCase())),
    )
    .slice(0, 12);
}

/** Words the person put in quotes. */
export function briefQuoted(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/["“]([^"”\n]{2,120})["”]/g)) out.push(m[1]);
  for (const m of text.matchAll(/(?:^|\s)['‘]([^'’\n]{3,120})['’](?=\s|[.,!?]|$)/g)) out.push(m[1]);
  return unique(out, 4);
}

/** Content words, lowercased, without stop words, in order of first use. */
export function contentWords(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? [])
    .map((w) => w.replace(/'s$/, ""))
    .filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w));
}

/** The brief's subject words: the most specific content words, first use first. */
export function briefKeyTerms(text: string): string[] {
  return unique(contentWords(text), 10);
}

/**
 * A product counts as asked for only when the brief names it fully, or names
 * two of its distinctive words. One shared word ("designer") is not enough.
 */
export function briefNamesProduct(text: string, productNames: readonly string[]): boolean {
  const brief = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ")} `;
  return productNames.some((name) => {
    const clean = name
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
    if (!clean) return false;
    if (brief.includes(` ${clean} `)) return true;
    const words = [...new Set(clean.split(" ").filter((w) => w.length >= 3 && !STOP.has(w)))];
    if (words.length < 2) return false;
    return words.filter((w) => brief.includes(` ${w} `)).length >= 2;
  });
}

export function readBrief(
  brief: string,
  opts: { productNames?: readonly string[]; physicalProduct?: boolean } = {},
): BriefRead {
  const text = brief.slice(0, 4000);
  const productAsked = briefNamesProduct(text, opts.productNames ?? []);
  const found = detectDeliverable({ text, physicalProduct: false }).id;
  // A brief that names the product and nothing more specific is a product post.
  const deliverable: DeliverableId =
    found === "brand-moment" && productAsked && opts.physicalProduct !== false
      ? "product-hero"
      : found;
  return {
    deliverable,
    facts: briefFacts(text),
    quoted: briefQuoted(text),
    keyTerms: briefKeyTerms(text),
    productAsked,
  };
}

/** The brief read as a short block for a writer's prompt. */
export function briefReadLines(read: BriefRead): string[] {
  return [
    `What this is: ${DELIVERABLE_LABEL[read.deliverable]}.`,
    read.facts.length
      ? `Facts the brief states (use them exactly where they matter; never change a figure): ${read.facts.join(" · ")}`
      : "The brief states no figures, prices or dates: never add any.",
    read.quoted.length
      ? `Exact words the person gave (keep them verbatim): ${read.quoted.map((q) => JSON.stringify(q)).join(", ")}`
      : "",
    read.keyTerms.length ? `Its subject words: ${read.keyTerms.slice(0, 8).join(", ")}` : "",
  ].filter(Boolean);
}

const DELIVERABLE_LABEL: Record<DeliverableId, string> = {
  "promo-offer": "an offer or sale post (the offer is the message)",
  event: "an event announcement (what, when, where, how to join)",
  hiring: "a hiring post (the role and how to apply are the message; it is not selling anything)",
  greeting: "a greeting for a day or occasion (warm, calm, not selling)",
  teaser: "a teaser before a reveal",
  milestone: "a milestone or thank-you post",
  collab: "a partnership announcement",
  "market-entry": "an announcement that the brand has arrived somewhere new",
  "case-study": "a showcase of real work",
  intro: "a 'who we are' introduction",
  humour: "a light, funny post",
  launch: "a launch of something new",
  quote: "a quote or testimonial card",
  tips: "a tips, how-to or explainer post",
  "feature-board": "a post about features or what is inside",
  comparison: "a comparison or before/after",
  "mix-up": "a post about two things people confuse",
  "product-hero": "a product post (the product is the hero)",
  "brand-moment": "a brand post on the subject of the brief",
};
