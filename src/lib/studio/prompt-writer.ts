// "Write it for me": turns a format, the brand and a live signal (a trend, a
// seasonal moment, a competitor move, a content gap) into a long, detailed,
// ready-to-generate description. Pure — the server module adds context and the
// model call; this holds the blueprints, the randomness and the clean-up so
// they can be tested.
import type { IdeaSignal, IdeaSource } from "./ideas";
import type { StudioType } from "./formats";
import { genericPhrases } from "./copy-qa";
import type { GoalId, StudioControls } from "./jobs";

/** Leaves headroom under IntentSchema's 4000-char brief limit. */
export const PROMPT_MAX_CHARS = 1600;
export const PROMPT_MIN_CHARS = 100;

/**
 * "fresh": nothing written yet — invent the whole idea.
 * "expand": the person wrote something — keep their idea and make it complete.
 */
export type PromptMode = "fresh" | "expand";

export type PromptBlueprint = {
  /** The labelled sections the written prompt must contain, in order. */
  sections: string[];
  /** Format-specific guidance for the writer. */
  guidance: string;
};

/**
 * Short, sharp briefs (2026-11). The old blueprints asked for 250–550 words
 * with camera, lens, lighting and colour sections; those overrode the brand's
 * own look, style bible and Studio's layout library and made generic stock
 * pictures. A brief now says WHAT the piece is (the idea, the exact words,
 * the one picture idea); HOW it looks comes from the brand and Studio.
 */
export const PROMPT_BLUEPRINTS: Record<StudioType, PromptBlueprint> = {
  social: {
    sections: ["Idea", "Opening line", "Message", "Ending", "Picture"],
    guidance:
      "'Opening line' is the exact first line (under 12 words, specific, no cliché). 'Message' is 2–3 short bullet points. 'Ending' is the exact last line with one next step. 'Picture' is one sentence: the single thing the picture shows.",
  },
  carousel: {
    sections: ["Idea", "Cover", "Slides", "Last slide", "Caption"],
    guidance:
      "'Cover' is the exact cover headline (under 8 words, one sharp promise, question or number from the context) and a short subline. 'Slides' lists only the inside slides, between the cover and the last slide, one per line as 'Slide N: heading — one short line', numbered from Slide 2; write exactly the number of inside slides Settings gives (the total minus the cover and the last slide), never more, and never name a different slide count anywhere. 'Last slide' is the takeaway and one action. 'Caption' is one or two sentences.",
  },
  story: {
    sections: ["Idea", "Frame 1", "Middle frames", "Last frame"],
    guidance:
      "1 to 5 vertical frames. 'Frame 1' is the hook (under 8 words). 'Middle frames' lists 'Frame N: headline (under 9 words) — one short line'. 'Last frame' is one next step (reply, link in bio, visit). Never mention link, poll or music stickers.",
  },
  image: {
    sections: ["Idea", "Headline", "Supporting line", "Picture", "Caption idea"],
    guidance:
      "'Headline' is the exact words set on the picture (2–6 words, punchy, no full sentence). 'Supporting line' is optional small text (under 10 words) or 'none'. 'Picture' is one or two sentences: what a real, believable post shows (the product in real use, the place, the people at work, the result, or a clean type-led design), concrete and specific to this brand. Never a surreal trick, a giant object or a visual metaphor. Say nothing about camera, lens, lighting or colours: the brand's look decides those. 'Caption idea' is the caption's angle and first line.",
  },
  ad: {
    sections: ["Offer", "For", "Angle", "Headline", "Supporting line", "Picture", "Button"],
    guidance:
      "'Offer' is what is promoted, only as the brand states it. 'For' is the customer in a few words. 'Angle' is the one reason to act now (pain, outcome or proof). 'Headline' is the exact words on the ad (under 6 words). 'Supporting line' is under 12 words. 'Picture' is one sentence: the hero and the idea, no camera or colour notes. 'Button' is 1–3 words.",
  },
  video: {
    sections: ["Idea", "Shots", "Sound", "Caption idea"],
    guidance:
      "'Shots' lists enough shots to fill the selected length, each on its own line as 'Shot N (0–2s): what we see and what moves', real filmable visuals, one camera move each. No on-screen text inside the footage. 'Sound' is one line. 'Caption idea' is the caption's first line.",
  },
  script: {
    sections: ["Idea", "Hook", "Scenes", "Ending", "Caption idea"],
    guidance:
      "'Hook' is the exact first spoken line or on-screen text. 'Scenes' lists 'Scene N (time): say — show'. 'Ending' is the exact closing line and next step. Filmable on a phone by a small team.",
  },
  article: {
    sections: [
      "Working title",
      "Who it's for",
      "Search intent",
      "Keywords",
      "Outline",
      "Questions to answer",
    ],
    guidance:
      "'Search intent' is one plain sentence. 'Keywords' lists 4–6 phrases. 'Outline' lists 5–8 headings, each with one line. 'Questions to answer' lists 3–5 real questions. No invented statistics.",
  },
};

