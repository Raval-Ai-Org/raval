// Content Calendar — the browser-safe model: what a calendar post is, how a
// stored content item becomes one, and the date maths the views share.
//
// A post's place on the calendar comes from, in order: the time it is really
// scheduled for (`scheduled_at`), the day it was planned for
// (`meta.calendar_date` / `meta.calendar_time`), then the day it was created.
// Planning a day never schedules anything: only the publishing flow does that.

export type CalendarChannel =
  "instagram" | "facebook" | "linkedin" | "x" | "threads" | "tiktok" | "youtube" | "blog" | "email";

export type CalendarStatus =
  "draft" | "review" | "approved" | "scheduled" | "publishing" | "published" | "failed";

export type VersionSnapshot = {
  id: string;
  at: number; // epoch ms
  label?: string; // "manual" | "auto"
  title: string;
  caption?: string;
  hashtags?: string[];
};

export type CalendarEntry = {
  id: string;
  date: string; // YYYY-MM-DD, in the viewer's own time zone
  time: string; // HH:mm
  channel: CalendarChannel;
  /** What kind of post it is, in plain words ("Post", "Carousel", "Article"). */
  format: string;
  /** The topic group it belongs to ("Tips and how-tos"), when planned by Mellox. */
  topic?: string;
  title: string;
  caption?: string;
  hashtags: string[];
  status: CalendarStatus;
  images: string[];
};

/** The stored row fields the calendar reads (a subset of `ContentItem`). */
export type CalendarSourceItem = {
  id: string;
  kind: string;
  channel: string | null;
  title: string | null;
  body: string | null;
  hashtags: string[] | null;
  media_url: string | null;
  status: string;
  scheduled_at: string | null;
  meta: unknown;
  created_at: string;
  updated_at: string;
};

/**
 * `color` tints channel dots and chips. X and TikTok carry each brand's
 * published secondary (neutral grey, pink) because their primary black is
 * invisible on the dark theme's canvas.
 */
export const CALENDAR_CHANNELS: readonly {
  id: CalendarChannel;
  label: string;
  color: string;
  /** True when Mellox can post to it directly from a connected account. */
  social: boolean;
}[] = [
  { id: "instagram", label: "Instagram", color: "#E1306C", social: true },
  { id: "facebook", label: "Facebook", color: "#1877F2", social: true },
  { id: "linkedin", label: "LinkedIn", color: "#0A66C2", social: true },
  { id: "x", label: "X", color: "#71767B", social: true },
  { id: "threads", label: "Threads", color: "#8A8D91", social: true },
  { id: "tiktok", label: "TikTok", color: "#FE2C55", social: true },
  { id: "youtube", label: "YouTube", color: "#FF0000", social: true },
  { id: "blog", label: "Blog", color: "#14B8A6", social: false },
  { id: "email", label: "Email", color: "#F59E0B", social: false },
];

const CHANNEL_BY_ID = new Map(CALENDAR_CHANNELS.map((c) => [c.id, c]));

export function channelInfo(id: CalendarChannel) {
  return CHANNEL_BY_ID.get(id) ?? CALENDAR_CHANNELS[0];
}

/** Any stored or legacy channel value, mapped to one the calendar can draw. */
export function toCalendarChannel(value: string | null | undefined): CalendarChannel {
  if (value === "twitter") return "x";
  if (value === "web") return "blog";
  return CHANNEL_BY_ID.has(value as CalendarChannel) ? (value as CalendarChannel) : "instagram";
}

export const STATUS_LABEL: Record<CalendarStatus, string> = {
  draft: "Draft",
  review: "In review",
  approved: "Approved",
  scheduled: "Scheduled",
  publishing: "Posting",
  published: "Posted",
  failed: "Failed",
};

export const CALENDAR_STATUSES = Object.keys(STATUS_LABEL) as CalendarStatus[];

export function toCalendarStatus(value: string): CalendarStatus {
  switch (value) {
    case "pending":
      return "review";
    case "approved":
    case "scheduled":
    case "publishing":
    case "published":
      return value;
    case "failed":
    case "partial_failed":
      return "failed";
    default:
      return "draft";
  }
}

/** Posts that are on their way out, or already out: their day can't be changed here. */
export function isLocked(status: CalendarStatus): boolean {
  return status === "scheduled" || status === "publishing" || status === "published";
}

const KIND_FORMAT: Record<string, string> = {
  post: "Post",
  carousel: "Carousel",
  image: "Image",
  video: "Video",
  ad: "Ad",
  script: "Video script",
  blog: "Article",
  email: "Email",
  brief: "Notes",
  landing: "Web page",
};

