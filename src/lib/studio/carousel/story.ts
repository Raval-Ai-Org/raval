// Carousel story: what makes a set of slides one connected piece instead of a
// stack of unrelated cards. Pure, so the prompt engine, the runner, the
// preview and the tests share it.
//
// A carousel has a structure (steps, myths, a story, a checklist…) picked so it
// differs from the workspace's recent carousels, and every slide has a role in
// that structure. The model writes the words; the roles, the order, the labels
// and the limits are decided here.
import { applyLean } from "@/lib/taste/bias";
import type { Lean } from "@/lib/taste/contracts";
import type { CarouselSlide } from "../jobs";

export type SlideRole = "cover" | "context" | "point" | "proof" | "recap" | "cta";

export const SLIDE_ROLES: readonly SlideRole[] = [
  "cover",
  "context",
  "point",
  "proof",
  "recap",
  "cta",
];

export type CarouselStructure = {
  id: string;
  label: string;
  /** How the middle of the carousel is built. Sent to the model. */
  directive: string;
  /** What the short label above each middle heading looks like. */
  kickerHint: string;
  /**
   * The middle slides carry a picture or a punchline, not teaching text, so a
   * short body is right (case studies, running jokes).
   */
  shortBodies?: boolean;
};

export const CAROUSEL_STRUCTURES: CarouselStructure[] = [
  {
    id: "steps",
    label: "Step by step",
    directive:
      "A sequence someone can follow. Each middle slide is one step in the real order, its heading starts with a verb, and each step only makes sense after the one before it.",
    kickerHint: '"Step 1", "Step 2", …',
  },
  {
    id: "myths",
    label: "Myth then truth",
    directive:
      "Pairs. A slide states a belief the audience holds, the next slide replaces it with what is true and why. Each pair builds on the last so the final truth is the biggest shift.",
    kickerHint: '"Myth" then "Truth", alternating',
  },
  {
    id: "mistakes",
    label: "Mistakes and fixes",
    directive:
      "Each middle slide names one specific mistake in the heading and gives the fix in the body. Order from the most common to the most costly, so the stakes rise as the reader swipes.",
    kickerHint: '"Mistake 1", "Mistake 2", …',
  },
  {
    id: "story",
    label: "A story",
    directive:
      "One situation told in order: where things stood, what went wrong or felt stuck, the turning point, what changed, where things stand now. Every slide continues the same scene; never restart.",
    kickerHint: '"Before", "The problem", "The turn", "After"',
  },
  {
    id: "list",
    label: "A ranked list",
    directive:
      "A short list of distinct points on one topic, ordered so the strongest comes last. Each point must be different in kind, not the same advice reworded.",
    kickerHint: '"1 of 4", "2 of 4", … or a one-word name for each point',
  },
  {
    id: "framework",
    label: "A simple model",
    directive:
      "One way of thinking, taken apart. Name the model on slide 2, then give each part its own slide, and show how the parts fit together before the close.",
    kickerHint: "the name of each part",
  },
  {
    id: "comparison",
    label: "This versus that",
    directive:
      "Two ways of doing the same thing, compared on one point per slide. Keep the same two sides and the same order on every slide so the reader can follow the contrast.",
    kickerHint: 'the point being compared, e.g. "Cost", "Time", "Result"',
  },
  {
    id: "breakdown",
    label: "One example, taken apart",
    directive:
      "Pick one real example from the brief or the brand and look at it piece by piece. Each middle slide examines one part of that same example and what it teaches.",
    kickerHint: "the part being looked at",
  },
  {
    id: "checklist",
    label: "A checklist",
    directive:
      "Things to check, in the order someone would check them. Each heading is the item, each body is the one-line reason it matters. Made to be saved.",
    kickerHint: '"Check 1", "Check 2", …',
  },
  {
    id: "questions",
    label: "Questions answered",
    directive:
      "Each middle slide is one real question in the audience's own words, answered directly in the body. Order the questions the way they come up in a buyer's head.",
    kickerHint: '"Q1", "Q2", …',
  },
  // Round 2, from agency portfolio posts (docs/studio/reference-study-2026-10.md).
  {
    id: "case-study",
    label: "Our work, shown",
    directive:
      "A piece of work shown where it lives. The cover names the project. Each middle slide shows the work on one real touchpoint (the website, the packaging, a sign, a social post, the app), never the same kind of touchpoint twice; the heading names the touchpoint and the body says in one short line what was done there. The last slide names the scope in a few words and asks for one step. Only facts from the brief: no results, clients' words or figures that were not supplied.",
    kickerHint: 'the touchpoint, e.g. "Website", "Packaging", "Signage"',
    shortBodies: true,
  },
  {
    id: "intro",
    label: "Who we are",
    directive:
      "An introduction that turns a stranger into a lead. The cover promises a payoff in a small aside. Then: what the brand does (up to four offers, each with a one-line plain-spoken aside), who it is for, proof only from supplied facts, and a last slide whose heading is a question and whose body pays off the cover's promise. Never state how many slides there are unless it matches exactly.",
    kickerHint: '"What we do", "For", "Proof"',
  },
  {
    id: "reveal",
    label: "Hold the reveal",
    directive:
      "Make them lean in before you tell them. The cover is a bold line about a standard or a feeling that does not yet say what the post is about. Slide 2 reveals it plainly and quietly (the hiring, the new thing, the change). The middle slides give the details as a numbered list when there is one. The last slide gives the one way to act.",
    kickerHint: '"The reveal", "Details", or the item\'s number',
  },
  {
    id: "running-joke",
    label: "A running joke",
    directive:
      "One template, repeated. Every middle slide has the same shape: `body` is a short setup line, `heading` is the punchline of two to four words, and the punchline is the same or nearly the same on every slide while the setup changes. The joke must be about the audience's world and kind, never about a person or another company. The last slide gives the reason or the turn (a greeting, a day off, the one thing you will do).",
    kickerHint: "leave empty",
    shortBodies: true,
  },
];

