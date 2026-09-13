// Studio content rows grouped the way people think about them: one piece of
// work, however many platform versions it has. Shared by the Studio rail
// (Needs Approval) and the Library.
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
};

export const CONTENT_COLUMNS =
  "id, title, body, kind, channel, status, meta, created_at, updated_at, scheduled_at";

/** How far along a piece of content is; lower means it still needs someone. */
const PROGRESS: Record<string, number> = {
  draft: 0,
  pending: 0,
  failed: 0,
  approved: 1,
  scheduled: 2,
  partial_failed: 3,
  publishing: 3,
  published: 4,
};

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

export function groupRows(rows: ContentRow[]): Group[] {
  const map = new Map<string, Group>();
  for (const r of rows) {
    const meta = r.meta ?? {};
    const state = meta.studio_state;
    if (state === "generating" || state === "failed") continue;
    const key = typeof meta.group_id === "string" ? meta.group_id : r.id;
    const platform =
      typeof meta.platform === "string" && meta.platform in PLATFORMS
        ? (meta.platform as PlatformId)
        : null;
    const existing = map.get(key);
    if (existing) {
      existing.ids.push(r.id);
      if (platform && !existing.platforms.includes(platform)) existing.platforms.push(platform);
      if ((PROGRESS[r.status] ?? 0) < (PROGRESS[existing.status] ?? 0)) existing.status = r.status;
      continue;
    }
    const type = studioTypeFromContent(r.kind, meta);
    map.set(key, {
      key,
      ids: [r.id],
      type,
      legacyLabel: type === "legacy" ? LEGACY_KINDS[r.kind] : undefined,
      title: cleanText(r.title) || cleanText(r.body).slice(0, 80) || "Untitled",
      excerpt: cleanText(r.body).slice(0, 140),
      platforms: platform ? [platform] : [],
      storagePath: typeof meta.asset_storage_path === "string" ? meta.asset_storage_path : null,
      mediaType: meta.media_type === "video" ? "video" : meta.asset_storage_path ? "image" : null,
      createdAt: r.created_at,
      jobId: typeof meta.job_id === "string" ? meta.job_id : null,
      status: r.status,
    });
  }
  return [...map.values()];
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
  partial_failed: { label: "Partly published", tone: "danger" },
  failed: { label: "Failed", tone: "danger" },
};
