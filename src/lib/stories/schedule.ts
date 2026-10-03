// When Stories go out. Pure: settings and measured results in, times out.
//
// Stories are a daily habit, so the rules differ from feed posts: several a
// day inside a posting window, spaced so they don't pile onto each other,
// made a day ahead (not three) because they are about now, and dropped if not
// approved within a few hours of their slot (yesterday's Story is stale).
import { z } from "zod";
import { STORY_THEME_IDS, type StoryThemeId } from "./frames";
import { STORY_PLATFORMS } from "./placement";

const HM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const StorySettingsSchema = z
  .object({
    enabled: z.boolean().default(false),
    /** Stories per day, each made of `frames` frames. */
    perDay: z.number().int().min(1).max(4).default(1),
    /** 0 = Sunday … 6 = Saturday. Empty means every day. */
    days: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    windowStart: z.string().regex(HM).default("09:00"),
    windowEnd: z.string().regex(HM).default("20:00"),
    platforms: z.array(z.enum(STORY_PLATFORMS)).min(1).max(2).default(["instagram"]),
    themes: z
      .array(z.enum(STORY_THEME_IDS))
      .min(1)
      .max(STORY_THEME_IDS.length)
      .default(["tip", "behind", "question"]),
    frames: z.number().int().min(1).max(5).default(3),
    /** Put the times where this brand's own Stories were watched most. */
    smartTiming: z.boolean().default(true),
  })
  .refine((s) => toMinutes(s.windowEnd) - toMinutes(s.windowStart) >= 60, {
    message: "The posting window must be at least an hour long.",
    path: ["windowEnd"],
  });
export type StorySettings = z.infer<typeof StorySettingsSchema>;

export const DEFAULT_STORY_SETTINGS: StorySettings = {
  enabled: false,
  perDay: 1,
  days: [],
  windowStart: "09:00",
  windowEnd: "20:00",
  platforms: ["instagram"],
  themes: ["tip", "behind", "question"],
  frames: 3,
  smartTiming: true,
};

/** Read stored settings defensively; anything unreadable means "off". */
export function readStorySettings(value: unknown): StorySettings {
  const parsed = StorySettingsSchema.safeParse(value ?? {});
  return parsed.success ? parsed.data : { ...DEFAULT_STORY_SETTINGS, enabled: false };
}

export function toMinutes(hm: string): number {
  const m = HM.exec(hm);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

export function fromMinutes(total: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, Math.round(total)));
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}

/**
 * Times people commonly check Stories (morning commute, lunch, after work,
 * evening). Used until a brand has its own numbers.
 */
const COMMON_PEAKS = ["08:30", "12:30", "18:00", "20:30", "10:30", "15:30"];
const MIN_GAP_MIN = 90;

/** What a brand's own measured Stories show: average reach per local hour. */
export type HourScore = { hour: number; avg: number; count: number };

/** Hours with at least two measured Stories, best first. */
export function bestHours(samples: { hour: number; reach: number }[]): HourScore[] {
  const groups = new Map<number, number[]>();
  for (const s of samples) {
    if (!Number.isInteger(s.hour) || s.hour < 0 || s.hour > 23 || !(s.reach >= 0)) continue;
    groups.set(s.hour, [...(groups.get(s.hour) ?? []), s.reach]);
  }
  return [...groups.entries()]
    .filter(([, v]) => v.length >= 2)
    .map(([hour, v]) => ({ hour, count: v.length, avg: v.reduce((a, b) => a + b, 0) / v.length }))
    .sort((a, b) => b.avg - a.avg || a.hour - b.hour);
}

/**
 * The day's Story times inside the window. Measured hours come first when
 * smart timing is on, then common peaks, then even spacing; times keep at
 * least 90 minutes apart when the window allows it.
 */