/* ───────────────────────────── dates ───────────────────────────── */

const pad = (n: number) => String(n).padStart(2, "0");

export const fmtYMD = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const fmtHM = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export function isYMD(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

export function isHM(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function parseYMD(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);

/** Monday of the week `d` is in. */
export function startOfWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return addDays(x, -((x.getDay() + 6) % 7));
}

/** Six Monday-first weeks covering the month `anchor` is in. */
export function monthGrid(anchor: Date): Date[] {
  const start = startOfWeek(startOfMonth(anchor));
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function weekDays(anchor: Date): Date[] {
  const start = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** The instant a local day + time names, as an ISO string. */
export function localInstant(date: string, time: string): string {
  const [h, m] = (isHM(time) ? time : "09:00").split(":").map(Number);
  const d = parseYMD(date);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

/* ───────────────────────── stored row → entry ───────────────────────── */

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function entryFromContent(item: CalendarSourceItem): CalendarEntry {
  const meta = record(item.meta);
  const status = toCalendarStatus(item.status);
  const scheduled = item.scheduled_at ? new Date(item.scheduled_at) : null;
  const validScheduled = scheduled && !Number.isNaN(scheduled.getTime()) ? scheduled : null;

  let date: string;
  let time: string;
  if (validScheduled) {
    date = fmtYMD(validScheduled);
    time = fmtHM(validScheduled);
  } else if (isYMD(meta.calendar_date)) {
    date = meta.calendar_date;
    time = isHM(meta.calendar_time) ? meta.calendar_time : "09:00";
  } else {
    // A post that went out without a schedule sits on the day it was posted;
    // anything else sits on the day it was written, so an edit never moves it.
    const stamp = new Date(status === "published" ? item.updated_at : item.created_at);
    const fallback = Number.isNaN(stamp.getTime()) ? new Date() : stamp;
    date = fmtYMD(fallback);
    time = status === "published" ? fmtHM(fallback) : "09:00";
  }

  return {
    id: item.id,
    date,
    time,
    channel: toCalendarChannel(item.channel),
    format:
      typeof meta.format === "string" && meta.format.trim()
        ? meta.format.trim().slice(0, 40)
        : (KIND_FORMAT[item.kind] ?? "Post"),
    topic: typeof meta.pillar === "string" && meta.pillar.trim() ? meta.pillar.trim() : undefined,
    title: item.title?.trim() || "Untitled post",
    caption: item.body || undefined,
    hashtags: Array.isArray(item.hashtags) ? item.hashtags.filter(Boolean) : [],
    status,
    images: item.media_url ? [item.media_url] : [],
  };
}

/* ───────────────────────────── queries ───────────────────────────── */

export type CalendarFilter = {
  channel: CalendarChannel | "all";
  status: CalendarStatus | "all";
  query: string;
};

export const NO_FILTER: CalendarFilter = { channel: "all", status: "all", query: "" };

export function isFiltering(filter: CalendarFilter): boolean {
  return filter.channel !== "all" || filter.status !== "all" || filter.query.trim() !== "";
}

export function filterEntries(entries: CalendarEntry[], filter: CalendarFilter): CalendarEntry[] {
  const q = filter.query.trim().toLowerCase();
  return entries.filter((e) => {
    if (filter.channel !== "all" && e.channel !== filter.channel) return false;
    if (filter.status !== "all" && e.status !== filter.status) return false;
    if (!q) return true;
    return [e.title, e.caption ?? "", e.hashtags.join(" "), e.topic ?? ""]
      .join("\n")
      .toLowerCase()
      .includes(q);
  });
}

/** Entries on days from `from` to `to` (both inclusive, YYYY-MM-DD). */
export function entriesBetween(entries: CalendarEntry[], from: string, to: string) {
  return entries.filter((e) => e.date >= from && e.date <= to);
}

export function sortEntries(entries: CalendarEntry[]): CalendarEntry[] {
  return [...entries].sort(
    (a, b) =>
      `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`) || a.title.localeCompare(b.title),
  );
}

export function groupByDate(entries: CalendarEntry[]): Map<string, CalendarEntry[]> {
  const map = new Map<string, CalendarEntry[]>();
  for (const e of sortEntries(entries)) {
    const list = map.get(e.date);
    if (list) list.push(e);
    else map.set(e.date, [e]);
  }
  return map;
}
