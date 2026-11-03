// report.ts — the Social analytics report from stored feed rows. Pure and
// browser-safe; the server only loads rows (src/server/analytics/social.server.ts).
//
// Rules:
//  - A post's numbers count on the day it went out (the networks report
//    lifetime totals per post, not per day).
//  - A number no post reported stays null ("not reported"), never 0.
//  - Patterns (best weekday, format, Mellox-made vs not) need at least
//    MIN_PER_GROUP posts per group, the same bar as Autopilot's learnings.
import { compareMetric } from "@/lib/analytics/compare";
import type { MetricKey } from "@/lib/analytics/metrics";
import { addDays, covers, type ResolvedRange } from "@/lib/analytics/ranges";
import type {
  Kpi,
  ReportWindow,
  SeriesPoint,
  SocialGroupRow,
  SocialPlatformRow,
  SocialPostRow,
  SocialReport,
} from "@/lib/analytics/types";
import { engagementOf, type SocialMetricKey, type SocialMetrics } from "./normalize";

export const MIN_PER_GROUP = 2;
/** Weekday patterns need this many posts in the window before they show. */
export const MIN_POSTS_FOR_WEEKDAYS = 8;

export type StoredSocialPost = {
  id: string;
  platform: string;
  account: string | null;
  url: string | null;
  caption: string;
  thumbnail_url: string | null;
  format: string;
  posted_at: string | null;
  metrics: SocialMetrics | null;
  content_item_id: string | null;
};

const FORMATS = new Set(["video", "image", "text", "post"]);

export function toPostRow(p: StoredSocialPost): SocialPostRow {
  const metrics = p.metrics ?? {};
  const engagement = engagementOf(metrics) ?? null;
  return {
    id: p.id,
    platform: p.platform,
    account: p.account,
    url: p.url,
    caption: p.caption,
    thumbnailUrl: p.thumbnail_url,
    format: (FORMATS.has(p.format) ? p.format : "post") as SocialPostRow["format"],
    postedAt: p.posted_at,
    madeInMellox: !!p.content_item_id,
    contentItemId: p.content_item_id,
    metrics,
    engagement,
    engagementRate:
      engagement !== null && metrics.views && metrics.views > 0 ? engagement / metrics.views : null,
  };
}

type Totals = Record<SocialMetricKey | "engagement", number | null> & {
  posts: number;
  /** Views and interactions on posts that report views (for the rate). */
  rateViews: number;
  rateEngagement: number;
};

function totalsOf(rows: SocialPostRow[]): Totals {
  const t: Totals = {
    views: null,
    reach: null,
    likes: null,
    comments: null,
    shares: null,
    saves: null,
    profileVisits: null,
    follows: null,
    linkClicks: null,
    watchSeconds: null,
    engagement: null,
    posts: rows.length,
    rateViews: 0,
    rateEngagement: 0,
  };
  const add = (key: keyof Totals, v: number | null | undefined) => {
    if (v === null || v === undefined) return;
    (t as Record<string, number | null>)[key] = ((t[key] as number | null) ?? 0) + v;
  };
  for (const r of rows) {
    for (const [k, v] of Object.entries(r.metrics) as [SocialMetricKey, number][]) add(k, v);
    add("engagement", r.engagement);
    if (r.engagement !== null && r.metrics.views && r.metrics.views > 0) {
      t.rateViews += r.metrics.views;
      t.rateEngagement += r.engagement;
    }
  }
  return t;
}

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : null);

function inWindow(rows: SocialPostRow[], from: string, to: string) {
  return rows.filter((r) => {
    const d = day(r.postedAt);
    return !!d && d >= from && d <= to;
  });
}

function group(key: string, rows: SocialPostRow[]): SocialGroupRow {
  const views = rows.map((r) => r.metrics.views).filter((v): v is number => v !== undefined);
  const eng = rows.map((r) => r.engagement).filter((v): v is number => v !== null);
  const avg = (xs: number[]) =>
    xs.length >= MIN_PER_GROUP ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  return { key, posts: rows.length, avgViews: avg(views), avgEngagement: avg(eng) };
}

function groupBy(rows: SocialPostRow[], keyOf: (r: SocialPostRow) => string) {
  const map = new Map<string, SocialPostRow[]>();
  for (const r of rows) map.set(keyOf(r), [...(map.get(keyOf(r)) ?? []), r]);
  return map;
}

