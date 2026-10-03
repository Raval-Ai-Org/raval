// The deterministic half of Autopilot. A model may suggest what to write; the
// functions here decide when it goes, in which format, whether it fits the
// limits, whether it repeats something, and whether a person must approve it.
// Pure: no I/O, no clock other than the `now` passed in.
import { buildPlanSlots, PLAN_TOPICS } from "@/lib/calendar/planner";
import type { CalendarChannel } from "@/lib/calendar/model";
import { creditsFor, type CreditAction } from "@/lib/billing/catalog";
import { studioChargeFor } from "@/lib/studio/billing";
import { STUDIO_FORMATS, type StudioType } from "@/lib/studio/formats";
import { similarity } from "@/lib/studio/ideas";
import type { PlatformId } from "@/lib/social-platforms";
import {
  isAutopilotType,
  type AutopilotMode,
  type AutopilotType,
  type PlanType,
  type ProgramRow,
} from "./contracts";
import { addDaysYmd, daysBetweenYmd, zonedInstant } from "./time";
import {
  STORY_APPROVAL_GRACE_MS,
  STORY_GENERATE_LEAD_MS,
  readStorySettings,
  weekStorySlots,
  type HourScore,
} from "@/lib/stories/schedule";

/* ───────────────────────── cost ───────────────────────── */

export type Cost = { credits: number; videos: number };

/** What one piece costs — the same price as making it by hand in Studio. */
export function estimateCost(type: StudioType): Cost {
  const charge = studioChargeFor({ type, includeImage: false });
  if (charge === "studio_video") return { credits: 0, videos: 1 };
  return { credits: creditsFor(charge as CreditAction), videos: 0 };
}

export type BudgetVerdict = { ok: true } | { ok: false; reason: "credits" | "videos" };

export function budgetVerdict(args: {
  type: StudioType;
  usedCredits: number;
  usedVideos: number;
  creditCap: number;
  videoCap: number;
}): BudgetVerdict {
  const cost = estimateCost(args.type);
  if (cost.videos > 0 && args.usedVideos + cost.videos > args.videoCap) {
    return { ok: false, reason: "videos" };
  }
  if (cost.credits > 0 && args.usedCredits + cost.credits > args.creditCap) {
    return { ok: false, reason: "credits" };
  }
  return { ok: true };
}

/* ───────────────────────── slots ───────────────────────── */

export type CycleSlot = {
  index: number;
  date: string;
  time: string;
  /** null for an article, which is not tied to a social account. */
  platform: PlatformId | null;
  /** The format this slot gets unless the plan picks another allowed one. */
  type: PlanType;
  allowedTypes: PlanType[];
  /** A post's topic, or a Story's theme (src/lib/stories/frames.ts). */
  topic: string;
  moment?: string;
  at: string;
  /** Story slots: every account the Story goes to (Instagram, Facebook). */
  platforms?: PlatformId[];
};

const ARTICLE_SLOT = 100;

function platformOf(channel: CalendarChannel): PlatformId | null {
  if (channel === "x") return "twitter";
  if (channel === "blog" || channel === "email") return null;
  return channel as PlatformId;
}

function typesFor(platform: PlatformId, contentTypes: readonly string[]): AutopilotType[] {
  const fits = contentTypes.filter(
    (t): t is AutopilotType =>
      isAutopilotType(t) && t !== "article" && STUDIO_FORMATS[t].platforms.includes(platform),
  );
  return fits.length ? fits : ["social"];
}

export function totalWeeks(program: Pick<ProgramRow, "starts_on" | "ends_on">): number {
  return Math.max(1, Math.ceil((daysBetweenYmd(program.starts_on, program.ends_on) + 1) / 7));
}

export function cycleStart(program: Pick<ProgramRow, "starts_on">, cycle: number): string {
  return addDaysYmd(program.starts_on, (Math.max(1, cycle) - 1) * 7);
}

/** The week `now` falls in, 1-based; 0 before the program starts. */
export function weekOf(program: Pick<ProgramRow, "starts_on">, today: string): number {
  const days = daysBetweenYmd(program.starts_on, today);
  return days < 0 ? 0 : Math.floor(days / 7) + 1;
}

/**
 * The dated slots for one week of a program. Days, times and platforms come
 * from the calendar planner; formats rotate through what the person allowed.
 * Slots in the past, too close to now, or after the end date are left out.
 */