/** Creative directions picked at random each time, so no two prompts feel alike. */
const STORY_SPARKS = [
  "open with a surprising contrast between what people expect and what's true",
  "build it around one tiny, specific behind-the-scenes moment",
  "frame it as a myth most people still believe, then the truth",
  "tell it through a customer's everyday situation",
  "make it a quick, genuinely useful how-to",
  "take a clear, friendly stance people will want to agree or argue with",
  "connect it to something happening this week or season",
  "compare it to a familiar everyday experience",
  "count down a short list with the best point saved for last",
  "share an honest lesson learned the hard way",
  "answer the question customers ask most, in an unexpected way",
  "zoom in on one detail most competitors overlook",
  "turn it into a small challenge the audience can try today",
  "show the hidden cost of doing nothing",
  "make the product a quiet supporting character, not the hero",
];

const VISUAL_SPARKS = [
  "warm golden-hour light with long soft shadows",
  "clean, bright minimal studio look with lots of empty space",
  "moody low-key lighting with one strong highlight",
  "overhead flat-lay arrangement on a textured surface",
  "candid documentary feel, natural and unposed",
  "macro close-up that celebrates texture and detail",
  "bold colour-blocking using the brand palette",
  "cinematic wide shot with generous negative space",
  "soft pastel morning light, airy and calm",
  "rich, saturated editorial look with deep contrast",
  "cosy indoor scene with warm practical lights",
  "fresh outdoor setting with natural greenery",
];

const MOTION_SPARKS = [
  "a slow cinematic push-in",
  "a smooth orbit around the subject",
  "a handheld first-person feel",
  "a top-down reveal",
  "a satisfying match cut between two moments",
  "gentle slow motion on the key action",
  "a quick, energetic sequence of close-ups",
  "a steady glide from wide to detail",
];

const MOTION_TYPES = new Set<StudioType>(["video", "script"]);

export type Random = () => number;

function pick<T>(items: readonly T[], random: Random): T {
  return items[Math.floor(random() * items.length) % items.length];
}

/**
 * Creative directions for this call: a story device, plus motion for video.
 * Pictures get no random visual direction any more: a random "golden hour"
 * or "flat-lay" fought the brand's own look and made stock-looking posts.
 */
export function pickSparks(type: StudioType, random: Random = Math.random): string[] {
  const sparks = [pick(STORY_SPARKS, random)];
  if (MOTION_TYPES.has(type)) {
    sparks.push(`Visual direction: ${pick(VISUAL_SPARKS, random)}`);
    sparks.push(`Camera: ${pick(MOTION_SPARKS, random)}`);
  }
  return sparks;
}

/** Signals worth writing from, favouring what's timely and trending. */
const SOURCE_BOOST: Record<IdeaSource, number> = {
  trend: 30,
  season: 25,
  competitor: 15,
  momentum: 10,
  gap: 5,
  pillar: 0,
  campaign: 20,
};

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * A weighted-random signal from the strongest few, skipping any the person has
 * recently been given, so repeated clicks travel across different topics.
 */
