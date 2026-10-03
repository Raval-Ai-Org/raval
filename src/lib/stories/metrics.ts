// Story numbers. Pure and browser-safe.
//
// Instagram reports Story reach, views, replies, shares, navigation (taps
// forward, back and exits together), profile visits and follows; Facebook
// reports media views and reach. Both only while the Story is live, which is
// why Mellox reads them hourly during the first day and keeps the last
// snapshot afterwards. Nothing here estimates a number the network didn't send.

export type StoryMetrics = {
  views: number;
  reach: number;
  replies: number;
  shares: number;
  /** Taps forward and back plus exits, as one number (that is how it arrives). */
  taps: number;
  profileVisits: number;
  follows: number;
};

export const EMPTY_STORY_METRICS: StoryMetrics = {
  views: 0,
  reach: 0,
  replies: 0,
  shares: 0,
  taps: 0,
  profileVisits: 0,
  follows: 0,
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

function pick(raw: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const v = num(raw[key]);
    if (v) return v;
  }
  return 0;
}

/** One frame's numbers, from a network's raw metrics object. */
export function storyMetricsFrom(raw: unknown): StoryMetrics {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    views: pick(r, ["views", "media_views", "impressions", "video_views", "plays"]),
    reach: pick(r, ["reach", "impressions_unique", "post_impressions_unique"]),
    replies: pick(r, ["replies"]),
    shares: pick(r, ["shares", "share_count"]),
    taps: pick(r, ["navigation", "taps_forward", "taps"]),
    profileVisits: pick(r, ["profile_visits", "profile_activity"]),
    follows: pick(r, ["follows"]),
  };
}

export function addStoryMetrics(a: StoryMetrics, b: StoryMetrics): StoryMetrics {
  return {
    views: a.views + b.views,
    reach: a.reach + b.reach,
    replies: a.replies + b.replies,
    shares: a.shares + b.shares,
    taps: a.taps + b.taps,
    profileVisits: a.profileVisits + b.profileVisits,
    follows: a.follows + b.follows,
  };
}

/**
 * A multi-frame Story's reach is the first frame's (everyone who saw any of
 * it saw that one); views, replies and the rest add up across frames.
 */
export function combineFrames(frames: StoryMetrics[]): StoryMetrics {
  if (!frames.length) return { ...EMPTY_STORY_METRICS };
  const total = frames.reduce(addStoryMetrics, { ...EMPTY_STORY_METRICS });
  return { ...total, reach: Math.max(...frames.map((f) => f.reach)) };
}

/**
 * How many viewers made it to the last frame, when the network gave reach for
 * both ends. Null when it can't be said honestly.
 */
export function holdRate(frames: StoryMetrics[]): number | null {
  if (frames.length < 2) return null;
  const first = frames[0].reach;
  const last = frames[frames.length - 1].reach;
  if (!first || !last) return null;
  return Math.min(1, last / first);
}

export type StoryRecord = {
  id: string;
  title: string;
  platform: string | null;
  publishedAt: string | null;
  /** Local hour it went out, 0–23, when known. */
  hour?: number | null;
  frames: number;
  metrics: StoryMetrics | null;
  hold?: number | null;
};

export type StorySummary = {
  count: number;
  measured: number;
  reach: number;
  views: number;
  replies: number;
  avgReach: number;
  replyRate: number | null;
  avgHold: number | null;
  best: StoryRecord | null;
  bestHour: number | null;
};

export function summarizeStories(records: StoryRecord[]): StorySummary {
  const measured = records.filter((r) => r.metrics && (r.metrics.reach || r.metrics.views));
  const reach = measured.reduce((a, r) => a + (r.metrics?.reach ?? 0), 0);
  const views = measured.reduce((a, r) => a + (r.metrics?.views ?? 0), 0);
  const replies = measured.reduce((a, r) => a + (r.metrics?.replies ?? 0), 0);
  const holds = measured.map((r) => r.hold).filter((h): h is number => typeof h === "number");
  const best =
    [...measured].sort(
      (a, b) =>
        (b.metrics?.reach ?? 0) - (a.metrics?.reach ?? 0) ||
        (b.metrics?.views ?? 0) - (a.metrics?.views ?? 0),
    )[0] ?? null;
  const byHour = new Map<number, number[]>();
  for (const r of measured) {
    if (typeof r.hour !== "number") continue;
    byHour.set(r.hour, [...(byHour.get(r.hour) ?? []), r.metrics?.reach ?? 0]);
  }
  const hours = [...byHour.entries()]
    .filter(([, v]) => v.length >= 2)
    .map(([hour, v]) => ({ hour, avg: v.reduce((a, b) => a + b, 0) / v.length }))
    .sort((a, b) => b.avg - a.avg);
  return {
    count: records.length,
    measured: measured.length,
    reach,
    views,
    replies,
    avgReach: measured.length ? Math.round(reach / measured.length) : 0,
    replyRate: reach > 0 ? replies / reach : null,
    avgHold: holds.length ? holds.reduce((a, b) => a + b, 0) / holds.length : null,
    best,
    bestHour: hours[0]?.hour ?? null,
  };
}

export function formatHour(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  const suffix = h < 12 ? "am" : "pm";
  return `${h % 12 === 0 ? 12 : h % 12}${suffix}`;
}
