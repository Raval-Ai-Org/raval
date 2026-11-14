// Ad objectives: what a paid ad is for. A social post earns attention in a
// feed; an ad is paid to make one thing happen (a sale, a sign-up, a click, a
// visit), so each objective has its own copy method, button, layouts and
// rules. The ad prompt, the ad picture and the layout picker all read this.
//
// Distilled from how performance teams brief paid social and search: one
// objective per ad, the funnel stage decides how hard it sells, the first line
// carries the hook, the button names the action, and nothing is invented
// (Meta and Google refuse ads with false urgency, made-up claims or copy that
// asserts a person's personal attributes).
//
// Pure (no React, no server). Ids are stored on jobs: add, never rename.
import type { GoalId } from "./jobs";

export const AD_OBJECTIVE_IDS = [
  "sales",
  "leads",
  "traffic",
  "awareness",
  "retarget",
  "app",
  "local",
  "event",
] as const;

export type AdObjectiveId = (typeof AD_OBJECTIVE_IDS)[number];

export type AdObjective = {
  id: AdObjectiveId;
  /** Plain words for the picker. */
  label: string;
  tagline: string;
  /** Cold people never heard of the brand; warm know it; hot are close to buying. */
  stage: "cold" | "warm" | "hot";
  /** The Studio goal it matches, for picking a layout. */
  goal: GoalId;
  /** Button labels that fit, best first (the platforms' own button names). */
  ctas: string[];
  /** Layouts (ad-formats.ts ids) that do this job best, best first. */
  formats: string[];
  /** How the copy is built, for the copy model. */
  method: string[];
  /** Three angles worth testing against each other. */
  angles: [string, string, string];
  /** What the picture must make obvious, for the image model. */
  visual: string;
};

