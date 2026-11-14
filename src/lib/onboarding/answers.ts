// What a person answers in onboarding, and where each answer lands (ADR-0049).
//
// Pure and browser-safe. Every answer goes somewhere a generator really reads:
// the look (writing person, tone, emoji, length, visual medium → styleBlockFor),
// the goal (focus, rhythm, channels → decideGoals → goalBlockFor) or the Brand
// DNA profile ("Who runs it" in serializeBrandContext). Where heard about
// Mellox is attribution only and never reaches a prompt.
//
// A value a person already set is never overwritten: these only fill gaps.
import type { BrandLookSpec } from "@/lib/brand-look/spec";
import type { GoalFocus, WorkspaceGoals } from "@/lib/goals/contracts";
import { tidyLook } from "@/lib/inspo/look";

export const ROLES = ["owner", "marketing", "agency", "creator"] as const;
export type Role = (typeof ROLES)[number];

export const TEAM_SIZES = ["solo", "small", "mid", "large"] as const;
export type TeamSize = (typeof TEAM_SIZES)[number];

export const ACTIVITIES = ["very", "regular", "sometimes", "not_yet"] as const;
export type Activity = (typeof ACTIVITIES)[number];

/** Posts a week, as the rhythm cards offer them. */
export const RHYTHMS = [7, 4, 3, 1] as const;
export type Rhythm = (typeof RHYTHMS)[number];

export const TONES = ["corporate", "casual", "personal", "funny", "auto"] as const;
export type ToneChoice = (typeof TONES)[number];

export const EMOJI_CHOICES = ["none", "few", "plenty", "auto"] as const;
export type EmojiChoice = (typeof EMOJI_CHOICES)[number];

export const LENGTHS = ["short", "paragraph", "long", "auto"] as const;
export type LengthChoice = (typeof LENGTHS)[number];

/** Who says yes before a post goes out; Autopilot's mode (AUTOPILOT_MODES). */
export const APPROVALS = ["assist", "autopilot", "full"] as const;
export type Approval = (typeof APPROVALS)[number];

/** Stored on profiles.signup_source; keep in step with the migration's CHECK. */
export const SOURCES = ["google", "social", "friend", "ai", "other"] as const;
export type SignupSource = (typeof SOURCES)[number];

/** Channels the goal can name (PlatformIdSchema), in the order they're offered. */
export const ONBOARDING_CHANNELS = [
  "instagram",
  "tiktok",
  "linkedin",
  "facebook",
  "youtube",
  "twitter",
  "threads",
  "pinterest",
] as const;
export type OnboardingChannel = (typeof ONBOARDING_CHANNELS)[number];
export const MAX_GOAL_CHANNELS = 5;

export type VisualMedium = NonNullable<NonNullable<BrandLookSpec["visual"]>["medium"]>;

export type Answers = {
  role?: Role;
  teamSize?: TeamSize;
  focus?: GoalFocus;
  activity?: Activity;
  rhythm?: Rhythm;
  channels?: OnboardingChannel[];
  tone?: ToneChoice;
  emoji?: EmojiChoice;
  length?: LengthChoice;
  approval?: Approval;
  /** Look sample ids swiped right / left (LOOK_SAMPLES). */
  likes?: string[];
  skips?: string[];
  source?: SignupSource;
};

/** Who the brand is run by; kept on Brand DNA (`dna.profile`). */
export type OnboardingProfile = {
  role?: Role;
  teamSize?: TeamSize;
  activity?: Activity;
  /** Autopilot's starting mode, proposed by suggestStrategy. */
  approval?: Approval;
};

/** A real Mellox-made post shown in the "Which posts feel like you?" swipe. */
export type LookSample = {
  id: string;
  src: string;
  alt: string;
  medium: VisualMedium;
};

/** Two of each medium, so a medium is only chosen when the person liked it twice. */
export const LOOK_SAMPLES: readonly LookSample[] = [
  {
    id: "photo-product",
    src: "/Home/wall/burger-4.webp",
    alt: "A burger on a skateboard in a sunny street",
    medium: "photo",
  },
  {
    id: "3d-chrome",
    src: "/Home/wall/classes-2.webp",
    alt: "Chrome 3D numbers on a dark background",
    medium: "3d",
  },
  {
    id: "type-bold",
    src: "/Home/wall/build-2.webp",
    alt: "A bold black-and-white headline poster with one orange accent",
    medium: "typographic",
  },
  {
    id: "illustration-app",
    src: "/Home/wall/wallet-2.webp",
    alt: "A bright blue illustration of a person and a phone app",
    medium: "illustration",
  },
  {
    id: "photo-people",
    src: "/Home/wall/sunscreen-6.webp",
    alt: "A smiling person with a sunscreen bottle on a bright background",
    medium: "photo",
  },
  {
    id: "3d-product",
    src: "/Home/wall/finance-1.webp",
    alt: "A glowing 3D cable plug on a dark green background",
    medium: "3d",
  },
  {
    id: "type-poster",
    src: "/Home/wall/build-1.webp",
    alt: "A big condensed headline over a construction site at sunset",
    medium: "typographic",
  },
  {
    id: "illustration-people",
    src: "/Home/wall/wallet-4.webp",
    alt: "A flat illustration of a person with a phone on blue",
    medium: "illustration",
  },
];

