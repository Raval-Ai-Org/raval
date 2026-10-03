// Story frames: what makes a few vertical screens one Story instead of a stack
// of unrelated cards. Pure, so the prompt, the runner, the preview, Autopilot
// and the tests all share it.
//
// A Story is short (1 to 7 frames, each seen for about five seconds), so every
// frame says one thing in big type. The model writes the words; the theme, the
// role of each position, the limits and the cleanup are decided here.

export const STORY_FRAME_ROLES = ["hook", "value", "proof", "question", "offer", "cta"] as const;
export type StoryFrameRole = (typeof STORY_FRAME_ROLES)[number];

export type StoryFrame = {
  role: StoryFrameRole;
  /** Big type. At most ~10 words: it is read in a glance. */
  heading: string;
  /** One supporting line, optional. */
  body: string;
  /** A tiny label above the heading ("Tip 2", "New", "Today only"). */
  kicker?: string;
  /** Words from the heading to highlight; only kept when they are really in it. */
  emphasis?: string;
  /** Art direction for an optional background picture. Never drawn as text. */
  visual?: string;
  /**
   * A `question` frame's answer choices, drawn as chips. Viewers answer by
   * replying to the Story (a real DM), because API-published Stories cannot
   * carry native poll or question stickers.
   */
  options?: string[];
};

export const MAX_STORY_FRAMES = 7;
export const DEFAULT_STORY_FRAMES = 3;
/** How long Instagram and Facebook show an image Story frame. */
export const IMAGE_FRAME_SECONDS = 5;

/* ───────────────────────── themes (the content mix) ───────────────────────── */

export type StoryThemeId =
  "tip" | "behind" | "offer" | "question" | "proof" | "news" | "countdown" | "repurpose";

export type StoryTheme = {
  id: StoryThemeId;
  label: string;
  /** Plain words for the settings screen. */
  detail: string;
  /** How the frames are built. Sent to the model. */
  directive: string;
  /** Roles in order for `count` frames. */
  plan(count: number): StoryFrameRole[];
};

const fill = (
  count: number,
  first: StoryFrameRole,
  middle: StoryFrameRole,
  last: StoryFrameRole,
) => {
  const n = clampCount(count);
  if (n === 1) return [first];
  return Array.from({ length: n }, (_, i): StoryFrameRole =>
    i === 0 ? first : i === n - 1 ? last : middle,
  );
};

export const STORY_THEMES: StoryTheme[] = [
  {
    id: "tip",
    label: "Quick tip",
    detail: "One useful thing your audience can do today.",
    directive:
      "Teach one small, specific thing. The hook names the problem in the viewer's words, the middle frames give the steps or the trick, the last frame asks them to reply or try it.",
    plan: (n) => fill(n, "hook", "value", "cta"),
  },
  {
    id: "behind",
    label: "Behind the scenes",
    detail: "How the work really gets done.",
    directive:
      "Show a real moment of how the brand works: the hook sets the scene, the middle frames walk through what happens, the last frame invites a reply. Only describe things the brand context supports.",
    plan: (n) => fill(n, "hook", "value", "cta"),
  },
  {
    id: "offer",
    label: "Offer or reminder",
    detail: "A deal, a booking slot or a product worth a look.",
    directive:
      "State the offer plainly with its real terms from the brief or brand context. Urgency only if the brief gives a real deadline. Never invent a price, discount or date.",
    plan: (n) => (clampCount(n) === 1 ? ["offer"] : fill(n, "hook", "offer", "cta")),
  },
  {
    id: "question",
    label: "Ask your audience",
    detail: "A question people answer by replying.",
    directive:
      "Ask one easy question the audience has an opinion on, with 2 to 4 short answer choices. Replies come as direct messages, so say 'Reply with your pick'. Never call it a poll or mention stickers.",
    plan: (n) => {
      const c = clampCount(n);
      if (c === 1) return ["question"];
      return Array.from({ length: c }, (_, i): StoryFrameRole =>
        i === c - 1 ? "question" : i === 0 ? "hook" : "value",
      );
    },
  },
  {
    id: "proof",
    label: "Results and reviews",
    detail: "A customer moment or a result, only from what you've told Mellox.",
    directive:
      "One real proof point taken from the brand context: a result, a review or a demonstration. If no proof is supplied, show the process honestly instead of claiming results.",
    plan: (n) => fill(n, "hook", "proof", "cta"),
  },
  {
    id: "news",
    label: "What's new",
    detail: "A launch, an update or an announcement.",
    directive:
      "Say what is new and why it matters to the viewer in the first frame, what changes for them next, then one next step.",
    plan: (n) => fill(n, "hook", "value", "cta"),
  },
  {
    id: "countdown",
    label: "Countdown",
    detail: "Build up to a real date: an event, a launch or a deadline.",
    directive:
      "Count down to the date named in the brief. If the brief names no date, make it a 'coming soon' teaser without a date. Never invent one.",
    plan: (n) => fill(n, "hook", "value", "cta"),
  },
  {
    id: "repurpose",
    label: "From a recent post",
    detail: "Turns a post you already published into a Story.",
    directive:
      "Retell the source post for Stories: the sharpest point first, one idea per frame, and point people to the full post on the last frame.",
    plan: (n) => fill(n, "hook", "value", "cta"),
  },
];

