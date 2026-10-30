// Creative knowledge: the production rules behind professional social
// creatives, so every generated picture is briefed like a real shoot rather
// than described with adjectives. It holds:
//   • deliverables — what kind of asset a piece is (offer, launch, event, quote,
//     tips cover...) and the reading order, layout and "never invent" rules each
//     one needs;
//   • the prompt contract — exact copy as data, quality locks, a final check;
//   • the type system and emphasis treatments;
//   • the cover test and the self-review the writers run.
//
// Distilled and rewritten from openly licensed prompt libraries and carousel
// tools; see docs/studio/creative-knowledge.md for the sources and licences.
// Pure and browser-safe: the post-image builder (browser and server), Studio's
// slide, story and brief prompts all read it.
import type { CreativeObjective } from "@/lib/creative-strategy";
import { hash, type ArchetypeId } from "./art-direction";

export type DeliverableId =
  | "promo-offer"
  | "event"
  | "hiring"
  | "greeting"
  | "teaser"
  | "collab"
  | "market-entry"
  | "case-study"
  | "intro"
  | "humour"
  | "launch"
  | "quote"
  | "tips"
  | "feature-board"
  | "comparison"
  | "product-hero"
  | "brand-moment";

export type Deliverable = {
  id: DeliverableId;
  name: string;
  /** Words in the piece that mark it as this kind of asset. */
  signals?: RegExp;
  /** What the eye reads first, second and third. */
  readingOrder: string;
  layout: string;
  /** How the copy is set. */
  copy: string;
  /** What must never be made up for this kind of asset. */
  neverInvent: string;
  /** Layouts (art-direction.ts) that suit it. */
  prefer: readonly ArchetypeId[];
};

const NO_FACTS =
  "prices, discounts, dates, times, codes, addresses, URLs, handles, awards, certifications, statistics, ingredients or claims that are not in the supplied copy";

