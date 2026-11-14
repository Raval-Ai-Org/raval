// brief-visual.ts — what the picture is told about the post (pure).
//
// The caption and the picture are two different things. The caption is
// written for the feed; the picture is a clean banner with its own short
// headline. The picture only ever learns the post's TOPIC from the caption,
// never its sentences, or the image model typesets the caption.
//
// This module:
//   - reads the picture sections "Write it for me" wrote into the brief
//     (Image idea, Scene, Visual, Design look...), so the picture is made from
//     the idea the person saw, not guessed from the caption;
//   - turns a caption into a one-line topic;
//   - checks the picture brief before any image spend (`preflightPictureBrief`):
//     a scene always exists, the headline is a short banner line and not a
//     caption sentence, and no long caption sentence is left in the scene.
import type { StudioType } from "./formats";

/** The brief sections (prompt-writer.ts blueprints) that describe the picture. */
export const VISUAL_SECTIONS: Partial<Record<StudioType, string[]>> = {
  social: ["Image idea"],
  image: [
    "Scene",
    "Main subject",
    "Camera and composition",
    "Lighting",
    "Colours",
    "Mood and style",
    "Details and props",
    "Avoid",
  ],
  ad: ["Visual"],
  carousel: ["Design look"],
  story: [],
  video: ["Scene by scene", "Camera movement", "Lighting and colour", "Mood and pacing"],
};

/** Every label the blueprints use, so a section ends where the next begins. */
const ALL_LABELS = [
  "Idea",
  "Why now",
  "Opening line",
  "What to say",
  "Story or example",
  "Voice",
  "Ending",
  "Image idea",
  "Hashtags",
  "Slide 1",
  "Middle slides",
  "Last slide",
  "Design look",
  "Caption",
  "Frame 1",
  "Middle frames",
  "Last frame",
  "Reply prompt",
  "Scene",
  "Main subject",
  "Camera and composition",
  "Lighting",
  "Colours",
  "Mood and style",
  "Details and props",
  "Avoid",
  "Caption idea",
  "What we're promoting",
  "Who it's for",
  "The problem it solves",
  "Three angles to test",
  "Headline ideas",
  "Main text points",
  "Visual",
  "Button text",
  "Length and format",
  "Scene by scene",
  "Camera movement",
  "Lighting and colour",
  "Mood and pacing",
  "Sound",
];

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const LABEL_LINE = new RegExp(
  `^[ \\t]*(${[...ALL_LABELS]
    .sort((a, b) => b.length - a.length)
    .map(escape)
    .join("|")})[ \\t]*:[ \\t]*(.*)$`,
  "i",
);

/** The brief's "Label: …" sections, by lower-cased label. Unlabelled text is ignored. */
export function briefSections(brief: string): Map<string, string> {
  const out = new Map<string, string>();
  let current: string | null = null;
  for (const line of (brief ?? "").replace(/\r\n?/g, "\n").split("\n")) {
    const match = LABEL_LINE.exec(line);
    if (match) {
      current = match[1].toLowerCase();
      out.set(current, match[2].trim());
      continue;
    }
    if (current && line.trim())
      out.set(current, `${out.get(current) ?? ""}\n${line.trim()}`.trim());
  }
  return out;
}

/**
 * The picture the brief asked for, as written, or "" when the brief has no
 * picture sections (a person's own short brief).
 */
export function briefVisualIdea(brief: string, type: StudioType, maxChars = 1000): string {
  const labels = VISUAL_SECTIONS[type] ?? [];
  if (!labels.length) return "";
  const sections = briefSections(brief);
  const parts = labels
    .map((label) => {
      const text = sections.get(label.toLowerCase());
      return text ? `${label}: ${text}` : "";
    })
    .filter(Boolean);
  return parts.join("\n").slice(0, maxChars).trim();
}