export function buildSocialReport(input: {
  posts: StoredSocialPost[];
  range: ResolvedRange;
  status: SocialReport["status"];
  /** Earliest date any stored post went out on (for previous-window coverage). */
  firstPostedDate: string | null;
}): SocialReport {
  const { range, status } = input;
  const window: ReportWindow = {
    current: range.current,
    previous: range.previous,
    previousCovered: covers(input.firstPostedDate, range.previous),
    key: range.key,
    label: range.label,
  };
  const all = input.posts.map(toPostRow);
  const cur = inWindow(all, range.current.from, range.current.to);
  const prev = inWindow(all, range.previous.from, range.previous.to);
  const c = totalsOf(cur);
  const p = totalsOf(prev);
  const covered = window.previousCovered;

  const k = (key: MetricKey, a: number | null, b: number | null, volume?: number): Kpi => {
    const comparison = compareMetric(key, a, b, { previousCovered: covered, volume });
    return { key, value: a, comparison };
  };
  const rate = (t: Totals) => (t.rateViews > 0 ? t.rateEngagement / t.rateViews : null);
  const kpis: Kpi[] = [
    k("social.views", c.views, p.views),
    k("social.engagement", c.engagement, p.engagement),
    k("social.engagementRate", rate(c), rate(p), c.rateViews),
    k("social.reach", c.reach, p.reach),
    k("social.follows", c.follows, p.follows),
    k("social.profileVisits", c.profileVisits, p.profileVisits),
    k("social.linkClicks", c.linkClicks, p.linkClicks),
    k("social.posts", c.posts, p.posts),
  ];

  const perDay = (rows: SocialPostRow[], pick: (t: Totals) => number | null) => {
    const byDay = groupBy(rows, (r) => day(r.postedAt) ?? "");
    return (d: string) => {
      const list = byDay.get(d);
      return list ? (pick(totalsOf(list)) ?? 0) : 0;
    };
  };
  const seriesOf = (pick: (t: Totals) => number | null, reported: boolean): SeriesPoint[] => {
    const curDay = perDay(cur, pick);
    const prevDay = perDay(prev, pick);
    return Array.from({ length: range.current.days }, (_, i) => {
      const date = addDays(range.current.from, i);
      const previousDate = addDays(range.previous.from, i);
      return {
        date,
        previousDate,
        value: reported ? curDay(date) : null,
        previous: reported && covered ? prevDay(previousDate) : null,
      };
    });
  };

  const platforms = (rows: SocialPostRow[]): SocialPlatformRow[] =>
    [...groupBy(rows, (r) => r.platform).entries()]
      .map(([platform, list]) => {
        const t = totalsOf(list);
        return {
          platform,
          posts: list.length,
          views: t.views,
          engagement: t.engagement,
          engagementRate: rate(t),
          follows: t.follows,
        };
      })
      .sort((a, b) => (b.views ?? -1) - (a.views ?? -1) || b.posts - a.posts);
  const byPlatform = platforms(cur);

  const score = (r: SocialPostRow) => r.engagement ?? -1;
  const topPosts = [...cur]
    .filter((r) => (r.engagement ?? 0) > 0 || (r.metrics.views ?? 0) > 0)
    .sort((a, b) => score(b) - score(a) || (b.metrics.views ?? 0) - (a.metrics.views ?? 0))
    .slice(0, 8);
  const recentPosts = [...cur]
    .sort((a, b) => (b.postedAt ?? "").localeCompare(a.postedAt ?? ""))
    .slice(0, 12);

  const formats = [...groupBy(cur, (r) => r.format).entries()]
    .map(([key, rows]) => group(key, rows))
    .sort((a, b) => b.posts - a.posts);

  const weekdays =
    cur.length >= MIN_POSTS_FOR_WEEKDAYS
      ? [...groupBy(cur, (r) => String(new Date(r.postedAt as string).getUTCDay())).entries()]
          .filter(([, rows]) => rows.length >= MIN_PER_GROUP)
          .map(([key, rows]) => group(key, rows))
          .sort((a, b) => Number(a.key) - Number(b.key))
      : null;

  const mellox = cur.filter((r) => r.madeInMellox);
  const other = cur.filter((r) => !r.madeInMellox);
  const origin =
    mellox.length >= MIN_PER_GROUP && other.length >= MIN_PER_GROUP
      ? { mellox: group("mellox", mellox), other: group("other", other) }
      : null;

  return {
    source: "social",
    status,
    window,
    kpis,
    series: {
      views: seriesOf((t) => t.views, c.views !== null),
      engagement: seriesOf((t) => t.engagement, c.engagement !== null),
      posts: seriesOf((t) => t.posts, true),
    },
    byPlatform,
    previousByPlatform: covered ? platforms(prev) : null,
    topPosts,
    recentPosts,
    formats,
    weekdays: weekdays && weekdays.length ? weekdays : null,
    origin,
  };
}

/** The report when there is nothing to read yet (no accounts, not set up). */
export function emptySocialReport(status: SocialReport["status"]): SocialReport {
  return {
    source: "social",
    status,
    window: null,
    kpis: [],
    series: { views: [], engagement: [], posts: [] },
    byPlatform: [],
    previousByPlatform: null,
    topPosts: [],
    recentPosts: [],
    formats: [],
    weekdays: null,
    origin: null,
  };
}