// Order matters: the first match wins, most specific first.
export const DELIVERABLES: readonly Deliverable[] = [
  {
    id: "promo-offer",
    name: "Offer or sale graphic",
    signals:
      /(\d+\s?% off|\bsale\b|discount|\bpromo\b|coupon|use code|promo code|black friday|cyber monday|limited[- ]time offer|free shipping|\bbogo\b)/i,
    readingOrder:
      "first the offer itself (the biggest element), then what it applies to, then the end date or condition, then the action",
    layout:
      "one bold offer block with the product or a single symbolic object beside it; a small pill or badge for the condition; symmetrical or clean left-text, right-visual split",
    copy: "Offer line huge and high-contrast; condition and action small, each on its own line or pill.",
    neverInvent: `a percentage, price, code or deadline, or ${NO_FACTS}`,
    prefer: ["hero-world", "spotlight-noir", "material-lettering", "monument-object"],
  },
  {
    id: "event",
    name: "Event announcement",
    signals:
      /(webinar|workshop|meetup|masterclass|conference|summit|\blive (on|at|this)|join us|\brsvp|register|grand opening|pop-up|launch party|\bevent\b)/i,
    readingOrder: "first the event title, then the date and time, then the place, then the action",
    layout:
      "one strong visual concept for the theme with a calm, structured information block; date and time grouped together and clearly separated from the title",
    copy: "Title largest; date · time on one line; place on the next; action in a small pill.",
    neverInvent: `sponsors, speakers, ticket prices, venues, time zones, QR codes, or ${NO_FACTS}`,
    prefer: ["portal-pop-out", "name-on-the-wall", "quiet-editorial", "pop-collage"],
  },
  {
    id: "hiring",
    name: "Hiring post",
    signals:
      /(we['’]?re hiring|we are hiring|now hiring|join (our|the) team|open role|job opening|\bvacanc|careers?\b)/i,
    readingOrder:
      "first a line about the standard or craft the team holds itself to (it need not say 'hiring'), then the reveal that the team is hiring and for what, then how to apply",
    layout:
      "a type-led Swiss poster (heavy caps top-left on a generous margin, one accent word, a large empty middle, the reveal set lower and quieter), or one surreal metaphor image about quality with the line beneath it",
    copy: "Opening line of five words or fewer in heavy caps; the reveal one short, quiet line; roles as a numbered list only when supplied; the way to apply small at the end.",
    neverInvent: `roles, salary, benefits, locations, team size, or ${NO_FACTS}`,
    prefer: ["literal-metaphor", "quiet-editorial", "material-lettering", "name-on-the-wall"],
  },
  {
    id: "greeting",
    name: "Greeting for a holiday or occasion",
    signals:
      /(eid mubarak|ramadan (kareem|mubarak)|happy (new year|diwali|holi|holidays|eid|easter|hanukkah|lunar new year|labou?r day|independence day|mother['’]?s day|father['’]?s day|women['’]?s day|thanksgiving)|merry christmas|season['’]?s greetings|wishing (you|everyone|all|the entire)|warm(est)? wishes)/i,
    readingOrder:
      "first the symbol of the day, then the greeting, then the brand's quiet signature",
    layout:
      "one universal symbol of the occasion in the brand's main colour on a plain dark or flat field, at least three quarters of the frame left empty, the greeting small below it",
    copy: "The greeting only, small and calm, one line; any wordplay on the brand belongs in the caption, never on the picture.",
    neverInvent: `opening hours, closures, offers, religious text or quotations, or ${NO_FACTS}`,
    prefer: ["occasion-symbol", "quiet-editorial", "glossy-macro"],
  },
  {
    id: "teaser",
    name: "Teaser before a reveal",
    signals:
      /(coming soon|stay tuned|something (big|new) is coming|sneak peek|guess what['’]?s coming|\bteaser\b|watch this space)/i,
    readingOrder:
      "first the intrigue (one form or a tight crop), then the two words that say something is coming",
    layout:
      "one tight, partial view of the new thing or an abstract form in the brand's colours, cropped off the edges, everything else dark or flat; nothing is fully shown",
    copy: "Two or three words in small, very widely spaced caps; no date unless supplied.",
    neverInvent: `a launch date, a product name, features, or ${NO_FACTS}`,
    prefer: ["glossy-macro", "spotlight-noir", "monument-object"],
  },
  {
    id: "collab",
    name: "Partnership announcement",
    signals:
      /(in (collaboration|partnership) with|partnered with|partnering with|teamed up with|\bcollab(oration)?\b|[a-z]\s[x×]\s[a-z])/i,
    readingOrder: "first the two names joined by ×, then what they made together, then the action",
    layout:
      "a tight, centred lockup with both names set as words and a × between them, the new thing named in one pill below, generous empty space around it, playful shapes cropped by the frame's edges",
    copy: "Both names exactly as supplied with × between them; one short pill for what it is; nothing else.",
    neverInvent: `the partner's logo, the partner's claims, prices, dates, or ${NO_FACTS}`,
    prefer: ["pop-collage", "quiet-editorial", "material-lettering"],
  },
  {
    id: "market-entry",
    name: "Arriving somewhere new",
    signals:
      /(now (open|live|available) in\b|\b(has |have |is |are )?(arrived|landed) in\b|\bexpand(ing|s|ed)? (to|into)\b|\bopening (our first|in)\b|\bfirst store in\b)/i,
    readingOrder:
      "first the place (or the two places, from and to), then what has arrived, then where to find it",
    layout:
      "a from → to journey: one recognisable landmark or object for the place, cut out like a sticker and rising from a floor band, a two-line title with a thin connector word and a heavy place name",
    copy: "A thin connector word ('from', 'to', 'now in') over the heavy place name; one practical line (where or when) only if supplied.",
    neverInvent: `store addresses, opening dates, prices, product ranges, or ${NO_FACTS}`,
    prefer: ["sticker-journey", "touchpoint-world", "pop-collage"],
  },
  {
    id: "case-study",
    name: "Work showcase or case study",
    signals:
      /(case study|\bclient\s*[:\-–]|\bscope\s*[:\-–]|\bproject\s*[:\-–]|our (latest|recent|new) (project|work|branding|website)|portfolio|we (designed|built|rebranded|redesigned|created|launched) .{0,40}\bfor\b|brand identity (design|project)|\brebrand(ed|ing)?\b|website (design|launch) for)/i,
    readingOrder:
      "first the work itself, large and real, then the project's name, then what was done (the scope)",
    layout:
      "the work on one real-world touchpoint per frame (a sign, packaging, a website on a device, merch), full-bleed and boldly cropped, with almost no words; the brand's colour carried by the work, not by added graphics",
    copy: "On the picture: the project's name at most, or nothing. The story and the scope go in the caption.",
    neverInvent: `results, metrics, awards, client quotes, client names, or ${NO_FACTS}`,
    prefer: ["touchpoint-world", "device-showcase", "flat-lay-story", "mixed-media-breakout"],
  },
  {
    id: "intro",
    name: "Who we are",
    signals:
      /(who we are|meet (the team|us)|\bhi,? we['’]?re\b|hello,? we['’]?re\b|nice to meet you|about us|get to know us)/i,
    readingOrder: "first a hook that promises a payoff, then the name, then what the brand does",
    layout:
      "a dark, striking first frame with one bold visual of the brand's shape or colour cropped off two edges and the name set large in the lower left; later frames light and type-led",
    copy: "A short lead word, the name large, one small aside that promises what the reader gets; three type roles at most (statement, warm serif, small label).",
    neverInvent: `services, clients, awards, ratings, testimonials, figures, or ${NO_FACTS}`,
    prefer: ["glossy-macro", "name-on-the-wall", "quiet-editorial"],
  },
  {
    id: "humour",
    name: "Joke or topical post",
    signals:
      /(\bmeme\b|\bjoke\b|\bpov:|\bnobody:|not today|plot twist|literally just|be like\b|when (your|the) (client|boss)|hold your horses)/i,
    readingOrder: "first the setup in small type, then the punchline large, then nothing",
    layout:
      "either a type-only template (a small setup line and a punchline about six times larger in the brand's most characterful face on a two-tone grainy field), or one photoreal impossible scene with a short reaction line",
    copy: "Setup one short line; punchline two to four words. The link back to the brand belongs in the caption.",
    neverInvent: `another company's logo or product, quotes from real people, or ${NO_FACTS}`,
    prefer: ["what-if-render", "pop-collage", "literal-metaphor"],
  },
  {
    id: "launch",
    name: "Launch key visual",
    signals:
      /(introducing|\blaunch(ing|ed|es)?\b|now available|out now|just dropped|new drop|new (product|collection|flavou?r|release|range)|meet the new)/i,
    readingOrder:
      "first the new thing itself, then its name, then the one line that says why it matters",
    layout:
      "the new thing as the hero at about 60% of the frame on a pedestal, surface or in its own world, with one distinctive motif; a clear top safe zone for the headline",
    copy: "Name or headline large; one tagline; nothing else.",
    neverInvent: `features, specifications, availability, packaging details, or ${NO_FACTS}`,
    prefer: ["hero-world", "monument-object", "spotlight-noir", "mirror-kaleidoscope"],
  },
  {
    id: "quote",
    name: "Quote or testimonial card",
    signals: /(testimonial|customer (said|says|review|story)|“[^”]{12,}”|\bquote card\b)/i,
    readingOrder: "first the quote, then who said it, then nothing else",
    layout:
      "type-led card: generous margins, one quiet texture or photograph in the background, quotation marks used once, lots of line spacing",
    copy: "The quote exactly as supplied, in an elegant readable face; attribution small below it.",
    neverInvent: `the quote, a name, a role, a company, a star rating, a portrait, or ${NO_FACTS}`,
    prefer: ["quiet-editorial", "material-lettering", "double-exposure"],
  },
  {
    id: "tips",
    name: "Tips or how-to cover",
    signals:
      /(\b\d+\s+(tips|ways|steps|mistakes|habits|ideas|reasons|things|rules|lessons|tools)\b|how to|checklist|step[- ]by[- ]step|\bguide\b|cheat ?sheet|myths?)/i,
    readingOrder:
      "first the promise (with its number, if any), then the topic, then the visual clue",
    layout:
      "headline-led cover with the number oversized in the accent colour, one simple visual metaphor and a reusable system the later slides can follow",
    copy: "Headline of eight words or fewer; the number or key word emphasised; no body paragraph.",
    neverInvent: `statistics, results or ${NO_FACTS}`,
    prefer: ["number-monument", "flat-lay-story", "exploded-view", "literal-metaphor"],
  },
  {
    id: "feature-board",
    name: "Feature or benefit board",
    signals:
      /(key features|new features?|what'?s inside|made (with|from)|ingredients|tech specs|specifications)/i,
    readingOrder: "first the product, then each feature label, then the headline",
    layout:
      "one accurate hero with two or three detail crops or an exploded stack, joined by thin leader lines to the right physical spot",
    copy: "Short labels taken from the copy only; large and unambiguous.",
    neverInvent: `features, test results, percentages, competitor comparisons, or ${NO_FACTS}`,
    prefer: ["callout-board", "exploded-view", "flat-lay-story"],
  },
  {
    id: "comparison",
    name: "Comparison or before/after",
    signals:
      /(before (and|&|\/) after|\bvs\.?\b|versus|compared? (to|with)|instead of|old way|new way)/i,
    readingOrder: "first the difference, then the two labels, then the headline",
    layout:
      "two matched halves with identical framing and light, one variable changed, joined by a crisp divider",
    copy: "One short label per side and one headline; nothing else.",
    neverInvent: `results, numbers, timelines, or ${NO_FACTS}`,
    prefer: ["clean-split", "literal-metaphor"],
  },
  {
    id: "product-hero",
    name: "Product hero",
    readingOrder: "first the product, then the headline, then the brand feeling",
    layout:
      "the product large and accurate (60–75% of the frame), clean silhouette, honest materials, one surface or set that fits the brand; a backdrop tinted from the product's own colour with one contrasting accent; the product itself is in the scene, never a photo inside a frame or card",
    copy: "One short headline at most; the product's own label is the only other writing.",
    neverInvent: `label text, colourways, accessories, or ${NO_FACTS}`,
    prefer: ["spotlight-noir", "hero-world", "monument-object", "material-swap", "benefit-list"],
  },
  {
    id: "brand-moment",
    name: "Brand moment",
    readingOrder: "first the image idea, then the headline, then the brand feeling",
    layout: "one scroll-stopping idea with a single focal point and a calm area for the headline",
    copy: "One short headline, optionally one support line.",
    neverInvent: NO_FACTS,
    prefer: [],
  },
];

/** What kind of asset the piece is, from its own words. Pure string work. */
export function detectDeliverable(args: {
  text: string;
  objective?: CreativeObjective | null;
  physicalProduct?: boolean;
}): Deliverable {
  const text = args.text.slice(0, 4000);
  const match = DELIVERABLES.find((d) => d.signals?.test(text));
  if (match) return match;
  if (args.objective === "product-launch") return byId("launch");
  if (args.physicalProduct && (args.objective === "conversion" || args.objective === "awareness"))
    return byId("product-hero");
  return byId("brand-moment");
}

function byId(id: DeliverableId): Deliverable {
  return DELIVERABLES.find((d) => d.id === id)!;
}

export function deliverableById(id: unknown): Deliverable | null {
  return DELIVERABLES.find((d) => d.id === id) ?? null;
}

export function deliverablePromptLines(d: Deliverable): string[] {
  return [
    `DELIVERABLE — ${d.name}. Brief it like a production job, not a mood:`,
    `• Reading order: ${d.readingOrder}.`,
    `• Layout: ${d.layout}.`,
    `• Copy: ${d.copy}`,
    `• Never invent: ${d.neverInvent}.`,
  ];
}

/* ───────────── exact copy, emphasis and the final check ───────────── */

const EMPHASIS = [
  "set them in the accent colour, same size and weight as the rest",
  "set them about one and a half times larger than the rest of the headline",
  "underline them with one hand-drawn brushstroke in the accent colour",
  "put a soft highlighter swipe in the accent colour behind them",
  "reverse them out of a solid accent-colour block",
] as const;

/** One emphasis treatment per brand, so a whole series highlights the same way. */
export function emphasisTreatment(seed: string): string {
  return EMPHASIS[hash(`emphasis:${seed}`) % EMPHASIS.length];
}

export type CopyLine = { label: string; text: string };

/**
 * Exact copy as data: the image model sets these lines and nothing else.
 * Empty lines are dropped; an empty list returns nothing.
 */
export function verbatimTextBlock(args: {
  lines: CopyLine[];
  emphasis?: string | null;
  emphasisSeed?: string;
}): string[] {
  const lines = args.lines
    .map((l) => ({ label: l.label, text: l.text.replace(/\s+/g, " ").trim() }))
    .filter((l) => l.text);
  if (!lines.length) return [];
  const emphasis = args.emphasis?.trim();
  const inHeading = emphasis && lines.some((l) => l.text.includes(emphasis));
  return [
    "TEXT — RENDER VERBATIM (exact spelling, case, punctuation and digits):",
    ...lines.map((l) => `${l.label}: ${JSON.stringify(l.text)}`),
    `Use exactly ${lines.length === 1 ? "this line, once" : `these ${lines.length} lines, each once`}. Do not add, translate, paraphrase, repeat or decorate any other text: no extra slogan, price, date, URL, handle, label or fine print.`,
    inHeading
      ? `Emphasis: the words ${JSON.stringify(emphasis)} carry the meaning; ${emphasisTreatment(args.emphasisSeed ?? emphasis)}.`
      : "",
  ].filter(Boolean);
}

/** How professional posts emphasise: one device, used once. */
export const EMPHASIS_RULE =
  "Emphasis comes from one change only: a weight contrast (a light word or line, then a heavy one) or one key word in the accent colour; never both on one frame, never more than one emphasised phrase.";

/** Type that reads on a phone, stated in proportions so it fits any canvas. */
export const TYPE_SYSTEM: readonly string[] = [
  "Type scale (proportions of the canvas width): cover or hook headline 6–9%, inside headlines 3.5–4.5%, supporting copy 2.2–2.6%, small labels 1.5–1.9%. Headline line height about 1.1, body about 1.45.",
  "At most two typefaces: one display face for headlines, one quiet text face. Three sizes at most on one frame.",
  "Contrast at least 4.5:1 between type and what is directly behind it; put type on a calm area, solid band or soft scrim, never over busy detail.",
  "Margins of 6–8% on every side; keep words and faces inside the central safe area, clear of the bottom strip where app buttons sit.",
  EMPHASIS_RULE,
];

/** The last thing in an image prompt: check, and simplify instead of adding. */
export function qualityCheckLines(opts: { hasText: boolean; hasProduct?: boolean }): string[] {
  return [
    "QUALITY CHECK BEFORE FINALIZING:",
    opts.hasText
      ? "• Read every word back character by character against the exact copy; nothing extra, nothing missing."
      : "• No letters, numbers or logos anywhere in the frame.",
    "• Count hands, fingers, faces and products; no duplicates, no fused or missing parts.",
    opts.hasProduct
      ? "• The product's silhouette, proportions, materials and label layout match the brand's product; nothing invented on the pack."
      : "",
    "• One clear focal point that reads at thumbnail size; everything important inside the safe area.",
    "• No unrelated props, clip-art or corner doodles; every object in the frame belongs to the idea.",
    "• If anything fails or the frame feels busy, simplify: drop the smallest text, remove a prop, widen the space. Never fix it by adding.",
  ].filter(Boolean);
}

/* ───────────── what the writers check before answering ───────────── */

/** The cover has to work on its own in a fast feed. */
export const COVER_TEST: readonly string[] = [
  "The cover passes the two-second test: read in under two seconds on a phone, eight words or fewer, names the topic in plain words, and opens one question the next slide answers.",
  "Strong cover shapes: a sharp question the reader is already asking, one surprising figure taken from the supplied facts, a bold claim the carousel then proves, or a specific outcome. Never a description of the topic, never clickbait.",
];

/** Silent self-review before returning JSON (does the piece earn the scroll?). */
export const SELF_REVIEW =
  "Before you answer, review your own draft silently: does the first frame stop the scroll, is every slide readable in under two seconds, is there exactly one idea per slide, what can be removed, and does it feel premium and on-brand? Fix anything that fails, then return only the final JSON.";

/** How the concept writer decides what to show. */
export const CONCEPT_METHOD: readonly string[] = [
  "Decide the one moment or image that sells the message best before you describe it. Weigh it against two other options in your head and keep the strongest; describe only the winner.",
  "The glance test: say to yourself what a viewer should feel and understand in one glance in a fast feed, and make every choice serve that.",
  "Describe style through eras, techniques, materials and light, never a living artist's name or another brand's campaign.",
  "Keep depth in three layers (foreground, subject, background) and keep the subject's silhouette readable at thumbnail size, with a calm area where the headline sits.",
];
