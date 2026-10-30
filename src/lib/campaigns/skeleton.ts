// The campaign skeleton: dates, phases, channels, formats, aims, openings and
// Stories, decided by code before any model is asked anything. It is free, so
// the person sees the whole shape of the campaign the moment they've filled in
// the brief, and the paid plan only writes the ideas into it.
//
// Rules it keeps:
//   - phases are laid out around the key date (before / on the day / after);
//   - a channel gets at most one feed post a day across everything already on
//     the calendar — the person's own posts, other campaigns, Autopilot;
//   - a channel only gets a format it can carry;
//   - two pieces in a row never open the same way.
// Pure: no I/O.
import { STUDIO_FORMATS } from "@/lib/studio/formats";
import { isStoryPlatform } from "@/lib/stories/placement";
import { addDaysYmd, daysBetweenYmd } from "@/lib/autopilot/time";
import {
  MAX_CAMPAIGN_PIECES,
  PACE_POSTS,
  type CampaignBrief,
  type CampaignFormat,
  type CampaignPhase,
  type CampaignPiece,
  type PlatformId,
} from "./contracts";
import type { Playbook, PlaybookPhase } from "./playbooks";

/** A post already on a day and channel. */
export type TakenSlot = { date: string; platform: string | null };

/** Usual good times per channel, in the campaign's own time zone. */
const TIMES: Record<PlatformId, string[]> = {
  instagram: ["18:00", "12:00"],
  facebook: ["13:00", "19:00"],
  linkedin: ["09:00", "12:30"],
  twitter: ["12:00", "17:00"],
  threads: ["19:00", "12:00"],
  tiktok: ["19:00", "21:00"],
  youtube: ["17:00", "12:00"],
};
const STORY_TIMES = ["11:30", "16:30", "20:00"];

export type Skeleton = {
  startsOn: string;
  endsOn: string;
  keyDate: string;
  phases: CampaignPhase[];
  pieces: CampaignPiece[];
  /** Slots left out because the day was already full. */
  skipped: number;
};

type PhaseWindow = { phase: PlaybookPhase; from: string; to: string };

/** `n` picks spread evenly over `length` positions. */
function spread(length: number, n: number): number[] {
  if (length <= 0 || n <= 0) return [];
  return Array.from({ length: n }, (_, i) =>
    Math.max(0, Math.min(length - 1, Math.round(((i + 0.5) * length) / n - 0.5))),
  );
}

/** Split `days` between phases by share, keeping order; a phase may get none. */
function splitDays(phases: PlaybookPhase[], from: string, days: number): PhaseWindow[] {
  if (!phases.length || days <= 0) return [];
  const total = phases.reduce((sum, p) => sum + Math.max(0.1, p.share), 0);
  const out: PhaseWindow[] = [];
  let start = 0;
  let used = 0;
  phases.forEach((phase, i) => {
    used += Math.max(0.1, phase.share);
    const end = i === phases.length - 1 ? days : Math.round((used / total) * days);
    if (end > start) {
      out.push({ phase, from: addDaysYmd(from, start), to: addDaysYmd(from, end - 1) });
      start = end;
    }
  });
  return out;
}

/**
 * When the campaign runs. With a key date, the before-phases end the day
 * before it and the after-phases run for the playbook's follow-up days. With
 * none, the campaign runs its weeks and the "day" phase lands near the end.
 */
export function campaignWindow(
  playbook: Playbook,
  brief: Pick<CampaignBrief, "startsOn" | "keyDate" | "weeks">,
  today: string,
): { startsOn: string; keyDate: string; endsOn: string } {
  const earliest = addDaysYmd(today, 1);
  const startsOn = brief.startsOn < earliest ? earliest : brief.startsOn;
  const hasAfter = playbook.phases.some((p) => p.when === "after");
  if (brief.keyDate) {
    const keyDate = brief.keyDate < startsOn ? startsOn : brief.keyDate;
    const endsOn = hasAfter ? addDaysYmd(keyDate, Math.max(1, playbook.afterDays)) : keyDate;
    return { startsOn, keyDate, endsOn };
  }
  const total = Math.max(7, brief.weeks * 7);
  const after = hasAfter ? Math.min(Math.max(1, playbook.afterDays), Math.floor(total / 3)) : 0;
  const keyDate = addDaysYmd(startsOn, total - 1 - after);
  return { startsOn, keyDate, endsOn: addDaysYmd(keyDate, after) };
}

function windows(
  playbook: Playbook,
  startsOn: string,
  keyDate: string,
  endsOn: string,
): PhaseWindow[] {
  const before = playbook.phases.filter((p) => p.when === "before");
  const day = playbook.phases.filter((p) => p.when === "day");
  const after = playbook.phases.filter((p) => p.when === "after");
  return [
    ...splitDays(before, startsOn, daysBetweenYmd(startsOn, keyDate)),
    ...day.map((phase) => ({ phase, from: keyDate, to: keyDate })),
    ...splitDays(after, addDaysYmd(keyDate, 1), daysBetweenYmd(keyDate, endsOn)),
  ];
}

/** The best format of the phase's list this channel can carry. */
export function formatFor(
  phase: Pick<PlaybookPhase, "formats">,
  platform: PlatformId,
  turn: number,
): CampaignFormat {
  const fits = phase.formats.filter(
    (f) => f !== "story" && STUDIO_FORMATS[f].platforms.includes(platform),
  );
  if (!fits.length) return "social";
  return fits[turn % fits.length];
}

