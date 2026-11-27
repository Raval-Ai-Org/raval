// sync.ts — turns what the Graph API returns into comment rows. Pure.
//
// Only top-level comments by other people are kept: the brand's own comments
// and comments the brand already answered (on Meta or here) are skipped, so
// the inbox only holds what is waiting for a reply.
import type { EngagePlatform } from "./contracts";

export type GraphFrom = { id?: string; name?: string; username?: string } | undefined;

export type IgMedia = {
  id: string;
  caption?: string;
  permalink?: string;
  timestamp?: string;
  comments_count?: number;
};
export type IgComment = {
  id: string;
  text?: string;
  timestamp?: string;
  username?: string;
  from?: GraphFrom;
  replies?: { data?: { id: string; username?: string; from?: GraphFrom }[] };
};

export type FbPost = {
  id: string;
  message?: string;
  permalink_url?: string;
  created_time?: string;
  comments?: { summary?: { total_count?: number } };
};

/**
 * Whether a post's comments are worth a read. Only a count Meta stated as
 * zero skips it; a missing count is read anyway.
 */
export function hasComments(count: unknown): boolean {
  return !(typeof count === "number" && count === 0);
}
export type FbComment = {
  id: string;
  message?: string;
  created_time?: string;
  from?: GraphFrom;
  comments?: { data?: { id: string; from?: GraphFrom }[] };
};

export type CommentRow = {
  platform: EngagePlatform;
  external_id: string;
  post_id: string;
  post_caption: string | null;
  post_permalink: string | null;
  author_name: string | null;
  body: string;
  commented_at: string;
};

/** How far back a sync looks. Older comments rarely want an answer now. */
export const SYNC_WINDOW_DAYS = 30;
export const POSTS_PER_SYNC = 15;
export const COMMENTS_PER_POST = 50;

const ID_RE = /^[0-9_]{1,80}$/;

function iso(value: string | undefined): string | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function https(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

const clip = (s: string | undefined, max: number) => (s ?? "").trim().slice(0, max);

function recent(at: string, now: number): boolean {
  return now - Date.parse(at) <= SYNC_WINDOW_DAYS * 86_400_000;
}

export function igCommentRows(
  media: IgMedia,
  comments: readonly IgComment[],
  own: { igUserId: string; igUsername: string | null },
  now = Date.now(),
): CommentRow[] {
  if (!ID_RE.test(media.id)) return [];
  const mine = (f: GraphFrom, username?: string) =>
    f?.id === own.igUserId ||
    (!!own.igUsername && (username ?? f?.username)?.toLowerCase() === own.igUsername.toLowerCase());
  const rows: CommentRow[] = [];
  for (const c of comments) {
    const at = iso(c.timestamp);
    const body = clip(c.text, 8_000);
    if (!ID_RE.test(c.id) || !at || !body || !recent(at, now)) continue;
    if (mine(c.from, c.username)) continue;
    if ((c.replies?.data ?? []).some((r) => mine(r.from, r.username))) continue;
    rows.push({
      platform: "instagram",
      external_id: c.id,
      post_id: media.id,
      post_caption: clip(media.caption, 2_200) || null,
      post_permalink: https(media.permalink),
      author_name: clip(c.username ?? c.from?.username, 200) || null,
      body,
      commented_at: at,
    });
  }
  return rows;
}

export function fbCommentRows(
  post: FbPost,
  comments: readonly FbComment[],
  own: { pageId: string },
  now = Date.now(),
): CommentRow[] {
  if (!ID_RE.test(post.id)) return [];
  const rows: CommentRow[] = [];
  for (const c of comments) {
    const at = iso(c.created_time);
    const body = clip(c.message, 8_000);
    if (!ID_RE.test(c.id) || !at || !body || !recent(at, now)) continue;
    if (c.from?.id === own.pageId) continue;
    if ((c.comments?.data ?? []).some((r) => r.from?.id === own.pageId)) continue;
    rows.push({
      platform: "facebook",
      external_id: c.id,
      post_id: post.id,
      post_caption: clip(post.message, 2_200) || null,
      post_permalink: https(post.permalink_url),
      author_name: clip(c.from?.name, 200) || null,
      body,
      commented_at: at,
    });
  }
  return rows;
}

// ── DMs ──────────────────────────────────────────────────────────────────

/** Meta lets a business answer a DM within 24 hours of the person's last message. */
export const DM_WINDOW_MS = 24 * 60 * 60_000;
export const CONVERSATIONS_PER_SYNC = 25;
export const MESSAGES_PER_CONVERSATION = 10;

export type GraphMessage = {
  id: string;
  message?: string;
  created_time?: string;
  from?: GraphFrom;
};
export type GraphConversation = {
  id: string;
  updated_time?: string;
  messages?: { data?: GraphMessage[] };
};

export type DmRow = CommentRow & { kind: "dm"; sender_id: string };

/** What a conversation means for the Inbox, newest message first as Meta sends it. */
export type DmRead =
  /** The person wrote last: one row to answer (every message since the brand's last one). */
  | { kind: "waiting"; row: DmRow }
  /** The brand answered last (maybe in Meta's own app): open rows are done. */
  | { kind: "answered"; conversationId: string; text: string; at: string | null }
  /** Nothing to do: empty, too old to answer, or unreadable. */
  | { kind: "none" };

const DM_ID_RE = /^[A-Za-z0-9_=:.+/-]{1,300}$/;
const SENDER_RE = /^[0-9]{1,40}$/;

export function dmWindowOpen(at: string, now = Date.now()): boolean {
  const t = Date.parse(at);
  return Number.isFinite(t) && now - t <= DM_WINDOW_MS;
}

export function readConversation(
  platform: EngagePlatform,
  conv: GraphConversation,
  ownIds: readonly string[],
  now = Date.now(),
): DmRead {
  if (!DM_ID_RE.test(conv.id)) return { kind: "none" };
  const msgs = (conv.messages?.data ?? []).filter(
    (m) => DM_ID_RE.test(m.id) && iso(m.created_time),
  );
  if (!msgs.length) return { kind: "none" };
  const isOwn = (m: GraphMessage) => !!m.from?.id && ownIds.includes(m.from.id);
  if (isOwn(msgs[0]))
    return {
      kind: "answered",
      conversationId: conv.id,
      text: clip(msgs[0].message, 8_000),
      at: iso(msgs[0].created_time),
    };
  const theirs: GraphMessage[] = [];
  for (const m of msgs) {
    if (isOwn(m)) break;
    theirs.push(m);
  }
  const newest = theirs[0];
  const sender = newest.from?.id ?? "";
  const at = iso(newest.created_time)!;
  if (!SENDER_RE.test(sender) || !dmWindowOpen(at, now)) return { kind: "none" };
  const body = theirs
    .filter((m) => m.from?.id === sender)
    .reverse()
    .map((m) => clip(m.message, 2_000) || "[sent a photo, voice note or attachment]")
    .join("\n")
    .slice(0, 8_000);
  return {
    kind: "waiting",
    row: {
      kind: "dm",
      platform,
      external_id: newest.id,
      post_id: conv.id,
      post_caption: null,
      post_permalink: null,
      author_name: clip(newest.from?.name ?? newest.from?.username, 200) || null,
      sender_id: sender,
      body,
      commented_at: at,
    },
  };
}