const BY_ID = new Map(CAROUSEL_STRUCTURES.map((s) => [s.id, s]));

/** Which structures suit an angle (src/lib/studio/prompts.ts ANGLES), best first. */
const ANGLE_STRUCTURES: Record<string, string[]> = {
  contrarian: ["myths", "comparison", "list"],
  "how-to": ["steps", "framework", "checklist"],
  proof: ["breakdown", "story", "list"],
  story: ["story", "breakdown"],
  myth: ["myths", "mistakes"],
  data: ["list", "breakdown", "comparison"],
  objection: ["questions", "myths", "comparison"],
  "behind-scenes": ["breakdown", "story", "steps"],
  checklist: ["checklist", "steps", "mistakes"],
  comparison: ["comparison", "story", "mistakes"],
};

/** Made only when asked for (a template or the brief), never picked by rotation. */
const ON_REQUEST = new Set(["case-study", "intro", "reveal", "running-joke"]);

/** A template names its own structure; nothing overrides it. */
const TEMPLATE_STRUCTURE: Record<string, string> = {
  "carousel-step-by-step": "steps",
  "carousel-myth-fact": "myths",
  "carousel-mistakes": "mistakes",
  "carousel-before-after": "story",
  "carousel-checklist": "checklist",
  "carousel-product-tour": "breakdown",
  "carousel-stats": "list",
  "carousel-faq": "questions",
  "carousel-case-study": "case-study",
  "carousel-intro": "intro",
  "carousel-hiring": "reveal",
  "carousel-running-joke": "running-joke",
};

function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function getCarouselStructure(id: string | null | undefined): CarouselStructure | null {
  return id ? (BY_ID.get(id) ?? null) : null;
}