const MEDIUM_MOOD: Partial<Record<VisualMedium, string>> = {
  photo: "Real photography: natural light, real places and real people with the product.",
  "3d": "Polished 3D renders: glossy materials, dramatic light, one hero object.",
  typographic: "Type-led posters: big bold headlines carry the post, one accent colour.",
  illustration: "Bright flat illustration: friendly characters, clean shapes, bold colour.",
};

/** The medium the person liked at least twice and more than any other, else null. */
export function pickedMedium(
  likes: readonly string[] | undefined,
  samples: readonly LookSample[] = LOOK_SAMPLES,
): VisualMedium | null {
  const counts = new Map<VisualMedium, number>();
  for (const id of new Set(likes ?? [])) {
    const s = samples.find((x) => x.id === id);
    if (s) counts.set(s.medium, (counts.get(s.medium) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const [top, second] = ranked;
  if (!top || top[1] < 2) return null;
  if (second && second[1] === top[1]) return null;
  return top[0];
}

/** The rhythm Mox stars: steady enough to grow, light enough to approve. */
export function recommendedRhythm(activity?: Activity, focus?: GoalFocus): Rhythm {
  const base: Rhythm = activity === "very" ? 7 : activity === "regular" ? 4 : 3;
  return focus === "launch" && base < 4 ? 4 : base;
}

const TONE_SLIDERS: Record<Exclude<ToneChoice, "auto">, { casual: number; playful: number }> = {
  corporate: { casual: 15, playful: 10 },
  casual: { casual: 60, playful: 35 },
  personal: { casual: 75, playful: 40 },
  funny: { casual: 85, playful: 85 },
};

const LENGTH_RULES: Record<
  Exclude<LengthChoice, "auto">,
  { detailed: number; sentenceLength: "short" | "mixed" | "long" }
> = {
  short: { detailed: 15, sentenceLength: "short" },
  paragraph: { detailed: 50, sentenceLength: "mixed" },
  long: { detailed: 85, sentenceLength: "long" },
};

const EMOJI_RULES: Record<Exclude<EmojiChoice, "auto">, "none" | "light" | "heavy"> = {
  none: "none",
  few: "light",
  plenty: "heavy",
};

/** First person singular for a creator, "we" for a team; a solo owner is left to the voice. */
export function personFor(a: Pick<Answers, "role" | "teamSize">): "i" | "we" | undefined {
  if (a.role === "creator") return "i";
  if (a.teamSize && a.teamSize !== "solo") return "we";
  if (a.role === "marketing" || a.role === "agency") return "we";
  return undefined;
}

/** The look with the answers filled in where the person hasn't set anything. */
export function answersToLook(a: Answers, look: BrandLookSpec | null | undefined): BrandLookSpec {
  const base = look ?? {};
  const writing = { ...(base.writing ?? {}) };
  const tone = { ...(writing.tone ?? {}) };

  const person = personFor(a);
  if (person && !writing.person) writing.person = person;

  if (a.tone && a.tone !== "auto") {
    const t = TONE_SLIDERS[a.tone];
    if (tone.casual === undefined) tone.casual = t.casual;
    if (tone.playful === undefined) tone.playful = t.playful;
  }
  if (a.length && a.length !== "auto") {
    const l = LENGTH_RULES[a.length];
    if (tone.detailed === undefined) tone.detailed = l.detailed;
    if (!writing.sentenceLength) writing.sentenceLength = l.sentenceLength;
  }
  if (Object.keys(tone).length) writing.tone = tone;
  if (a.emoji && a.emoji !== "auto" && !writing.emoji) writing.emoji = EMOJI_RULES[a.emoji];

  const visual = { ...(base.visual ?? {}) };
  const medium = pickedMedium(a.likes);
  if (medium && !visual.medium) {
    visual.medium = medium;
    const mood = MEDIUM_MOOD[medium];
    if (mood && !visual.mood) visual.mood = mood;
  }

  return tidyLook({ ...base, writing, visual });
}

/** The goal as decideGoals reads it, or null while no focus is chosen. Keeps typed targets. */
export function answersToGoals(
  a: Answers,
  existing: WorkspaceGoals | null | undefined,
): Record<string, unknown> | null {
  const focus = a.focus ?? existing?.focus;
  if (!focus) return null;
  const channels = (a.channels ?? existing?.channels ?? []).slice(0, MAX_GOAL_CHANNELS);
  return {
    focus,
    targets: existing?.targets ?? [],
    timeframeWeeks: existing?.timeframeWeeks ?? 12,
    postsPerWeek: a.rhythm ?? existing?.postsPerWeek ?? recommendedRhythm(a.activity, focus),
    channels,
    ...(existing?.note ? { note: existing.note } : {}),
  };
}

export function answersToProfile(
  a: Answers,
  existing?: OnboardingProfile | null,
): OnboardingProfile | undefined {
  const out: OnboardingProfile = { ...(existing ?? {}) };
  if (a.role) out.role = a.role;
  if (a.teamSize) out.teamSize = a.teamSize;
  if (a.activity) out.activity = a.activity;
  if (a.approval) out.approval = a.approval;
  return Object.keys(out).length ? out : undefined;
}

/** One plain line for the prompt: who runs the brand. Null when nothing was said. */
export function whoRunsLine(profile: OnboardingProfile | null | undefined): string | null {
  if (!profile?.role && !profile?.teamSize) return null;
  const team =
    profile.teamSize === "solo"
      ? "on their own"
      : profile.teamSize === "small"
        ? "with a small team (2–10)"
        : profile.teamSize === "mid"
          ? "with a team of 11–100"
          : profile.teamSize === "large"
            ? "a company of 100+"
            : "";
  switch (profile.role) {
    case "creator":
      return `a creator posting as themselves${team === "on their own" ? "" : team ? `, ${team}` : ""}`;
    case "agency":
      return "an agency or freelancer, posting for this brand";
    case "marketing":
      return `the brand's marketing team${team && team !== "on their own" ? `, ${team}` : ""}`;
    case "owner":
      return `the owner${team ? `, ${team}` : ""}`;
    default:
      return team ? `a business ${team}` : null;
  }
}

/** Keep only answers that are real values; anything else in storage is dropped. */
export function readAnswers(raw: unknown): Answers {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const one = <T extends string | number>(list: readonly T[], v: unknown): T | undefined =>
    list.includes(v as T) ? (v as T) : undefined;
  const ids = (v: unknown, allowed?: readonly string[]) =>
    Array.isArray(v)
      ? [...new Set(v.filter((x): x is string => typeof x === "string"))].filter(
          (x) => !allowed || allowed.includes(x),
        )
      : undefined;
  const sampleIds = LOOK_SAMPLES.map((s) => s.id);
  const out: Answers = {
    role: one(ROLES, r.role),
    teamSize: one(TEAM_SIZES, r.teamSize),
    focus: one(["followers", "reach", "leads", "sales", "engagement", "launch"] as const, r.focus),
    activity: one(ACTIVITIES, r.activity),
    rhythm: one(RHYTHMS, r.rhythm),
    channels: ids(r.channels, ONBOARDING_CHANNELS)?.slice(0, MAX_GOAL_CHANNELS) as
      OnboardingChannel[] | undefined,
    tone: one(TONES, r.tone),
    emoji: one(EMOJI_CHOICES, r.emoji),
    length: one(LENGTHS, r.length),
    approval: one(APPROVALS, r.approval),
    likes: ids(r.likes, sampleIds),
    skips: ids(r.skips, sampleIds),
    source: one(SOURCES, r.source),
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined)) as Answers;
}

/**
 * Autopilot's proposed mode from the onboarding answer. "Fully automatic" is
 * only proposed where it is allowed; without an answer it stays the default.
 */
export function autopilotModeFor(answer: string | undefined, fullAllowed: boolean): Approval {
  if (answer === "assist" || answer === "autopilot") return answer;
  if (answer === "full") return fullAllowed ? "full" : "autopilot";
  return fullAllowed ? "full" : "autopilot";
}

/** Posting days for a weekly rhythm (0 = Sunday), spread through the week. */
export function weekdaysForRhythm(postsPerWeek: number): number[] {
  const n = Math.max(1, Math.min(7, Math.round(postsPerWeek)));
  const SPREAD: Record<number, number[]> = {
    1: [3],
    2: [2, 4],
    3: [1, 3, 5],
    4: [1, 2, 4, 5],
    5: [1, 2, 3, 4, 5],
    6: [1, 2, 3, 4, 5, 6],
    7: [0, 1, 2, 3, 4, 5, 6],
  };
  return SPREAD[n];
}