export function cycleSlots(
  program: Pick<
    ProgramRow,
    | "starts_on"
    | "ends_on"
    | "posts_per_week"
    | "platforms"
    | "content_types"
    | "weekdays"
    | "timezone"
    | "video_cap_per_week"
  > &
    Partial<Pick<ProgramRow, "stories">>,
  cycle: number,
  now: Date,
  minLeadMs = 2 * 60 * 60_000,
  /** Hours this brand's own Stories reached the most people (smart timing). */
  storyHours?: HourScore[],
): CycleSlot[] {
  const start = cycleStart(program, cycle);
  const channels = program.platforms.map((p) => (p === "twitter" ? "x" : p)) as CalendarChannel[];
  const base =
    program.posts_per_week > 0
      ? buildPlanSlots({
          startDate: start,
          weeks: 1,
          postsPerWeek: program.posts_per_week,
          channels,
          weekdays: program.weekdays,
          topics: PLAN_TOPICS.map((t) => t.id),
          industry: "auto",
          keyDates: true,
        })
      : [];

  const turn = new Map<string, number>();
  let videos = 0;
  const slots: CycleSlot[] = [];
  for (const slot of base) {
    const platform = platformOf(slot.channel);
    if (!platform) continue;
    const allowed = typesFor(platform, program.content_types);
    const n = turn.get(platform) ?? 0;
    turn.set(platform, n + 1);
    let type = allowed[n % allowed.length];
    if (type === "video") {
      if (videos >= program.video_cap_per_week) {
        type = allowed.find((t) => t !== "video") ?? "social";
      } else {
        videos++;
      }
    }
    slots.push({
      index: slot.index,
      date: slot.date,
      time: slot.time,
      platform,
      type,
      allowedTypes: allowed.filter((t) => t !== "video" || type === "video"),
      topic: slot.topic,
      moment: slot.moment?.name,
      at: zonedInstant(slot.date, slot.time, program.timezone).toISOString(),
    });
  }

  if (program.content_types.includes("article")) {
    const date = addDaysYmd(start, 2);
    slots.push({
      index: ARTICLE_SLOT,
      date,
      time: "10:00",
      platform: null,
      type: "article",
      allowedTypes: ["article"],
      topic: "tips",
      at: zonedInstant(date, "10:00", program.timezone).toISOString(),
    });
  }

  // Story Autopilot: daily Story slots inside the posting window.
  const stories = readStorySettings(program.stories);
  if (stories.enabled && program.posts_per_week >= 0) {
    const perWeek = stories.perDay * (stories.days.length || 7);
    for (const s of weekStorySlots({
      settings: stories,
      weekStart: start,
      endsOn: program.ends_on,
      learned: storyHours,
      offset: Math.max(0, cycle - 1) * perWeek,
      addDays: addDaysYmd,
      weekday: (date) => new Date(`${date}T12:00:00Z`).getUTCDay(),
    })) {
      slots.push({
        index: s.index,
        date: s.date,
        time: s.time,
        platform: s.platforms[0] as PlatformId,
        platforms: s.platforms as PlatformId[],
        type: "story",
        allowedTypes: ["story"],
        topic: s.theme,
        at: zonedInstant(s.date, s.time, program.timezone).toISOString(),
      });
    }
  }

  const earliest = now.getTime() + minLeadMs;
  return slots.filter((s) => s.date <= program.ends_on && Date.parse(s.at) >= earliest);
}

/* ───────────────────────── plan ───────────────────────── */

export type PlanProposal = {
  slot: number;
  type?: string;
  title: string;
  brief: string;
  reason: string;
  /** Index into the opportunities the model was shown, if it used one. */
  opportunity?: number | null;
};

export type PlanItem = {
  slot: CycleSlot;
  type: PlanType;
  title: string;
  brief: string;
  reason: string;
  opportunity: number | null;
};

export type PlanDrop = { slot: number; reason: "unknown_slot" | "weak" | "duplicate" | "budget" };

const DUPLICATE_AT = 0.45;

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, max) : "";
}

/**
 * Turn what the model proposed into what will actually be made. A proposal
 * survives only if it names a real slot, says enough to act on, doesn't repeat
 * recent work or another item, and fits the weekly limits.
 */