function nextHook(options: readonly string[], previous: string | null, turn: number): string {
  const list = options.length ? options : ["question"];
  for (let i = 0; i < list.length; i++) {
    const pick = list[(turn + i) % list.length];
    if (pick !== previous) return pick;
  }
  return list[0];
}

export function buildCampaignSkeleton(
  playbook: Playbook,
  brief: Pick<CampaignBrief, "startsOn" | "keyDate" | "weeks" | "channels" | "pace" | "stories">,
  taken: readonly TakenSlot[],
  today: string,
): Skeleton {
  const { startsOn, keyDate, endsOn } = campaignWindow(playbook, brief, today);
  const spans = windows(playbook, startsOn, keyDate, endsOn);
  const channels = brief.channels.length ? brief.channels : (["instagram"] as PlatformId[]);
  const storyChannels = channels.filter(isStoryPlatform);
  const totalDays = daysBetweenYmd(startsOn, endsOn) + 1;

  const busy = new Set(taken.filter((t) => t.platform).map((t) => `${t.date}|${t.platform}`));

  // How many feed posts the whole campaign gets, then each phase's part.
  const wanted = Math.round((PACE_POSTS[brief.pace] * totalDays) / 7);
  const feedBudget = Math.max(spans.length, Math.min(MAX_CAMPAIGN_PIECES - 12, wanted));
  const perPhase = spans.map((span) => {
    const days = daysBetweenYmd(span.from, span.to) + 1;
    if (span.phase.when === "day") return Math.min(channels.length, 3);
    return Math.max(1, Math.round((feedBudget * days) / totalDays));
  });

  const pieces: CampaignPiece[] = [];
  let skipped = 0;
  let channelTurn = 0;
  let previousHook: string | null = null;

  spans.forEach((span, s) => {
    const days = daysBetweenYmd(span.from, span.to) + 1;
    const count = perPhase[s];
    const picks =
      span.phase.when === "day" ? Array.from({ length: count }, () => 0) : spread(days, count);
    let k = 0;
    picks.forEach((offset, i) => {
      // Find a day and channel that's free: this day first, then the days next to it.
      let placed: { date: string; platform: PlatformId } | null = null;
      for (const shift of [0, 1, -1, 2, -2]) {
        const dayIndex = offset + shift;
        if (dayIndex < 0 || dayIndex >= days) continue;
        const date = addDaysYmd(span.from, dayIndex);
        for (let c = 0; c < channels.length; c++) {
          const platform = channels[(channelTurn + c) % channels.length];
          if (!busy.has(`${date}|${platform}`)) {
            placed = { date, platform };
            break;
          }
        }
        if (placed) break;
      }
      channelTurn++;
      if (!placed) {
        skipped++;
        return;
      }
      busy.add(`${placed.date}|${placed.platform}`);
      const hook = nextHook(span.phase.hooks, previousHook, pieces.length);
      previousHook = hook;
      k++;
      pieces.push({
        id: `${span.phase.id}-${k}`,
        phase: span.phase.id,
        date: placed.date,
        time: TIMES[placed.platform][i % TIMES[placed.platform].length],
        platform: placed.platform,
        format: formatFor(span.phase, placed.platform, i),
        aim: span.phase.aims[i % span.phase.aims.length],
        hook,
        storyTheme: null,
        title: "",
        idea: "",
        visual: "",
        mediaIds: [],
        mediaMode: "none",
        edited: false,
      });
    });

    // Stories carry the phase between posts: about one every three days.
    if (brief.stories && storyChannels.length && span.phase.story) {
      const storyCount =
        span.phase.when === "day" ? 2 : Math.min(3, Math.max(1, Math.round(days / 3)));
      const storyDays = span.phase.when === "day" ? [0, 0] : spread(days, storyCount);
      storyDays.forEach((offset, i) => {
        pieces.push({
          id: `${span.phase.id}-s${i + 1}`,
          phase: span.phase.id,
          date: addDaysYmd(span.from, offset),
          time: STORY_TIMES[i % STORY_TIMES.length],
          platform: storyChannels[0],
          format: "story",
          aim: span.phase.aims[0],
          hook: span.phase.hooks[0] ?? "question",
          storyTheme: span.phase.story,
          title: "",
          idea: "",
          visual: "",
          mediaIds: [],
          mediaMode: "none",
          edited: false,
        });
      });
    }
  });

  pieces.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  const phases: CampaignPhase[] = spans.map((span) => ({
    id: span.phase.id,
    label: span.phase.label,
    purpose: span.phase.purpose,
    startsOn: span.from,
    endsOn: span.to,
  }));
  return {
    startsOn,
    endsOn,
    keyDate,
    phases,
    pieces: pieces.slice(0, MAX_CAMPAIGN_PIECES),
    skipped,
  };
}

/** The day and channel pairs a set of pieces fills, for the next plan to avoid. */
export function takenBy(
  pieces: readonly Pick<CampaignPiece, "date" | "platform" | "format">[],
): TakenSlot[] {
  return pieces
    .filter((p) => p.format !== "story")
    .map((p) => ({ date: p.date, platform: p.platform }));
}