export const STORY_THEME_IDS = STORY_THEMES.map((t) => t.id) as [StoryThemeId, ...StoryThemeId[]];
const THEME_BY_ID = new Map(STORY_THEMES.map((t) => [t.id, t]));

export function getStoryTheme(id: unknown): StoryTheme | null {
  return typeof id === "string" ? (THEME_BY_ID.get(id as StoryThemeId) ?? null) : null;
}

export function isStoryThemeId(value: unknown): value is StoryThemeId {
  return typeof value === "string" && THEME_BY_ID.has(value as StoryThemeId);
}

function clampCount(count: number): number {
  return Math.max(1, Math.min(MAX_STORY_FRAMES, Math.round(Number.isFinite(count) ? count : 3)));
}

function hash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * The theme for a new Story: the one asked for, else one from the allowed mix
 * that the last few Stories didn't use. Deterministic per seed, so a retry of
 * the same request makes the same choice.
 */
export function pickStoryTheme(args: {
  seed: string;
  mix?: readonly string[];
  recent?: readonly (string | null | undefined)[];
  preferred?: string | null;
}): StoryTheme {
  const kept = getStoryTheme(args.preferred);
  if (kept) return kept;
  const allowed = (args.mix ?? [])
    .map(getStoryTheme)
    .filter((t): t is StoryTheme => !!t && t.id !== "repurpose");
  const pool = allowed.length ? allowed : STORY_THEMES.filter((t) => t.id !== "repurpose");
  const used = new Set((args.recent ?? []).filter(Boolean).slice(0, Math.max(1, pool.length - 1)));
  const fresh = pool.filter((t) => !used.has(t.id));
  const from = fresh.length ? fresh : pool;
  return from[hash(args.seed) % from.length];
}

/** The frame-by-frame brief the model writes to. */
export function framePlanText(theme: StoryTheme, count: number): string {
  const what: Record<StoryFrameRole, string> = {
    hook: "hook. Stops the tap-through: a promise, a tension or a question in at most 8 words. `body` is empty or one short line.",
    value:
      "value. One idea only. Heading at most 9 words; body at most 18 words with a concrete detail.",
    proof: "proof. One concrete result, review or demonstration from the supplied facts only.",
    question:
      "question. The question in at most 10 words as the heading, `options` holds 2 to 4 answer choices of at most 3 words each, `body` says how to answer (by replying).",
    offer:
      "offer. The offer and its real terms. Heading at most 9 words; body states the terms or how to claim it.",
    cta: "close. One clear next step in the heading (reply, visit the link in bio, book, save). `body` says what they get.",
  };
  return theme
    .plan(count)
    .map((role, i) => `Frame ${i + 1}: ${what[role]}`)
    .join("\n");
}

/* ───────────────────────── cleanup ───────────────────────── */

const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;

