// "Write it for me": turns a format, the brand and a live signal (a trend, a
// seasonal moment, a competitor move, a content gap) into a long, detailed,
// ready-to-generate description. Pure — the server module adds context and the
// model call; this holds the blueprints, the randomness and the clean-up so
// they can be tested.
import type { IdeaSignal, IdeaSource } from "./ideas";
import type { StudioType } from "./formats";
import type { GoalId, StudioControls } from "./jobs";

/** Leaves headroom under IntentSchema's 4000-char brief limit. */
export const PROMPT_MAX_CHARS = 3800;
export const PROMPT_MIN_CHARS = 320;

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

export const PROMPT_BLUEPRINTS: Record<StudioType, PromptBlueprint> = {
  social: {
    sections: [
      "Idea",
      "Why now",
      "Opening line",
      "What to say",
      "Story or example",
      "Voice",
      "Ending",
      "Image idea",
      "Hashtags",
    ],
    guidance:
      "A social post people stop scrolling for. 'Opening line' is the exact first line (under 15 words, specific, no clichés). 'What to say' is 3–5 bullet points of the actual message. 'Story or example' gives one concrete moment or example. 'Ending' is the exact closing line with one clear next step. 'Image idea' describes an optional matching visual in one or two sentences. 'Hashtags' suggests 3–5 relevant tags.",
  },
  carousel: {
    sections: [
      "Idea",
      "Why now",
      "Slide 1",
      "Middle slides",
      "Last slide",
      "Design look",
      "Caption",
    ],
    guidance:
      "A swipeable carousel. 'Slide 1' is the cover headline (under 8 words) plus a short subline. 'Middle slides' lists each slide on its own line as 'Slide N: heading — one sentence of detail', 4–8 slides. 'Last slide' is the recap plus a save/follow prompt. 'Design look' covers colours, typography feel and layout style. 'Caption' is 2–3 sentences to post with it.",
  },
  image: {
    sections: [
      "Idea",
      "Why now",
      "Scene",
      "Main subject",
      "Camera and composition",
      "Lighting",
      "Colours",
      "Mood and style",
      "Details and props",
      "Avoid",
      "Caption idea",
    ],
    guidance:
      "A detailed image-generation brief a photographer or art director could shoot from. Be concrete and visual: materials, textures, time of day, lens feel (e.g. 50mm, shallow depth of field), angle, framing, light direction and quality, a palette that fits the brand. 'Avoid' lists things that would ruin it (e.g. text in the image, clutter, stock-photo poses). 'Caption idea' is the angle and first line for the caption.",
  },
  ad: {
    sections: [
      "What we're promoting",
      "Who it's for",
      "The problem it solves",
      "Why now",
      "Three angles to test",
      "Headline ideas",
      "Main text points",
      "Visual",
      "Button text",
    ],
    guidance:
      "A paid social ad brief. 'Three angles to test' gives three clearly different approaches (e.g. pain, outcome, proof), one line each. 'Headline ideas' gives 3 headlines under 40 characters. 'Main text points' lists what the ad copy must say. 'Visual' describes the ad image in concrete detail sized for a feed. 'Button text' suggests one short call to action. Use only offers, prices and deadlines that exist in the context; otherwise describe the offer generally.",
  },
  video: {
    sections: [
      "Idea",
      "Why now",
      "Length and format",
      "Scene by scene",
      "Camera movement",
      "Lighting and colour",
      "Mood and pacing",
      "Sound",
      "Caption idea",
    ],
    guidance:
      "A short AI-generated video brief (4–8 seconds of footage). 'Scene by scene' lists 2–4 shots on their own lines as 'Shot N (0–2s): what we see and what moves'. Describe real, filmable visuals: subject, action, setting, textures. 'Camera movement' names the moves (push-in, orbit, slow pan, handheld). 'Sound' suggests music or ambient sound. No on-screen text inside the footage. 'Caption idea' is the post caption angle and first line.",
  },
  script: {
    sections: [
      "Idea",
      "Why now",
      "Who's on camera",
      "Opening (first 2 seconds)",
      "Scenes",
      "On-screen text",
      "Ending",
      "Style and pacing",
      "Caption idea",
    ],
    guidance:
      "A Reel / TikTok / Shorts script plan. 'Opening' is the exact first spoken line or on-screen hook. 'Scenes' lists each scene on its own line as 'Scene N (time): say — show'. 'On-screen text' lists the text overlays. 'Ending' is the exact closing line and next step. Keep it filmable on a phone by a small team.",
  },
  article: {
    sections: [
      "Working title",
      "Who it's for",
      "What they're searching for",
      "Why now",
      "Main keywords",
      "Outline",
      "Examples and proof to include",
      "Questions to answer",
      "Ending",
    ],
    guidance:
      "A blog article brief that ranks and gets quoted by AI answers. 'What they're searching for' states the search intent in plain words. 'Main keywords' lists 4–6 phrases. 'Outline' lists 5–8 section headings, each with one line on what it covers. 'Examples and proof to include' names concrete examples, steps or comparisons (no invented statistics). 'Questions to answer' lists 3–5 real questions for an FAQ. 'Ending' says how to close and what to invite the reader to do.",
  },
};

/** Creative directions picked at random each time, so no two prompts feel alike. */
const STORY_SPARKS = [
  "open with a surprising contrast between what people expect and what's true",
  "build it around one tiny, specific behind-the-scenes moment",
  "frame it as a myth most people still believe, then the truth",
  "use a before-and-after transformation",
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

const VISUAL_TYPES = new Set<StudioType>(["image", "ad", "carousel", "social"]);
const MOTION_TYPES = new Set<StudioType>(["video", "script"]);

export type Random = () => number;

function pick<T>(items: readonly T[], random: Random): T {
  return items[Math.floor(random() * items.length) % items.length];
}

/** Creative directions for this call: a story device, plus a look or motion where it applies. */
export function pickSparks(type: StudioType, random: Random = Math.random): string[] {
  const sparks = [pick(STORY_SPARKS, random)];
  if (VISUAL_TYPES.has(type)) sparks.push(`Visual direction: ${pick(VISUAL_SPARKS, random)}`);
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
};

/** Plain-language settings the prompt should respect. */
export function describeSettings(
  type: StudioType,
  controls: Partial<StudioControls> | undefined,
): string {
  const c = controls ?? {};
  const parts: string[] = [];
  if (c.platforms?.length) parts.push(`Platforms: ${c.platforms.join(", ")}`);
  if (c.ratio) parts.push(`Size: ${c.ratio}`);
  if (type === "video" || type === "script")
    parts.push(`Length: ${c.durationSec ?? (type === "video" ? 6 : 30)} seconds`);
  if (type === "carousel") parts.push(`Slides: ${c.slideCount ?? 6}`);
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