export const AD_OBJECTIVES: readonly AdObjective[] = [
  {
    id: "sales",
    label: "Sell",
    tagline: "Get people to buy now",
    stage: "hot",
    goal: "offer",
    ctas: ["Shop now", "Buy now", "Get offer", "Order now"],
    formats: [
      "offer-banner",
      "product-hero",
      "us-vs-them",
      "benefit-callouts",
      "testimonial",
      "photo-band",
    ],
    method: [
      "Objective: sales. The reader should know what it is, why it is worth it and what to do, in that order, within the first line.",
      "Open with the product's single strongest outcome or the real offer from the brief. Then one concrete reason to believe (a feature, material, guarantee or result the facts state). Then the action.",
      "Answer the main buying objection (price, fit, effort, trust) with a fact the brand gives, never a promise it doesn't.",
      "Urgency only when the brief states a real deadline, stock limit or offer end; otherwise none.",
    ],
    angles: ["Outcome", "Objection", "Offer"],
    visual:
      "The product, or what the buyer gets, is the clear hero; the offer or promise reads first.",
  },
  {
    id: "leads",
    label: "Get leads",
    tagline: "Sign-ups, quotes, calls or demos",
    stage: "warm",
    goal: "leads",
    ctas: ["Sign up", "Get quote", "Book now", "Contact us", "Download"],
    formats: [
      "problem-question",
      "three-steps",
      "before-after",
      "us-vs-them",
      "note-card",
      "founder-promise",
      "checklist-split",
      "stat-card-photo",
    ],
    method: [
      "Objective: leads. Sell the next small step, not the whole product: what the person gets for their details (a quote, a call, a guide, a demo, a free check) and how little it asks of them.",
      "Problem, cost of the problem, the step that fixes it (PAS). Name who it is for in plain words so the right people self-select.",
      "Say what happens after the click in one short phrase (e.g. 'a 15-minute call', 'a quote in your inbox') only when the brief or brand states it.",
    ],
    angles: ["Pain", "Easy first step", "Proof"],
    visual: "Show the problem solved or the simple next step; calm, trustworthy, one clear ask.",
  },
  {
    id: "traffic",
    label: "Get clicks",
    tagline: "Send people to a page or article",
    stage: "cold",
    goal: "education",
    ctas: ["Learn more", "Read more", "See more", "Watch more"],
    formats: [
      "problem-question",
      "big-number",
      "bold-type",
      "note-card",
      "three-steps",
      "not-equal",
    ],
    method: [
      "Objective: traffic. Promise something specific that is on the other side of the click and deliver on it; the reader must know what page they will land on.",
      "Open a real question or gap the page answers. Specific beats clever. Never bait: the headline must match what the page says.",
    ],
    angles: ["Curiosity", "Useful answer", "Specific number"],
    visual:
      "One intriguing focal point that makes the promise visible; leave the answer for the page.",
  },
  {
    id: "awareness",
    label: "Get known",
    tagline: "Make new people remember the brand",
    stage: "cold",
    goal: "awareness",
    ctas: ["Learn more", "Follow", "Watch more"],
    formats: [
      "bold-type",
      "lifestyle",
      "flat-lay",
      "product-hero",
      "big-number",
      "negation-trio",
      "live-moment",
    ],
    method: [
      "Objective: awareness. One memorable idea, said once, with the brand clearly present in the first second. No hard sell, no stacked offers.",
      "Use the brand's distinctive voice and a line people could repeat. Show what the brand stands for through one vivid moment, not a list.",
    ],
    angles: ["Brand belief", "Signature moment", "Who it's for"],
    visual:
      "The brand's colours and look are unmistakable; one striking, memorable image with very few words.",
  },
  {
    id: "retarget",
    label: "Win back visitors",
    tagline: "People who looked but didn't buy",
    stage: "hot",
    goal: "offer",
    ctas: ["Shop now", "Book now", "Get offer", "Learn more"],
    formats: [
      "testimonial",
      "us-vs-them",
      "offer-banner",
      "benefit-callouts",
      "product-hero",
      "stat-card-photo",
    ],
    method: [
      "Objective: retargeting. The reader already knows the brand. Skip the introduction: remind them what they liked, remove the doubt that stopped them, and make the next step easy.",
      "Lead with proof (a real customer quote or result from the brief), a guarantee or the real offer. Never claim to know what the person did, viewed or is ('You looked at...', 'Still single?'): platforms refuse copy that asserts personal attributes or behaviour.",
    ],
    angles: ["Proof", "Doubt removed", "Reason to come back"],
    visual:
      "The product as they remember it, with proof or the offer in clear view; familiar, warm, uncluttered.",
  },
  {
    id: "app",
    label: "Get app installs",
    tagline: "People download the app",
    stage: "warm",
    goal: "launch",
    ctas: ["Download", "Install now", "Get app"],
    formats: [
      "three-steps",
      "benefit-callouts",
      "bold-type",
      "before-after",
      "problem-question",
      "founder-promise",
    ],
    method: [
      "Objective: app installs. Show the one thing the app does in the first moment of use and the result it gives, then 'download'.",
      "Name the core task in plain words and how fast it happens only if the brand states it. Mention free or price only as stated.",
    ],
    angles: ["Core moment", "Time saved", "Before and after"],
    visual:
      "The app's core moment shown simply (hands and a plain device are fine); never a fake app store badge or rating.",
  },
  {
    id: "local",
    label: "Bring people in",
    tagline: "Visits, bookings or calls to a place",
    stage: "warm",
    goal: "leads",
    ctas: ["Book now", "Get directions", "Call now", "Order now"],
    formats: [
      "lifestyle",
      "offer-banner",
      "product-hero",
      "note-card",
      "flat-lay",
      "photo-band",
      "live-moment",
      "checklist-split",
    ],
    method: [
      "Objective: local visits. Make the place feel near and real: what people get there, for whom, and how to come (book, call, walk in).",
      "Use the neighbourhood, opening hours or address only when the brand or brief states them, word for word.",
    ],
    angles: ["The experience", "Nearby and easy", "Today's reason"],
    visual:
      "The real experience of the place or service in warm, believable light; no invented address, map or price.",
  },
  {
    id: "event",
    label: "Fill an event",
    tagline: "Registrations or tickets",
    stage: "warm",
    goal: "launch",
    ctas: ["Register", "Get tickets", "Sign up", "Book now"],
    formats: ["bold-type", "big-number", "offer-banner", "problem-question", "three-steps"],
    method: [
      "Objective: event. What it is, when, where (or online) and what people leave with, in that order. Date, time and place exactly as the brief states them.",
      "One reason to come that is specific to this event (a speaker, a skill, a first look) only when the brief states it.",
    ],
    angles: ["What you'll get", "Who's there", "Date and place"],
    visual: "An event poster: the date and name read first, the feel of the event behind it.",
  },
];