export function pickSignal(
  signals: IdeaSignal[],
  recentlyUsed: string[],
  random: Random = Math.random,
): IdeaSignal | null {
  const used = new Set(recentlyUsed.map(normalize));
  const fresh = signals.filter((s) => !used.has(normalize(s.headline)));
  const pool = (fresh.length ? fresh : signals)
    .map((s) => ({ s, w: Math.max(1, s.weight + SOURCE_BOOST[s.source]) }))
    .sort((a, b) => b.w - a.w)
    .slice(0, 8);
  if (!pool.length) return null;
  const total = pool.reduce((sum, p) => sum + p.w, 0);
  let roll = random() * total;
  for (const p of pool) {
    roll -= p.w;
    if (roll <= 0) return p.s;
  }
  return pool[pool.length - 1].s;
}

export const SIGNAL_LABEL: Record<IdeaSource, string> = {
  trend: "Trending",
  season: "Coming up",
  competitor: "Competitor move",
  gap: "Content gap",
  pillar: "Your brand",
  momentum: "Working well",
  campaign: "Your campaign",
};

/** The slide count a person picked (3 to 10, default 6). */
export function slideTotal(count: number | undefined): number {
  return Math.max(3, Math.min(10, Math.round(count ?? 6)));
}

/** "6 in total: the cover, 4 inside slides and the last slide". */
export function carouselSlidesLine(count: number | undefined): string {
  const total = slideTotal(count);
  const inside = total - 2;
  return `${total} in total: the cover, ${inside} inside ${inside === 1 ? "slide" : "slides"} and the last slide`;
}

const SLIDE_LINE = /^\s*(?:[-*•]\s*)?slide\s+(\d+)\s*[:.)\-–—]\s*/i;

/**
 * Keep a carousel brief to the slide count the person picked: the 'Slides'
 * section holds the inside slides only, numbered from 2. Extra lines are
 * dropped and the rest renumbered; a short list is left for the writer to fill.
 * Pure, so the brief in the box always matches the stepper.
 */
export function fitBriefSlides(prompt: string, count: number | undefined): string {
  const total = slideTotal(count);
  const inside = total - 2;
  let kept = 0;
  const out: string[] = [];
  for (const line of prompt.split("\n")) {
    const m = SLIDE_LINE.exec(line);
    if (!m) {
      out.push(line);
      continue;
    }
    if (kept >= inside) continue;
    kept += 1;
    const number = String(kept + 1);
    out.push(line.replace(SLIDE_LINE, (whole) => whole.replace(m[1], number)));
  }
  // A slide count written in the text that disagrees with the stepper is corrected.
  return out
    .join("\n")
    .replace(/\b(\d{1,2})([- ])(slides?)\b/gi, (whole, n: string, sep: string, word: string) =>
      Number(n) === total ? whole : `${total}${sep}${word}`,
    );
}

/** How many 'Slide N' lines a brief lists. */
export function briefSlideLines(prompt: string): number {
  return prompt.split("\n").filter((line) => SLIDE_LINE.test(line)).length;
}

/** Plain-language settings the prompt should respect. */
export function describeSettings(
  type: StudioType,
  controls: Partial<StudioControls> | undefined,
): string {
  const c = controls ?? {};
  const parts: string[] = [];
  if (c.platforms?.length) parts.push(`Platforms: ${c.platforms.join(", ")}`);
  if (c.ratio) parts.push(`Size: ${c.ratio}`);
  if (type === "video" || type === "script" || (type === "story" && c.storyMode === "video"))
    parts.push(
      `Length: ${c.durationSec ?? (type === "video" || (type === "story" && c.storyMode === "video") ? 10 : 30)} seconds`,
    );
  if (type === "carousel") parts.push(`Slides: ${carouselSlidesLine(c.slideCount)}`);
  if (type === "article") parts.push(`Length: ${c.length ?? "standard"}`);
  if (c.includeImage) parts.push("Include an image");
  if (c.tone) parts.push(`Voice: ${c.tone}`);
  if (c.cta) parts.push(`Next step for people: ${c.cta}`);
  return parts.join("\n");
}

/**
 * Tidy the model's prompt for the description box: plain "Label:" sections,
 * no markdown headings or bold markers, no runaway blank lines, within limits.
 */
