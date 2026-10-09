// What a client share keeps about a post, and when a client's approval may
// approve it. Pure and browser-safe; used by src/app/api/shares and the public
// share route.
import { isWorkspaceStoragePath } from "@/lib/workspace/storage-path";

const MAX_MEDIA = 12;

/**
 * Stored pictures and video of a post, from its (user-editable) meta. Only
 * paths inside the post's own workspace are kept.
 */
export function assetPathsFromMeta(meta: unknown, workspaceId: string): string[] {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return [];
  const m = meta as Record<string, unknown>;
  const many = Array.isArray(m.asset_storage_paths) ? m.asset_storage_paths : [];
  const candidates = many.length ? many : [m.asset_storage_path];
  const out: string[] = [];
  for (const path of candidates) {
    if (isWorkspaceStoragePath(path, workspaceId) && !out.includes(path as string)) {
      out.push(path as string);
    }
    if (out.length >= MAX_MEDIA) break;
  }
  return out;
}

export function mediaKind(path: string): "image" | "video" {
  return /\.(mp4|webm|mov)(\?|$)/i.test(path) ? "video" : "image";
}

export type ShareContentRow = {
  id: string;
  body: string | null;
  channel: string | null;
  kind: string | null;
  scheduled_at: string | null;
  hashtags: string[] | null;
  media_url: string | null;
  meta: unknown;
};

/** The snapshot a share stores for a post: built on the server from the row itself. */
export function contentSnapshot(row: ShareContentRow, workspaceId: string) {
  return {
    body: row.body ?? "",
    channel: row.channel,
    kind: row.kind,
    scheduled_at: row.scheduled_at,
    hashtags: Array.isArray(row.hashtags) ? row.hashtags.slice(0, 30) : [],
    media_url:
      typeof row.media_url === "string" && /^https:\/\//.test(row.media_url) ? row.media_url : null,
    asset_paths: assetPathsFromMeta(row.meta, workspaceId),
  };
}

export type ApprovalVerdict =
  /** The post becomes approved. */
  | "approve"
  /** Nothing to change: it is already approved or further along. */
  | "already"
  /** The words changed after the client saw them. */
  | "changed"
  /** The post was deleted. */
  | "missing";

const ALREADY = new Set(["approved", "scheduled", "publishing", "published", "partial_failed"]);

/**
 * A client approved what they were shown. That only approves the post when it
 * still says the same thing, and never moves a post backwards.
 */
export function approvalVerdict(
  current: { status: string; body: string | null } | null,
  snapshot: unknown,
): ApprovalVerdict {
  if (!current) return "missing";
  if (ALREADY.has(current.status)) return "already";
  const shown =
    snapshot && typeof snapshot === "object" ? (snapshot as { body?: unknown }).body : undefined;
  if (typeof shown === "string" && normalize(shown) !== normalize(current.body ?? "")) {
    return "changed";
  }
  return "approve";
}

const normalize = (text: string) => text.replace(/\r\n/g, "\n").trim();