/** Rules every ad follows, whatever it is for. */
export const AD_POLICY_RULES: readonly string[] = [
  "One objective, one audience and one action per ad. The button label names that action.",
  "The first 125 characters of the primary text carry the hook and the point; the rest is optional detail people may never see.",
  "Every claim, figure, price, discount, guarantee, review and deadline comes from the brief, the brand details or the product facts, word for word. No invented urgency or scarcity.",
  "Never assert or imply a reader's personal attributes (health, finances, age, body, beliefs, identity) or what they did online. Speak to the situation, not the person.",
  "No 'best', 'No. 1', 'guaranteed' or 'cure' unless the brand states it with proof. No ALL CAPS sentences, no strings of exclamation marks, no clickbait.",
  "Never name or show a competitor.",
];

/** Google search ads read a typed query, not a feed: different rules. */
export const SEARCH_AD_RULES =
  "`search` is for a Google search ad shown to someone typing a question: `headlines` are 8-12 distinct lines of at most 30 characters each (include what the brand offers, a benefit, a proof point, the action, the brand name once), each readable on its own in any order; `descriptions` are 2-4 lines of at most 90 characters, each a full sentence ending with the action. No exclamation mark in headlines.";

const BY_ID = new Map(AD_OBJECTIVES.map((o) => [o.id, o]));

export function getAdObjective(id: string | null | undefined): AdObjective | null {
  return id ? (BY_ID.get(id as AdObjectiveId) ?? null) : null;
}

/** The objective a goal implies when the person didn't choose one. */
const FROM_GOAL: Record<GoalId, AdObjectiveId> = {
  offer: "sales",
  leads: "leads",
  education: "traffic",
  awareness: "awareness",
  engagement: "awareness",
  launch: "sales",
};

/**
 * The person's choice, else what the brief plainly asks for, else the goal's,
 * else sales (the reason most people run an ad). Pure string work.
 */
export function resolveAdObjective(args: {
  chosen?: string | null;
  goal?: GoalId;
  brief?: string;
}): AdObjective {
  const chosen = getAdObjective(args.chosen);
  if (chosen) return chosen;
  const brief = (args.brief ?? "").toLowerCase();
  const signal: [RegExp, AdObjectiveId][] = [
    [
      /\b(retarget|re-target|remarket|abandon(ed)? (cart|basket)|win back|past visitors)\b/,
      "retarget",
    ],
    [/\b(app install|download (our|the) app|install (our|the) app|app store|play store)\b/, "app"],
    [/\b(webinar|workshop|conference|meetup|event|tickets?|register|registration)\b/, "event"],
    [
      /\b(visit (us|our)|walk[- ]in|store visit|foot traffic|near(by| you)|book a table|our (shop|store|salon|clinic|restaurant))\b/,
      "local",
    ],
    [
      /\b(lead|leads|sign[- ]?ups?|demo|free (trial|consultation|quote)|get a quote|book a call|enquir|inquir)\b/,
      "leads",
    ],
    [/\b(traffic|clicks?|read (the|our)|blog post|article|landing page)\b/, "traffic"],
    [/\b(awareness|reach|get known|brand video|introduce)\b/, "awareness"],
    [/\b(sale|sell|buy|shop|discount|% off|offer|order|purchase|conversions?)\b/, "sales"],
  ];
  const hit = signal.find(([re]) => re.test(brief));
  if (hit) return BY_ID.get(hit[1])!;
  return BY_ID.get(args.goal ? FROM_GOAL[args.goal] : "sales")!;
}

/** For the copy model: what this ad is for and how to write it. */
export function adObjectiveDirective(objective: AdObjective): string {
  return [
    `This is a paid ad, not an organic post. It is for: ${objective.label.toLowerCase()} (${objective.tagline.toLowerCase()}). Audience stage: ${objective.stage === "cold" ? "cold, they don't know the brand yet" : objective.stage === "warm" ? "warm, they know the problem or the brand" : "hot, they are close to deciding"}.`,
    ...objective.method,
    `Test these three angles, one per variant, labelled with the angle: ${objective.angles.join(", ")}.`,
    `Button labels for this objective, pick the one that names the action: ${objective.ctas.join(", ")}.`,
    ...AD_POLICY_RULES,
  ].join("\n");
}

/** The objective's preferred layouts first, the rest after; never empties the list. */
export function preferFormats<T extends { id: string }>(
  formats: T[],
  objective: AdObjective | null | undefined,
): T[] {
  if (!objective) return formats;
  const rank = (f: T) => {
    const i = objective.formats.indexOf(f.id);
    return i === -1 ? objective.formats.length : i;
  };
  return [...formats].sort((a, b) => rank(a) - rank(b));
}