export function cleanPrompt(raw: string): string {
  const text = raw
    .replace(/\r\n?/g, "\n")
    .replace(/^[ \t]*#{1,6}[ \t]*/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/^[ \t]*[*•][ \t]+/gm, "- ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text.length <= PROMPT_MAX_CHARS) return text;
  const cut = text.slice(0, PROMPT_MAX_CHARS);
  const lastBreak = cut.lastIndexOf("\n");
  return (lastBreak > PROMPT_MAX_CHARS * 0.7 ? cut.slice(0, lastBreak) : cut).trim();
}

export const PROMPT_GOALS: GoalId[] = [
  "awareness",
  "engagement",
  "leads",
  "launch",
  "education",
  "offer",
];

/* ───────────────────────── the brief's QA pass (free) ───────────────────────── */

/** Sections whose text is set on the picture, and the most words each may have. */
const ON_PICTURE: Record<string, number> = { headline: 7, cover: 10, "frame 1": 9, hook: 16 };

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * What is wrong with a written brief, in plain words the writer can fix, or
 * [] when it passes. Pure: no model call. `known` is everything the brand and
 * the person really said; a figure that isn't in it is invented.
 */
export function briefIssues(args: {
  prompt: string;
  type: StudioType;
  known: string;
  brandName?: string | null;
  /** A carousel's slide count from the stepper. */
  slideCount?: number;
}): string[] {
  const issues: string[] = [];
  const text = args.prompt ?? "";
  const lower = text.toLowerCase();
  const blueprint = PROMPT_BLUEPRINTS[args.type];
  const labels = new Map<string, string>();
  let current: string | null = null;
  for (const line of text.split("\n")) {
    const m = /^\s*([A-Za-z][A-Za-z0-9 '’]{0,30}):\s*(.*)$/.exec(line);
    if (m && blueprint.sections.some((s) => s.toLowerCase() === m[1].trim().toLowerCase())) {
      current = m[1].trim().toLowerCase();
      labels.set(current, m[2].trim());
    } else if (current && line.trim()) {
      labels.set(current, `${labels.get(current) ?? ""} ${line.trim()}`.trim());
    }
  }
  const missing = blueprint.sections.filter((s) => !labels.get(s.toLowerCase()));
  if (missing.length) issues.push(`Missing sections: ${missing.join(", ")}.`);

  if (args.type === "carousel") {
    const inside = slideTotal(args.slideCount) - 2;
    const listed = briefSlideLines(text);
    if (listed > inside)
      issues.push(
        `'Slides' lists ${listed} slides but the carousel has ${inside} inside slides (${slideTotal(args.slideCount)} in total with the cover and the last slide). List exactly ${inside}.`,
      );
  }

  const words = countWords(text);
  if (args.type !== "article" && words > 200)
    issues.push(`Too long (${words} words). Keep it under 160 words: one idea, said once.`);

  const found = genericPhrases(lower);
  if (found.length) issues.push(`Generic phrases to replace with specifics: ${found.join(", ")}.`);

  for (const [label, max] of Object.entries(ON_PICTURE)) {
    const value = labels.get(label);
    if (value && countWords(value.replace(/[—–-].*$/, "")) > max)
      issues.push(`'${label}' is set on the picture and must be ${max} words or fewer.`);
  }

  // Figures (prices, percentages, counts) must come from the brand or the person.
  const known = (args.known ?? "").toLowerCase();
  const figures = [
    ...new Set(text.match(/(?:[$€£₹]|rs\.?\s?)?\d[\d,.]*\s?(?:%|k\b|x\b|off\b)?/gi) ?? []),
  ]
    .map((f) => f.trim())
    .filter((f) => /\d{2,}|%|[$€£₹]|off/i.test(f))
    .filter((f) => !/^(?:19|20)\d{2}$/.test(f))
    .filter(
      (f) =>
        !known.includes(f.toLowerCase().replace(/\s+/g, "")) && !known.includes(f.toLowerCase()),
    );
  if (figures.length)
    issues.push(
      `These figures aren't in the brand facts or the person's words; remove them or describe it without a number: ${figures.slice(0, 4).join(", ")}.`,
    );
  return issues;
}
