// Content rows grouped the way people think about them: one piece of work,
// however many platform versions it has, in the stage it's actually in.
// Shared by the Studio rail (Content pipeline) and the Library. Pure.
import { PLATFORMS, type PlatformId } from "@/lib/social-platforms";
import { LEGACY_KINDS, studioTypeFromContent, type StudioType } from "./formats";

export type ContentRow = {
  id: string;
  title: string | null;
  body: string | null;
  kind: string;
  channel: string | null;
  status: string;
  meta: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  scheduled_at: string | null;
};

/** Where a piece of work is on its way to being published. */
export type Stage = "review" | "ready" | "scheduled" | "published";

/** What created it, so non-Studio drafts are recognisable. */
export type ContentSource = "studio" | "chat" | "agent" | "calendar" | "other";

export type Group = {
  key: string;
  ids: string[];
  type: StudioType | "legacy";
  legacyLabel?: string;
  title: string;
  excerpt: string;
  platforms: PlatformId[];
  storagePath: string | null;
  mediaType: "image" | "video" | null;
  createdAt: string;
  jobId: string | null;
  /** The least-advanced status across the group's versions. */
  status: string;
  stage: Stage;
  source: ContentSource;
  /** Earliest scheduled time across versions. */
  scheduledAt: string | null;
  /** A publish attempt failed; it needs attention. */
  problem: boolean;
  /** Studio job currently turning this text draft into a finished post. */
  convertingJobId: string | null;
};

export const CONTENT_COLUMNS =
  "id, title, body, kind, channel, status, meta, created_at, updated_at, scheduled_at";

/** Statuses that are still on their way out: not published and not discarded. */
export const PIPELINE_STATUSES = [
  "draft",
  "pending",
  "failed",
  "approved",
  "scheduled",
  "partial_failed",
] as const;

/** How far along a piece of content is; lower means it still needs someone. */
const PROGRESS: Record<string, number> = {
  draft: 0,
  pending: 0,
  failed: 0,
  partial_failed: 0,
  approved: 1,
  scheduled: 2,
  publishing: 3,
  published: 4,
};

export const STAGE_LABEL: Record<Stage, string> = {
  review: "To review",
  ready: "Ready",
  scheduled: "Scheduled",
  published: "Published",
};

export const SOURCE_LABEL: Record<ContentSource, string> = {
  studio: "Studio",
  chat: "From chat",
  agent: "From an agent",
  calendar: "From the calendar",
  other: "Draft",
};

export function stageOf(status: string): Stage {
  switch (status) {
    case "approved":
      return "ready";
    case "scheduled":
      return "scheduled";
    case "publishing":
    case "published":
      return "published";
    default:
      return "review";
  }
}

export function sourceOf(meta: Record<string, unknown> | null): ContentSource {
  const source = typeof meta?.source === "string" ? meta.source : "";
  if (source === "studio" || typeof meta?.job_id === "string") return "studio";
  if (source === "chat") return "chat";
  if (source === "agent" || source === "next-post" || typeof meta?.prompt === "string")
    return "agent";
  if (source.startsWith("calendar")) return "calendar";
  return "other";
}