const NUMBER = "(?:\\d+|two|three|four|five|six|seven|eight|nine|ten)";
const ASKED: [RegExp, string][] = [
  [
    /\bcase stud(y|ies)\b|\bportfolio\b|\bshowcase (of )?our work\b|\bour (latest|recent) (work|project)\b/i,
    "case-study",
  ],
  [
    /\bwho we are\b|\bintroduc(e|ing) (us|ourselves|our (agency|studio|team|company))\b|\bmeet (us|the team)\b/i,
    "intro",
  ],
  [/\bwe['’]?re hiring\b|\bwe are hiring\b|\bnow hiring\b|\bjob opening/i, "reveal"],
  [/\brunning joke\b|\bmeme carousel\b|\bnot today\b/i, "running-joke"],
  [/\bchecklist\b/i, "checklist"],
  [/\bmyths?\b/i, "myths"],
  [/\bmistakes?\b/i, "mistakes"],
  [/\b(?:vs\.?|versus|before and after|compared? (?:to|with)|comparison)\b/i, "comparison"],
  [/\bframework\b/i, "framework"],
  [/\b(?:step[- ]by[- ]step|steps?|how to)\b/i, "steps"],
  [/\bquestions? to ask\b|\bfaq\b/i, "questions"],
  [new RegExp(`\\b${NUMBER} (?:ways|tips|reasons|signs|ideas|things|lessons)\\b`, "i"), "list"],
];

/**
 * The structure a brief names outright, if it names one. Only the opening of
 * the brief is read (its title and idea), never the context that follows it.
 */
export function structureFromBrief(brief: string | null | undefined): string | null {
  const head = (brief ?? "")
    .split(/\n\s*\n/)
    .slice(0, 2)
    .join(" ")
    .slice(0, 600);
  if (!head.trim()) return null;
  for (const [pattern, id] of ASKED) if (pattern.test(head)) return id;
  return null;
}

/**
 * The structure for a new carousel: the template's own, else one that suits the
 * angle and that the workspace hasn't used in its last few carousels.
 * Deterministic per seed; a refine passes `preferred` to keep what it had.
 */
export function pickCarouselStructure(args: {
  seed: string;
  angleId?: string | null;
  template?: string | null;
  recent?: (string | null | undefined)[];
  preferred?: string | null;
  /** What was asked for, in the asker's words. */
  brief?: string | null;
  /** The brand's taste for carousel stories (ADR-0038). */
  lean?: Lean | null;
}): CarouselStructure {
  const kept = getCarouselStructure(args.preferred);
  if (kept) return kept;
  const fromTemplate = getCarouselStructure(TEMPLATE_STRUCTURE[args.template ?? ""]);
  if (fromTemplate) return fromTemplate;
  // "A four-step checklist" must come out as a checklist, not as three mistakes.
  const asked = getCarouselStructure(structureFromBrief(args.brief));
  if (asked) return asked;
  const used = new Set((args.recent ?? []).filter(Boolean).slice(0, 4));
  const suited = (ANGLE_STRUCTURES[args.angleId ?? ""] ?? [])
    .map((id) => BY_ID.get(id))
    .filter((s): s is CarouselStructure => !!s);
  const byId = (s: CarouselStructure) => s.id;
  const fresh = applyLean(
    suited.filter((s) => !used.has(s.id)),
    args.lean,
    args.seed,
    byId,
  );
  if (fresh.length) return fresh[hash(args.seed) % fresh.length];
  const general = CAROUSEL_STRUCTURES.filter((s) => !ON_REQUEST.has(s.id));
  const unused = general.filter((s) => !used.has(s.id));
  const pool = applyLean(unused.length ? unused : general, args.lean, args.seed, byId);
  return pool[hash(args.seed) % pool.length];
}

/** The role of each slide position for a carousel of `count` slides. */
export function slidePlan(count: number): SlideRole[] {
  const n = Math.max(3, Math.min(10, Math.round(count)));
  const plan: SlideRole[] = Array.from({ length: n }, () => "point");
  plan[0] = "cover";
  plan[n - 1] = "cta";
  if (n >= 5) plan[1] = "context";
  if (n >= 7) plan[n - 2] = "recap";
  return plan;
}

/** The slide-by-slide brief the model writes to. */
export function slidePlanText(count: number): string {
  const what: Record<SlideRole, string> = {
    cover:
      "cover. A promise or a tension in at most 8 words, specific enough that only this brand could have written it. `body` is one short line that says who it is for or what they will get.",
    context:
      "context. Why this matters now: the cost of the problem, or the moment the reader will recognise. It must make the next slide feel needed.",
    point:
      "point. One idea only. Heading at most 8 words, body at most 30 words with a concrete detail, example or instruction.",
    proof: "proof. One concrete example, result or demonstration from the supplied facts.",
    recap:
      "recap. The whole carousel in 3 or 4 lines. `body` is those lines separated by line breaks, each at most 6 words, in the same order as the slides.",
    cta: "close. One clear next step that follows from the content, in the heading. `body` says what they get by doing it.",
  };
  return slidePlan(count)
    .map((role, i) => `Slide ${i + 1}: ${what[role]}`)
    .join("\n");
}

const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;

function clean(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const text = value
    .replace(EMOJI, "")
    .replace(/[ \t]+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function oneLine(value: unknown, max: number): string {
  return clean(typeof value === "string" ? value.replace(/\s*\n+\s*/g, " ") : value, max);
}

/** Words from the heading to highlight: only kept when they really are in it. */
function emphasisIn(heading: string, raw: unknown): string | undefined {
  const words = oneLine(raw, 40);
  if (!words || words.split(/\s+/).length > 4) return undefined;
  const at = heading.toLowerCase().indexOf(words.toLowerCase());
  if (at < 0 || words.length >= heading.length) return undefined;
  return heading.slice(at, at + words.length);
}

/**
 * Make whatever the model returned into slides the designs can rely on: a role
 * per position, short labels, no emoji (the slide fonts don't carry them), and
 * highlighted words that exist in the heading.
 */
export function normalizeSlides(raw: unknown, count?: number): CarouselSlide[] {
  const list = Array.isArray(raw) ? raw : [];
  const plan = slidePlan(count ?? list.length);
  return list.slice(0, 10).map((item, i) => {
    const row = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const last = i === list.length - 1;
    const given = typeof row.role === "string" ? (row.role.toLowerCase() as SlideRole) : null;
    const middle: SlideRole =
      given && ["context", "point", "proof", "recap"].includes(given)
        ? given
        : (plan[i] ?? "point");
    const role: SlideRole = i === 0 ? "cover" : last ? "cta" : middle === "cta" ? "point" : middle;
    const heading = oneLine(row.heading, 90);
    const body =
      role === "recap"
        ? clean(row.body, 320)
            .split(/\n+|\s*[•;]\s*/)
            .map((line) => line.replace(/^[-–\d.)\s]+/, "").trim())
            .filter(Boolean)
            .slice(0, 5)
            .join("\n")
        : oneLine(row.body, 320);
    const kicker = role === "cta" ? "" : oneLine(row.kicker, 26);
    const visual = oneLine(row.visual, 240);
    const emphasis = emphasisIn(heading, row.emphasis);
    const photo =
      Number.isInteger(row.photo) && (row.photo as number) >= 0 && (row.photo as number) < 6
        ? (row.photo as number)
        : null;
    return {
      heading,
      body,
      role,
      ...(kicker ? { kicker } : {}),
      ...(emphasis ? { emphasis } : {}),
      ...(visual ? { visual } : {}),
      ...(photo !== null ? { photo } : {}),
    };
  });
}

/** Slides saved before roles existed: give each one the role its position implies. */
export function withRoles(slides: CarouselSlide[]): CarouselSlide[] {
  if (slides.every((s) => s.role)) return slides;
  const plan = slidePlan(slides.length);
  return slides.map((s, i) => ({
    ...s,
    role:
      s.role ??
      (i === 0
        ? "cover"
        : i === slides.length - 1
          ? "cta"
          : // An old slide in the recap position is still an ordinary point.
            plan[i] === "recap"
            ? "point"
            : plan[i]),
  }));
}

/** The number shown on a point slide: its place among the points, from 1. */
export function pointNumber(slides: CarouselSlide[], index: number): number | null {
  const role = slides[index]?.role;
  if (role !== "point" && role !== "proof") return null;
  let n = 0;
  for (let i = 0; i <= index; i++) {
    if (slides[i].role === "point" || slides[i].role === "proof") n++;
  }
  return n;
}

function words(value: string): string[] {
  return value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

function overlap(a: string, b: string): number {
  const left = new Set(words(a).filter((w) => w.length > 3));
  const right = new Set(words(b).filter((w) => w.length > 3));
  if (left.size < 4 || right.size < 4) return 0;
  let shared = 0;
  for (const w of left) if (right.has(w)) shared++;
  return shared / Math.min(left.size, right.size);
}

const COUNT_WORDS: Record<string, number> = {
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

/** "give it 8 slides": the count a cover promises, if it names one. */
function promisedSlides(cover: string): number | null {
  const m = /\b(\d{1,2}|three|four|five|six|seven|eight|nine|ten)\s+(?:slides|swipes)\b/i.exec(
    cover,
  );
  if (!m) return null;
  return COUNT_WORDS[m[1].toLowerCase()] ?? Number(m[1]);
}

/**
 * Why a carousel doesn't hold together, or null when it does. Checked before
 * anything is saved; a failure gets one corrected attempt.
 */
export function carouselStoryIssue(
  slides: CarouselSlide[] | undefined,
  structure?: string | null,
): string | null {
  if (!slides?.length) return "The carousel has no slides.";
  if (slides.some((s) => !s.heading.trim())) return "A carousel slide has no heading.";
  if (words(slides[0].heading).length > 12)
    return "The carousel cover is too long to read at once.";
  const promised = promisedSlides(`${slides[0].heading} ${slides[0].body}`);
  if (promised !== null && promised !== slides.length)
    return `The cover promises ${promised} slides but the carousel has ${slides.length}.`;
  const seen = new Set<string>();
  for (const s of slides) {
    const key = words(s.heading).join(" ");
    if (seen.has(key)) return "Two carousel slides have the same heading.";
    seen.add(key);
  }
  const middle = slides.slice(1, -1);
  const shortBodies = !!getCarouselStructure(structure)?.shortBodies;
  if (middle.some((s) => s.body.trim().length < (shortBodies ? 8 : 25)))
    return "A carousel teaching slide is too thin.";
  for (let i = 0; i < middle.length; i++) {
    for (let j = i + 1; j < middle.length; j++) {
      if (middle[i].role === "recap" || middle[j].role === "recap") continue;
      if (overlap(middle[i].body, middle[j].body) >= 0.8)
        return "Two carousel slides say the same thing.";
    }
  }
  const close = slides[slides.length - 1];
  if (!close.body.trim() && words(close.heading).length < 3)
    return "The last slide doesn't give a clear next step.";
  return null;
}