function oneLine(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const text = value
    .replace(EMOJI, "")
    .replace(/\s*\n+\s*/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function emphasisIn(heading: string, raw: unknown): string | undefined {
  const words = oneLine(raw, 40);
  if (!words || words.split(/\s+/).length > 3) return undefined;
  const at = heading.toLowerCase().indexOf(words.toLowerCase());
  if (at < 0 || words.length >= heading.length) return undefined;
  return heading.slice(at, at + words.length);
}

function isRole(value: unknown): value is StoryFrameRole {
  return typeof value === "string" && (STORY_FRAME_ROLES as readonly string[]).includes(value);
}

/**
 * Make whatever came back into frames the design can rely on: the theme's role
 * per position, short text, no emoji (the frame fonts don't carry them), answer
 * chips only on a question frame, and highlighted words that exist.
 */
export function normalizeFrames(
  raw: unknown,
  opts: { theme?: StoryTheme | null; count?: number } = {},
): StoryFrame[] {
  const list = (Array.isArray(raw) ? raw : []).slice(0, MAX_STORY_FRAMES);
  const count = opts.count ?? list.length;
  const plan = (opts.theme ?? STORY_THEMES[0]).plan(Math.max(1, count || list.length));
  return list.map((item, i) => {
    const row = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const given = isRole(row.role) ? row.role : null;
    const role: StoryFrameRole = plan[i] ?? given ?? "value";
    const heading = oneLine(row.heading, 90);
    const body = oneLine(row.body, 180);
    const kicker = role === "cta" ? "" : oneLine(row.kicker, 24);
    const visual = oneLine(row.visual, 240);
    const emphasis = emphasisIn(heading, row.emphasis);
    const options =
      role === "question" && Array.isArray(row.options)
        ? [...new Set(row.options.map((o) => oneLine(o, 28)).filter(Boolean))].slice(0, 4)
        : [];
    return {
      role,
      heading,
      body,
      ...(kicker ? { kicker } : {}),
      ...(emphasis ? { emphasis } : {}),
      ...(visual ? { visual } : {}),
      ...(options.length ? { options } : {}),
    };
  });
}

function words(value: string): string[] {
  return value.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** Characters someone can read in a five-second frame, roughly. */
export const FRAME_READ_LIMIT = 200;

/**
 * Why a Story doesn't work, or null when it does. Checked before anything is
 * saved; a failure gets one corrected attempt.
 */
export function storyIssue(frames: StoryFrame[] | undefined, expected?: number): string | null {
  if (!frames?.length) return "The Story has no frames.";
  if (expected && frames.length !== expected) return "The Story has the wrong number of frames.";
  if (frames.some((f) => !f.heading.trim())) return "A Story frame has no headline.";
  if (words(frames[0].heading).length > 12)
    return "The first Story frame is too long to read at a glance.";
  const seen = new Set<string>();
  for (const f of frames) {
    const key = words(f.heading).join(" ");
    if (seen.has(key)) return "Two Story frames say the same thing.";
    seen.add(key);
    if (f.heading.length + f.body.length > FRAME_READ_LIMIT)
      return "A Story frame has more text than anyone can read in five seconds.";
  }
  const question = frames.find((f) => f.role === "question");
  if (question && (question.options?.length ?? 0) < 2)
    return "The question frame needs at least two answers to choose from.";
  return null;
}

/** Plain text of a Story, for search, dedupe, memory and the caption fallback. */
export function storyText(frames: StoryFrame[]): string {
  return frames
    .map((f) => [f.heading, f.body, ...(f.options ?? [])].filter(Boolean).join(" "))
    .join("\n");
}

/** Frames saved in content meta, read defensively (meta is user-editable). */
export function framesFromMeta(meta: unknown): StoryFrame[] {
  const m = meta && typeof meta === "object" ? (meta as Record<string, unknown>) : {};
  const story = m.story && typeof m.story === "object" ? (m.story as Record<string, unknown>) : {};
  const theme = getStoryTheme(story.theme);
  const raw = Array.isArray(story.frames) ? story.frames : [];
  return normalizeFrames(raw, { theme, count: raw.length });
}