export function planVerdict(args: {
  slots: CycleSlot[];
  proposals: PlanProposal[];
  recentTitles: string[];
  opportunityCount: number;
  creditCap: number;
  usedCredits?: number;
}): { items: PlanItem[]; dropped: PlanDrop[] } {
  const bySlot = new Map(args.slots.map((s) => [s.index, s]));
  const items: PlanItem[] = [];
  const dropped: PlanDrop[] = [];
  const taken = new Set<number>();
  let credits = args.usedCredits ?? 0;

  const ordered = [...args.proposals].sort((a, b) => {
    const sa = bySlot.get(a.slot)?.at ?? "";
    const sb = bySlot.get(b.slot)?.at ?? "";
    return sa.localeCompare(sb);
  });

  for (const proposal of ordered) {
    const slot = bySlot.get(proposal.slot);
    if (!slot || taken.has(proposal.slot)) {
      dropped.push({ slot: proposal.slot, reason: "unknown_slot" });
      continue;
    }
    const title = clean(proposal.title, 120);
    const brief = clean(proposal.brief, 1200);
    if (title.length < 6 || brief.length < 20) {
      dropped.push({ slot: slot.index, reason: "weak" });
      continue;
    }
    const repeats =
      args.recentTitles.some((t) => similarity(title, t) >= DUPLICATE_AT) ||
      items.some((i) => similarity(title, i.title) >= DUPLICATE_AT);
    if (repeats) {
      dropped.push({ slot: slot.index, reason: "duplicate" });
      continue;
    }
    const type: PlanType =
      isAutopilotType(proposal.type) && slot.allowedTypes.includes(proposal.type)
        ? proposal.type
        : slot.type;
    const cost = estimateCost(type);
    if (cost.credits > 0 && credits + cost.credits > args.creditCap) {
      dropped.push({ slot: slot.index, reason: "budget" });
      continue;
    }
    credits += cost.credits;
    taken.add(slot.index);
    const opp = proposal.opportunity;
    items.push({
      slot,
      type,
      title,
      brief,
      reason: clean(proposal.reason, 300),
      opportunity:
        typeof opp === "number" && Number.isInteger(opp) && opp >= 0 && opp < args.opportunityCount
          ? opp
          : null,
    });
  }
  return { items, dropped };
}

/* ───────────────────────── timing ───────────────────────── */

const HOUR = 60 * 60_000;
/** Make a piece this long before its slot, so there is time to approve it. */
export const GENERATE_LEAD_MS = 72 * HOUR;
/** After this long past its slot without a yes, a piece is no longer sent. */
export const APPROVAL_GRACE_MS = 48 * HOUR;
/** The soonest a just-approved piece may be scheduled. */
export const MIN_SCHEDULE_LEAD_MS = 10 * 60_000;

/**
 * When to make a piece. Stories are made the day before (they are about now),
 * everything else three days ahead. Never at the slot itself.
 */
export function generateAt(plannedFor: string, now: Date, type?: string | null): Date {
  const lead = type === "story" ? STORY_GENERATE_LEAD_MS : GENERATE_LEAD_MS;
  return new Date(Math.max(now.getTime(), Date.parse(plannedFor) - lead));
}

/** A Story is stale a few hours after its slot; a post can still go out two days late. */
export function isPastApproval(
  plannedFor: string | null,
  now: Date,
  type?: string | null,
): boolean {
  const grace = type === "story" ? STORY_APPROVAL_GRACE_MS : APPROVAL_GRACE_MS;
  return Boolean(plannedFor) && now.getTime() > Date.parse(plannedFor!) + grace;
}

/** Approved late: send soon rather than in the past. Never earlier than planned. */
export function scheduleTime(plannedFor: string | null, now: Date): Date {
  const planned = plannedFor ? Date.parse(plannedFor) : 0;
  return new Date(Math.max(planned, now.getTime() + MIN_SCHEDULE_LEAD_MS));
}

/* ───────────────────────── approval ───────────────────────── */

/**
 * Formats Full Autopilot may send without a person. Everything else waits.
 * A designed Story (frames drawn by code from checked text) passes the same
 * checks as a post; a video Story never goes without a person.
 */
export const FULL_AUTO_TYPES: readonly StudioType[] = ["social", "image", "story"];
export const FULL_AUTO_DAILY_CAP = 2;

export type PublishDecision = { auto: boolean; reasons: string[] };

/**
 * Whether a finished piece may be approved without a person. Only ever true in
 * Full mode, with the Full flag on for this workspace, and every check clean.
 * Each failed check is named, so the history can say why a piece waited.
 */
export function publishDecision(args: {
  mode: AutopilotMode;
  fullEnabled: boolean;
  hasProgram: boolean;
  contentType: string | null;
  warnings: number;
  inventedFacts: number;
  autoApprovedToday: number;
  accountConnected: boolean;
  dailyCap?: number;
  /** Stories: a video Story always waits for a person. */
  video?: boolean;
}): PublishDecision {
  const reasons: string[] = [];
  if (!args.hasProgram) reasons.push("one_off");
  if (args.mode !== "full") reasons.push("mode");
  if (!args.fullEnabled) reasons.push("full_not_enabled");
  if (!FULL_AUTO_TYPES.includes(args.contentType as StudioType) || args.video)
    reasons.push("format");
  if (args.warnings > 0) reasons.push("quality_warnings");
  if (args.inventedFacts > 0) reasons.push("unverified_facts");
  if (args.autoApprovedToday >= (args.dailyCap ?? FULL_AUTO_DAILY_CAP)) reasons.push("daily_cap");
  if (!args.accountConnected) reasons.push("account_not_connected");
  return { auto: reasons.length === 0, reasons };
}