const URL = /https?:\/\/\S+|www\.\S+/gi;
const TAG = /(^|\s)[#@][\p{L}\p{N}_]+/gu;
const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;

function plain(text: string): string {
  return text.replace(URL, " ").replace(TAG, " ").replace(EMOJI, " ").replace(/\s+/g, " ").trim();
}

/**
 * The post's topic in one short line, from its title or caption: what the
 * picture is about. It is context only and is never typeset.
 */
export function postTopic(args: { title?: string | null; caption?: string | null }): string {
  const title = plain(args.title ?? "");
  if (title.length >= 8) return title.slice(0, 120);
  const caption = plain(args.caption ?? "");
  const first = caption.split(/(?<=[.!?])\s+/)[0] ?? caption;
  return first.slice(0, 140).trim();
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Caption sentences long enough that drawing them would make the picture a wall of text. */
function captionSentences(caption: string): string[] {
  return plain(caption)
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => words(s).length >= 8);
}

export type PictureBrief = {
  /** What to draw. Never empty. */
  scene: string;
  /** The banner headline set in the picture, or null for no words. */
  headline: string | null;
  /** What the check changed, for logs and tests. */
  notes: string[];
};

/**
 * The check before the image model is called (free, no model call):
 *   - the scene is the writer's, else the brief's picture idea, else a clean
 *     banner built on the topic;
 *   - no caption sentence of 8+ words survives inside the scene;
 *   - the headline is at most `maxWords` words and is not a caption sentence;
 *     a look with no words on pictures gets none.
 */
export function preflightPictureBrief(args: {
  scene?: string | null;
  briefIdea?: string | null;
  headline?: string | null;
  caption?: string | null;
  topic: string;
  maxWords?: number;
  /** Who the picture is for and what it must do (the writer's one line). */
  purpose?: string | null;
  /** What the picture has to do for this kind of post. */
  job?: PictureJob | null;
}): PictureBrief {
  const notes: string[] = [];
  const maxWords = args.maxWords ?? 6;
  let scene = (args.scene ?? "").trim();
  if (!scene && args.briefIdea?.trim()) {
    scene = args.briefIdea.trim();
    notes.push("scene from brief");
  }
  if (!scene) {
    scene = `A clean, professionally designed picture about: ${args.topic}. One clear hero subject that shows this topic, a calm area for a short headline, and nothing else competing for attention.`;
    notes.push("scene from topic");
  }
  // The headline is handled below, on its own; a copy of it in the scene
  // would come back on the picture even after the check dropped it.
  scene = scene.replace(/^\s*Text in visual:.*$/gim, "").trim();
  const sentences = captionSentences(args.caption ?? "");
  for (const sentence of sentences) {
    const pattern = new RegExp(escape(sentence).replace(/\s+/g, "\\s+"), "i");
    if (pattern.test(scene)) {
      scene = scene.replace(pattern, " ").replace(/\s+/g, " ").trim();
      notes.push("caption sentence removed from scene");
    }
  }
  // The picture's job and purpose lead, so the image model knows whether it
  // is making a sale banner, a question people answer or a candid moment.
  const lead = [
    args.job ? `Picture's job: ${args.job.scene}` : "",
    args.purpose?.trim() ? `Purpose: ${args.purpose.trim().slice(0, 300)}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  scene = (lead ? `${lead}\n${scene}` : scene).slice(0, 1600);

  let headline = (args.headline ?? "")
    .replace(/\s+/g, " ")
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .trim();
  if (maxWords === 0 && headline) {
    headline = "";
    notes.push("look allows no words");
  }
  const count = words(headline).length;
  if (headline && count > Math.max(1, maxWords)) {
    headline = "";
    notes.push("headline too long");
  }
  if (headline) {
    // The caption's opening line set on the picture makes the two say the same
    // thing twice; the banner gets its own line.
    const key = words(headline).join(" ");
    const lines = (args.caption ?? "")
      .split(/(?<=[.!?])\s+|\n+/)
      .map((s) => words(plain(s)).join(" "))
      .filter(Boolean);
    if (lines.some((line) => line === key)) {
      headline = "";
      notes.push("headline was a caption sentence");
    }
  }
  return { scene, headline: headline || null, notes };
}

/* ───────────────────────── the picture's job, by kind of post ───────────────────────── */

/**
 * What the picture has to do. A post is not always a sale: an engagement
 * post asks for a reply, a tip teaches one thing, proof shows a result, a
 * behind-the-scenes post looks candid. The kind (categories.ts) decides,
 * else the goal; with neither, the picture is a calm brand moment.
 */
export type PictureJobId = "sell" | "engage" | "teach" | "proof" | "candid" | "quote" | "brand";

export type PictureJob = {
  id: PictureJobId;
  /** What the scene must make obvious. */
  scene: string;
  /** What the banner line is, or when to leave it out. */
  headline: string;
  /** What the reviewer checks the finished picture for. */
  review: string;
};

const JOBS: Record<PictureJobId, PictureJob> = {
  sell: {
    id: "sell",
    scene:
      "A clean, professional sales banner: the brand's real product or service is the one hero, shown at its best, with the offer or promise easy to see and a calm area for the headline.",
    headline:
      "the promise or the offer exactly as the brief states it (never an invented price, discount or deadline), like a sales banner",
    review:
      "A sales picture: the product or service is the clear hero and the offer or promise reads at a glance.",
  },
  engage: {
    id: "engage",
    scene:
      "A picture people want to answer: a relatable moment, a choice or a question the audience has an opinion on, staged so the reply is obvious (for this-or-that, the two options side by side). It does not sell.",
    headline:
      "the question or the choice people reply to, in their everyday words (for example 'Team mornings or nights?'), never a sales line",
    review:
      "An engagement picture: it shows the question, choice or relatable moment the post is about and invites a reply; it should not look like an ad.",
  },
  teach: {
    id: "teach",
    scene:
      "One clear, editorial picture of the one idea the post teaches (the tip, the myth, the before and after, the list's subject), simple enough to understand in a second.",
    headline: "the tip, the myth or the list's promise in a few plain words, never a sales line",
    review:
      "A teaching picture: one clear visual of the idea the post explains, uncluttered, nothing that sells.",
  },
  proof: {
    id: "proof",
    scene:
      "The result the post proves, shown for real: the outcome, the change or the customer's moment, believable and specific, never a staged stock smile.",
    headline:
      "the result in a few words, only as the brief states it; never an invented figure, rating or quote",
    review:
      "A proof picture: it shows the real result or customer moment the post is about, believable, with no invented figures.",
  },
  candid: {
    id: "candid",
    scene:
      "A candid, real moment as a person would post it: behind the scenes, the story's moment, or a customer's everyday use, natural light, no ad polish.",
    headline:
      "usually an empty string; at most a short line the way a person types it on a phone photo",
    review:
      "A candid picture: it looks like a real moment from the post's story, not an ad, with little or no text.",
  },
  quote: {
    id: "quote",
    scene:
      "A calm, well-designed quote card in the brand's look: the quote is the hero on a clean background, with one quiet supporting detail.",
    headline: "the exact quote from the brief, short; never a made-up quote or name",
    review:
      "A quote picture: the exact quote is the clear hero, set cleanly and legibly in the brand's look.",
  },
  brand: {
    id: "brand",
    scene:
      "A clean, professional picture that shows the brand's world around the post's topic: one hero subject, the brand's colours, generous space.",
    headline:
      "a short line that names the post's idea, or an empty string when the picture says it",
    review:
      "A brand picture: one clear hero that is plainly about the post's topic, clean and on-brand.",
  },
};

const BY_CATEGORY: Record<string, PictureJobId> = {
  sale: "sell",
  product: "sell",
  launch: "sell",
  meme: "engage",
  relatable: "engage",
  trend: "engage",
  "this-or-that": "engage",
  tips: "teach",
  myth: "teach",
  "before-after": "teach",
  list: "teach",
  proof: "proof",
  ugc: "candid",
  "behind-scenes": "candid",
  storytime: "candid",
  quote: "quote",
  local: "brand",
  aesthetic: "brand",
};

const BY_GOAL: Record<string, PictureJobId> = {
  offer: "sell",
  launch: "sell",
  leads: "sell",
  engagement: "engage",
  education: "teach",
  awareness: "brand",
};

export function pictureJobFor(args: {
  category?: { id: string } | null;
  goal?: string | null;
  type?: StudioType;
}): PictureJob {
  if (args.type === "ad") return JOBS.sell;
  const id =
    (args.category ? BY_CATEGORY[args.category.id] : undefined) ??
    (args.goal ? BY_GOAL[args.goal] : undefined) ??
    "brand";
  return JOBS[id];
}

/** The writer's rules for a post's picture, by what the picture has to do. */
export function pictureRules(job: PictureJob): string[] {
  return [
    "`picture` is the post's image, written now so it matches what the post is about. The caption and the picture are different: the caption is posted under the picture and is NEVER written on it.",
    `This picture's job: ${job.scene}`,
    "`picture.purpose`: one line: who it is for (an audience group from the Brand section when there is one) · what they should feel or do · how it serves the confirmed strategy, goal or running campaign when there is one.",
    "`picture.scene`: art direction for one clean, professionally designed social image that does this job, 4 to 6 concrete sentences: the hero subject (the brand's real product, service, place or people type, never an invented product detail), its scale, the set or backdrop, the light, the camera angle, real materials, colours from the brand palette, and where a short headline sits on a calm area. Build on 'Picture the brief asks for' when given, and use what 'What is working right now' and the market context say only where it fits the brand. Describe only what to draw; never quote caption sentences. Make it different from the pictures in 'Already made'.",
    `\`picture.headline\`: 2 to 6 words set in the picture: ${job.headline}; only facts from the brief, never the caption's first line. Less text is better; use an empty string when the picture is stronger without words.`,
  ];
}