export function cleanText(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`#>]/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function ago(iso: string): string {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

const GENERIC_TITLE =
  /^(untitled( post| draft)?|draft|new post|(linkedin|instagram|x|twitter|x \/ twitter|facebook|threads|tiktok|youtube)( post)?)$/i;

/** Caption text without hashtags or markdown. */
function plain(value: string | null | undefined): string {
  return cleanText((value ?? "").replace(/(^|\s)#[\p{L}\p{N}_]+/gu, " "));
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

function firstSentence(body: string | null): string {
  const text = plain(body);
  if (!text) return "";
  const sentence = text.split(/(?<=[.!?])\s/)[0] ?? text;
  return clip(sentence, 80);
}

function excerptOf(body: string | null, title: string): string {
  const lines = (body ?? "")
    .split(/\n+/)
    .map((l) => plain(l))
    .filter(Boolean);
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
  const t = norm(title.replace(/…$/, ""));
  const line = lines.find((l) => {
    const n = norm(l);
    return n && !(t && (n === t || n.startsWith(t) || t.startsWith(n)));
  });
  return line ? clip(line, 110) : "";
}

/** A title candidate for one row, and how trustworthy it is. */
function titleOf(row: ContentRow): { text: string; rank: number } {
  const jobTitle = cleanText(typeof row.meta?.job_title === "string" ? row.meta.job_title : "");
  if (jobTitle) return { text: clip(jobTitle, 90), rank: 3 };
  const title = cleanText(row.title);
  if (title && !GENERIC_TITLE.test(title)) return { text: clip(title, 90), rank: 2 };
  const sentence = firstSentence(row.body);
  if (sentence) return { text: sentence, rank: 1 };
  return { text: "", rank: 0 };
}

/** Rows with nothing in them (e.g. an empty calendar placeholder) aren't work yet. */
function isEmpty(row: ContentRow): boolean {
  return (
    !plain(row.body) && titleOf(row).rank < 2 && typeof row.meta?.asset_storage_path !== "string"
  );
}

export function groupRows(rows: ContentRow[]): Group[] {
  const map = new Map<string, Group & { titleRank: number; bodies: string[] }>();
  for (const r of rows) {
    const meta = r.meta ?? {};
    const state = meta.studio_state;
    if (state === "generating" || state === "failed") continue;
    if (isEmpty(r)) continue;
    const key = typeof meta.group_id === "string" ? meta.group_id : r.id;
    const platform =
      typeof meta.platform === "string" && meta.platform in PLATFORMS
        ? (meta.platform as PlatformId)
        : null;
    const title = titleOf(r);
    const storagePath =
      typeof meta.asset_storage_path === "string" ? meta.asset_storage_path : null;
    const existing = map.get(key);
    if (existing) {
      existing.ids.push(r.id);
      if (platform && !existing.platforms.includes(platform)) existing.platforms.push(platform);
      if ((PROGRESS[r.status] ?? 0) < (PROGRESS[existing.status] ?? 0)) existing.status = r.status;
      if (r.status === "failed" || r.status === "partial_failed") existing.problem = true;
      if (title.rank > existing.titleRank) {
        existing.title = title.text;
        existing.titleRank = title.rank;
      }
      if (r.body) existing.bodies.push(r.body);
      if (!existing.storagePath && storagePath) {
        existing.storagePath = storagePath;
        existing.mediaType = meta.media_type === "video" ? "video" : "image";
      }
      if (r.scheduled_at && (!existing.scheduledAt || r.scheduled_at < existing.scheduledAt))
        existing.scheduledAt = r.scheduled_at;
      continue;
    }
    const type = studioTypeFromContent(r.kind, meta);
    map.set(key, {
      key,
      ids: [r.id],
      type,
      legacyLabel: type === "legacy" ? LEGACY_KINDS[r.kind] : undefined,
      title: title.text,
      titleRank: title.rank,
      bodies: r.body ? [r.body] : [],
      excerpt: "",
      platforms: platform ? [platform] : [],
      storagePath,
      mediaType: meta.media_type === "video" ? "video" : storagePath ? "image" : null,
      createdAt: r.created_at,
      jobId: typeof meta.job_id === "string" ? meta.job_id : null,
      status: r.status,
      stage: "review",
      source: sourceOf(meta),
      scheduledAt: r.scheduled_at,
      problem: r.status === "failed" || r.status === "partial_failed",
      convertingJobId: typeof meta.converting_job === "string" ? meta.converting_job : null,
    });
  }
  return [...map.values()].map(({ titleRank: _rank, bodies, ...g }) => {
    const title = g.title || (g.type === "legacy" ? (g.legacyLabel ?? "Untitled") : "Untitled");
    return {
      ...g,
      title,
      excerpt: bodies.map((b) => excerptOf(b, title)).find(Boolean) ?? "",
      stage: stageOf(g.status),
    };
  });
}

/** How many pieces of work are in each stage. */
export function stageCounts(groups: Group[]): Record<Stage, number> {
  const counts: Record<Stage, number> = { review: 0, ready: 0, scheduled: 0, published: 0 };
  for (const g of groups) counts[g.stage] += 1;
  return counts;
}

export const STATUS_BADGE: Record<
  string,
  { label: string; tone: "warn" | "ok" | "muted" | "danger" }
> = {
  draft: { label: "Needs approval", tone: "warn" },
  pending: { label: "Needs approval", tone: "warn" },
  approved: { label: "Ready to post", tone: "ok" },
  scheduled: { label: "Scheduled", tone: "ok" },
  publishing: { label: "Publishing", tone: "ok" },
  published: { label: "Published", tone: "muted" },
  partial_failed: { label: "Didn't fully publish", tone: "danger" },
  failed: { label: "Didn't publish", tone: "danger" },
};