export function storyTimes(args: {
  windowStart: string;
  windowEnd: string;
  perDay: number;
  learned?: HourScore[];
}): { times: string[]; source: "learned" | "common" | "even" } {
  const start = toMinutes(args.windowStart);
  const end = Math.max(start + 60, toMinutes(args.windowEnd));
  const n = Math.max(1, Math.min(4, args.perDay));
  const gap = Math.min(MIN_GAP_MIN, Math.floor((end - start) / n));
  const picked: number[] = [];
  let source: "learned" | "common" | "even" = "even";
  const fits = (m: number) => m >= start && m <= end && picked.every((p) => Math.abs(p - m) >= gap);

  for (const h of args.learned ?? []) {
    if (picked.length >= n) break;
    const m = h.hour * 60 + 15;
    if (fits(m)) {
      picked.push(m);
      source = "learned";
    }
  }
  for (const peak of COMMON_PEAKS) {
    if (picked.length >= n) break;
    const m = toMinutes(peak);
    if (fits(m)) {
      picked.push(m);
      if (source === "even") source = "common";
    }
  }
  for (let i = 0; picked.length < n && i < n * 4; i++) {
    const m = start + Math.round(((i % n) + 0.5) * ((end - start) / n)) + Math.floor(i / n) * 7;
    if (fits(m)) picked.push(m);
  }
  while (picked.length < n) picked.push(start + picked.length);
  return { times: picked.sort((a, b) => a - b).map(fromMinutes), source };
}

/* ───────────────────────── timing rules for the worker ───────────────────────── */

const HOUR = 60 * 60_000;
/** Stories are made the day before their slot, not days ahead: they are about now. */
export const STORY_GENERATE_LEAD_MS = 30 * HOUR;
/** A Story not approved within this long after its slot is not sent. */
export const STORY_APPROVAL_GRACE_MS = 6 * HOUR;
/** Measure after the Story has expired (24 h) and its last numbers are in. */
export const STORY_MEASURE_AFTER_MS = 26 * HOUR;
/** Slot numbers for Stories in a week's plan: 200 + day * 10 + n. */
export const STORY_SLOT_BASE = 200;

export function isStorySlot(index: number | null | undefined): boolean {
  return typeof index === "number" && index >= STORY_SLOT_BASE && index < STORY_SLOT_BASE + 100;
}

export type StorySlot = {
  index: number;
  date: string;
  time: string;
  theme: StoryThemeId;
  platforms: string[];
};

/**
 * A week of Story slots. Themes rotate through the chosen mix so no two
 * Stories in a row share a theme, and the rotation continues across weeks.
 */
export function weekStorySlots(args: {
  settings: StorySettings;
  /** The week's first day (YYYY-MM-DD) and the program's last day. */
  weekStart: string;
  endsOn: string;
  learned?: HourScore[];
  /** How many Stories came before this week, so the rotation continues. */
  offset?: number;
  addDays: (date: string, days: number) => string;
  weekday: (date: string) => number;
}): StorySlot[] {
  const { settings } = args;
  if (!settings.enabled) return [];
  const { times } = storyTimes({
    windowStart: settings.windowStart,
    windowEnd: settings.windowEnd,
    perDay: settings.perDay,
    learned: settings.smartTiming ? args.learned : undefined,
  });
  const themes = settings.themes.filter((t) => t !== "repurpose");
  const mix: StoryThemeId[] = themes.length ? themes : ["tip"];
  const slots: StorySlot[] = [];
  let turn = args.offset ?? 0;
  for (let day = 0; day < 7; day++) {
    const date = args.addDays(args.weekStart, day);
    if (date > args.endsOn) break;
    if (settings.days.length && !settings.days.includes(args.weekday(date))) continue;
    times.forEach((time, n) => {
      slots.push({
        index: STORY_SLOT_BASE + day * 10 + n,
        date,
        time,
        theme: mix[turn % mix.length],
        platforms: [...settings.platforms],
      });
      turn++;
    });
  }
  return slots;
}
