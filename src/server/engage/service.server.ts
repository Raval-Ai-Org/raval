// service.server.ts — Engage, Phase 1: comments on the brand's own Instagram
// and Facebook posts, answered by a person.
//
// Reads for the inbox use the caller's own RLS client. Everything that holds
// a token or writes runs with the service role, for a workspace id the RPC
// has already verified, and every row is matched on that id. Mellox never
// sends a reply by itself: `sendReply` runs only from a person's click.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { decryptWithKeys, encryptWithKey } from "@/server/crypto/secret-box.server";
import { recordAudit } from "@/server/audit.server";
import { HttpError } from "@/server/http-error";
import type {
  EngageComment,
  EngageHome,
  EngagePlatform,
  EngageStatus,
  EngageSyncResult,
} from "@/lib/engage/contracts";
import { sendableReply } from "@/lib/engage/reply";
import {
  COMMENTS_PER_POST,
  POSTS_PER_SYNC,
  fbCommentRows,
  igCommentRows,
  type CommentRow,
  type FbComment,
  type FbPost,
  type IgComment,
  type IgMedia,
} from "@/lib/engage/sync";
import { metaConfig, metaConfigured } from "./meta/config.server";
import {
  GraphError,
  exchangeMetaCode,
  graphGet,
  graphPost,
  type GraphList,
} from "./meta/graph.server";
import { consumeMetaState } from "./meta/oauth.server";

const db = supabaseAdmin as unknown as SupabaseClient;

type PageRow = {
  id: string;
  workspace_id: string;
  page_id: string;
  page_name: string;
  ig_user_id: string | null;
  ig_username: string | null;
  synced_at: string | null;
  last_error: string | null;
};

type CommentDbRow = {
  id: string;
  page_row_id: string;
  platform: EngagePlatform;
  external_id: string;
  author_name: string | null;
  body: string;
  commented_at: string;
  post_caption: string | null;
  post_permalink: string | null;
  status: EngageStatus;
  draft: string | null;
  reply_text: string | null;
  replied_at: string | null;
  last_error: string | null;
};

const COMMENT_COLUMNS =
  "id,page_row_id,platform,external_id,author_name,body,commented_at,post_caption,post_permalink,status,draft,reply_text,replied_at,last_error";

async function activeConnection(workspaceId: string) {
  const { data } = await db
    .from("workspace_connections")
    .select("id,status,account_login,last_error")
    .eq("workspace_id", workspaceId)
    .eq("provider", "meta")
    .neq("status", "revoked")
    .maybeSingle();
  return data as {
    id: string;
    status: string;
    account_login: string;
    last_error: string | null;
  } | null;
}

// ── Inbox ─────────────────────────────────────────────────────────────────

export async function getEngageHome(
  client: SupabaseClient,
  workspaceId: string,
): Promise<EngageHome> {
  const [conn, pages, comments, replied] = await Promise.all([
    client
      .from("workspace_connections")
      .select("status,account_login,last_error")
      .eq("workspace_id", workspaceId)
      .eq("provider", "meta")
      .neq("status", "revoked")
      .maybeSingle(),
    client
      .from("meta_pages")
      .select("id,workspace_id,page_id,page_name,ig_user_id,ig_username,synced_at,last_error")
      .eq("workspace_id", workspaceId)
      .order("page_name"),
    client
      .from("engage_comments")
      .select(COMMENT_COLUMNS)
      .eq("workspace_id", workspaceId)
      .in("status", ["new", "drafted", "sending", "unknown", "replied"])
      .order("commented_at", { ascending: false })
      .limit(100),
    client
      .from("engage_comments")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("status", "replied"),
  ]);
  const pageRows = (pages.data ?? []) as PageRow[];
  const byId = new Map(pageRows.map((p) => [p.id, p]));
  const rows = (comments.data ?? []) as CommentDbRow[];
  const view: EngageComment[] = rows.map((c) => {
    const page = byId.get(c.page_row_id);
    return {
      id: c.id,
      platform: c.platform,
      pageName: page?.page_name ?? "",
      igUsername: page?.ig_username ?? null,
      authorName: c.author_name,
      body: c.body,
      commentedAt: c.commented_at,
      postCaption: c.post_caption,
      postPermalink: c.post_permalink,
      status: c.status,
      draft: c.draft,
      replyText: c.reply_text,
      repliedAt: c.replied_at,
      lastError: c.last_error,
    };
  });
  const c = conn.data as {
    status: string;
    account_login: string;
    last_error: string | null;
  } | null;
  return {
    configured: metaConfigured(),
    connection: c
      ? {
          status:
            c.status === "active" ? "active" : c.status === "suspended" ? "suspended" : "error",
          accountName: c.account_login,
          lastError: c.last_error,
        }
      : null,
    pages: pageRows.map((p) => ({
      id: p.id,
      pageName: p.page_name,
      igUsername: p.ig_username,
      hasInstagram: !!p.ig_user_id,
      syncedAt: p.synced_at,
      lastError: p.last_error,
    })),
    comments: view,
    counts: {
      waiting: view.filter((v) => v.status !== "replied").length,
      replied: replied.count ?? 0,
    },
  };
}

// ── Connect ───────────────────────────────────────────────────────────────

type MetaAccount = {
  id: string;
  name?: string;
  access_token?: string;
  instagram_business_account?: { id: string; username?: string };
};

export async function completeMetaOAuth(args: { state: string; code: string }) {
  const txn = await consumeMetaState(args.state);
  const { data: member } = await db
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", txn.workspaceId)
    .eq("user_id", txn.userId)
    .maybeSingle();
  if (!member || !["owner", "admin", "editor"].includes(member.role))
    throw new HttpError(403, "Workspace access changed. Start again.");

  const config = metaConfig();
  const { token, expiresAt } = await exchangeMetaCode(args.code);
  const [me, accounts, perms] = await Promise.all([
    graphGet<{ id: string; name?: string }>("me", token, { fields: "id,name" }),
    graphGet<GraphList<MetaAccount>>("me/accounts", token, {
      fields: "id,name,access_token,instagram_business_account{id,username}",
      limit: "50",
    }),
    graphGet<GraphList<{ permission: string; status: string }>>("me/permissions", token).catch(
      () => ({ data: [] }),
    ),
  ]);
  const pages = (accounts.data ?? []).filter(
    (p) => /^[0-9]{1,32}$/.test(p.id) && typeof p.access_token === "string",
  );
  const scopes = (perms.data ?? []).filter((p) => p.status === "granted").map((p) => p.permission);

  const old = await activeConnection(txn.workspaceId);
  const values = {
    workspace_id: txn.workspaceId,
    provider: "meta",
    status: pages.length ? "active" : "error",
    external_account_id: me.id,
    account_login: (me.name ?? "Meta account").slice(0, 200),
    verification: "oauth",
    connected_by: txn.userId,
    revoked_at: null,
    last_error: pages.length
      ? null
      : "No Facebook Page was shared. Connect again and choose your Page.",
    permissions: { scopes },
    updated_at: new Date().toISOString(),
  };
  let connectionId = old?.id;
  if (connectionId) {
    const { error } = await db
      .from("workspace_connections")
      .update(values)
      .eq("id", connectionId)
      .eq("workspace_id", txn.workspaceId);
    if (error) throw new HttpError(500, "Could not save the Meta connection.");
  } else {
    const { data, error } = await db
      .from("workspace_connections")
      .upsert(values, { onConflict: "workspace_id,provider,external_account_id" })
      .select("id")
      .single();
    if (error || !data) throw new HttpError(500, "Could not save the Meta connection.");
    connectionId = data.id as string;
  }
  const { error: credError } = await db.from("meta_oauth_credentials").upsert(
    {
      connection_id: connectionId,
      workspace_id: txn.workspaceId,
      user_token_enc: encryptWithKey(token, config.key),
      user_token_expires_at: expiresAt,
      scopes,
    },
    { onConflict: "connection_id" },
  );
  if (credError) throw new HttpError(500, "Could not save the Meta connection.");

  // The Pages shared this time replace the earlier list.
  const keep: string[] = [];
  for (const p of pages) {
    const ig = p.instagram_business_account;
    const { data: row, error } = await db
      .from("meta_pages")
      .upsert(
        {
          workspace_id: txn.workspaceId,
          connection_id: connectionId,
          page_id: p.id,
          page_name: (p.name ?? "Facebook Page").slice(0, 200),
          ig_user_id: ig && /^[0-9]{1,32}$/.test(ig.id) ? ig.id : null,
          ig_username: ig?.username?.slice(0, 100) ?? null,
          last_error: null,
        },
        { onConflict: "workspace_id,page_id" },
      )
      .select("id")
      .single();
    if (error || !row) continue;
    keep.push(row.id as string);
    await db.from("meta_page_tokens").upsert(
      {
        page_row_id: row.id,
        workspace_id: txn.workspaceId,
        page_token_enc: encryptWithKey(p.access_token!, config.key),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "page_row_id" },
    );
  }
  const stale = db.from("meta_pages").delete().eq("workspace_id", txn.workspaceId);
  await (keep.length ? stale.not("id", "in", `(${keep.join(",")})`) : stale);

  await recordAudit({
    workspaceId: txn.workspaceId,
    userId: txn.userId,
    action: "engage.meta.connected",
    entity: `workspace_connections:${connectionId}`,
    payload: { pages: keep.length, scopes },
  });
  return { workspaceId: txn.workspaceId, pages: keep.length };
}

export async function disconnectMeta(workspaceId: string, userId: string): Promise<void> {
  const conn = await activeConnection(workspaceId);
  if (!conn) return;
  await db.from("meta_pages").delete().eq("workspace_id", workspaceId);
  await db.from("meta_oauth_credentials").delete().eq("connection_id", conn.id);
  await db
    .from("workspace_connections")
    .update({
      status: "revoked",
      revoked_at: new Date().toISOString(),
      revoked_reason: "disconnected",
    })
    .eq("id", conn.id)
    .eq("workspace_id", workspaceId);
  await recordAudit({
    workspaceId,
    userId,
    action: "engage.meta.disconnected",
    entity: `workspace_connections:${conn.id}`,
  });
}

// ── Tokens ────────────────────────────────────────────────────────────────

async function pageToken(workspaceId: string, pageRowId: string): Promise<string> {
  const { data } = await db
    .from("meta_page_tokens")
    .select("page_token_enc")
    .eq("workspace_id", workspaceId)
    .eq("page_row_id", pageRowId)
    .maybeSingle();
  if (!data) throw new HttpError(409, "Connect Instagram and Facebook again.");
  return decryptWithKeys(
    (data as { page_token_enc: string }).page_token_enc,
    metaConfig().readKeys,
  );
}

async function markTokenProblem(workspaceId: string, error: GraphError) {
  if (error.kind !== "token") return;
  await db
    .from("workspace_connections")
    .update({ status: "error", last_error: error.message })
    .eq("workspace_id", workspaceId)
    .eq("provider", "meta")
    .neq("status", "revoked");
}

// ── Sync ──────────────────────────────────────────────────────────────────

async function readPage(page: PageRow, token: string): Promise<CommentRow[]> {
  const rows: CommentRow[] = [];
  if (page.ig_user_id) {
    const media = await graphGet<GraphList<IgMedia>>(`${page.ig_user_id}/media`, token, {
      fields: "id,caption,permalink,timestamp",
      limit: String(POSTS_PER_SYNC),
    });
    for (const m of media.data ?? []) {
      if (!/^[0-9]{1,40}$/.test(m.id)) continue;
      const comments = await graphGet<GraphList<IgComment>>(`${m.id}/comments`, token, {
        fields: "id,text,timestamp,username,from{id,username},replies{id,username,from{id}}",
        limit: String(COMMENTS_PER_POST),
      });
      rows.push(
        ...igCommentRows(m, comments.data ?? [], {
          igUserId: page.ig_user_id,
          igUsername: page.ig_username,
        }),
      );
    }
  }
  const posts = await graphGet<GraphList<FbPost>>(`${page.page_id}/posts`, token, {
    fields: "id,message,permalink_url,created_time",
    limit: String(POSTS_PER_SYNC),
  });
  for (const p of posts.data ?? []) {
    if (!/^[0-9_]{1,80}$/.test(p.id)) continue;
    const comments = await graphGet<GraphList<FbComment>>(`${p.id}/comments`, token, {
      fields: "id,message,created_time,from{id,name},comments.limit(10){id,from{id}}",
      filter: "toplevel",
      order: "reverse_chronological",
      limit: String(COMMENTS_PER_POST),
    });
    rows.push(...fbCommentRows(p, comments.data ?? [], { pageId: page.page_id }));
  }
  return rows;
}

/** Read new comments for every Page. A comment already stored is left as it is. */
export async function syncEngage(workspaceId: string): Promise<EngageSyncResult> {
  const conn = await activeConnection(workspaceId);
  if (!conn) throw new HttpError(409, "Connect Instagram and Facebook first.");
  const { data } = await db
    .from("meta_pages")
    .select("id,workspace_id,page_id,page_name,ig_user_id,ig_username,synced_at,last_error")
    .eq("workspace_id", workspaceId);
  const pages = (data ?? []) as PageRow[];
  let added = 0;
  let errors = 0;
  for (const page of pages) {
    try {
      const rows = await readPage(page, await pageToken(workspaceId, page.id));
      if (rows.length) {
        const { data: inserted } = await db
          .from("engage_comments")
          .upsert(
            rows.map((r) => ({ ...r, workspace_id: workspaceId, page_row_id: page.id })),
            { onConflict: "workspace_id,platform,external_id", ignoreDuplicates: true },
          )
          .select("id");
        added += inserted?.length ?? 0;
      }
      await db
        .from("meta_pages")
        .update({ synced_at: new Date().toISOString(), last_error: null })
        .eq("id", page.id)
        .eq("workspace_id", workspaceId);
    } catch (error) {
      errors++;
      const message =
        error instanceof Error ? error.message.slice(0, 300) : "Couldn't read comments.";
      if (error instanceof GraphError) await markTokenProblem(workspaceId, error);
      await db
        .from("meta_pages")
        .update({ last_error: message })
        .eq("id", page.id)
        .eq("workspace_id", workspaceId);
    }
  }
  if (!errors && conn.status === "error" && pages.length)
    await db
      .from("workspace_connections")
      .update({ status: "active", last_error: null })
      .eq("id", conn.id);
  return { pages: pages.length, added, errors };
}

// ── One comment ───────────────────────────────────────────────────────────

export async function commentFor(workspaceId: string, commentId: string) {
  const { data } = await db
    .from("engage_comments")
    .select(`${COMMENT_COLUMNS},workspace_id`)
    .eq("workspace_id", workspaceId)
    .eq("id", commentId)
    .maybeSingle();
  if (!data) throw new HttpError(404, "That comment isn't here any more.");
  const row = data as CommentDbRow;
  const { data: page } = await db
    .from("meta_pages")
    .select("id,workspace_id,page_id,page_name,ig_user_id,ig_username,synced_at,last_error")
    .eq("workspace_id", workspaceId)
    .eq("id", row.page_row_id)
    .maybeSingle();
  if (!page) throw new HttpError(409, "Connect Instagram and Facebook again.");
  return { comment: row, page: page as PageRow };
}

export async function saveEngageDraft(workspaceId: string, commentId: string, draft: string) {
  const { error } = await db
    .from("engage_comments")
    .update({
      draft: draft.slice(0, 8_000),
      drafted_at: new Date().toISOString(),
      status: "drafted",
      last_error: null,
    })
    .eq("workspace_id", workspaceId)
    .eq("id", commentId)
    .in("status", ["new", "drafted"]);
  if (error) throw new HttpError(500, "Couldn't save the draft.");
}

export async function dismissEngageComment(workspaceId: string, commentId: string) {
  await db
    .from("engage_comments")
    .update({ status: "dismissed" })
    .eq("workspace_id", workspaceId)
    .eq("id", commentId)
    .in("status", ["new", "drafted", "unknown"]);
}

/** Does the brand already have a reply under this comment with these words? */
async function findOwnReply(page: PageRow, comment: CommentDbRow, token: string, text: string) {
  const norm = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
  if (comment.platform === "instagram") {
    const replies = await graphGet<GraphList<{ id: string; text?: string; username?: string }>>(
      `${comment.external_id}/replies`,
      token,
      { fields: "id,text,username", limit: "50" },
    );
    return (replies.data ?? []).find(
      (r) =>
        norm(r.text) === norm(text) &&
        (!page.ig_username || r.username?.toLowerCase() === page.ig_username.toLowerCase()),
    );
  }
  const replies = await graphGet<
    GraphList<{ id: string; message?: string; from?: { id?: string } }>
  >(`${comment.external_id}/comments`, token, { fields: "id,message,from{id}", limit: "50" });
  return (replies.data ?? []).find(
    (r) => norm(r.message) === norm(text) && r.from?.id === page.page_id,
  );
}

/**
 * Send a reply a person pressed Send on. `new|drafted|unknown → sending` is a
 * compare-and-set, so a double click sends once. An unclear outcome is kept
 * as `unknown`; the next press first looks for the reply before sending again.
 */
export async function sendEngageReply(args: {
  workspaceId: string;
  commentId: string;
  text: string;
  userId: string;
  brandDomain: string | null;
}): Promise<{ status: EngageStatus }> {
  const { comment, page } = await commentFor(args.workspaceId, args.commentId);
  if (comment.status === "replied") return { status: "replied" };
  if (comment.status === "dismissed") throw new HttpError(409, "This comment was dismissed.");
  const ok = sendableReply(args.text, comment.platform, args.brandDomain);
  if (!ok.ok) throw new HttpError(400, ok.reason);
  if (comment.platform === "instagram" && !page.ig_user_id)
    throw new HttpError(409, "This Page has no Instagram account linked any more.");

  const { data: claimed } = await db
    .from("engage_comments")
    .update({ status: "sending", last_error: null })
    .eq("workspace_id", args.workspaceId)
    .eq("id", comment.id)
    .eq("status", comment.status)
    .select("id");
  if (!claimed?.length) throw new HttpError(409, "This reply is already being sent.");

  const token = await pageToken(args.workspaceId, page.id);
  const done = async (replyId: string) => {
    await db
      .from("engage_comments")
      .update({
        status: "replied",
        reply_text: ok.text,
        reply_external_id: replyId,
        replied_at: new Date().toISOString(),
        replied_by: args.userId,
        last_error: null,
      })
      .eq("workspace_id", args.workspaceId)
      .eq("id", comment.id);
    await recordAudit({
      workspaceId: args.workspaceId,
      userId: args.userId,
      action: "engage.reply.sent",
      entity: `engage_comments:${comment.id}`,
      payload: { platform: comment.platform, reply_id: replyId },
    });
    return { status: "replied" as const };
  };

  try {
    if (comment.status === "unknown") {
      const found = await findOwnReply(page, comment, token, ok.text);
      if (found) return await done(found.id);
    }
    const path =
      comment.platform === "instagram"
        ? `${comment.external_id}/replies`
        : `${comment.external_id}/comments`;
    const res = await graphPost<{ id?: string }>(path, token, { message: ok.text });
    return await done(typeof res.id === "string" ? res.id.slice(0, 100) : "");
  } catch (error) {
    const unknown = error instanceof GraphError && error.kind === "unknown";
    if (error instanceof GraphError) await markTokenProblem(args.workspaceId, error);
    const message =
      error instanceof Error ? error.message.slice(0, 300) : "Couldn't send the reply.";
    await db
      .from("engage_comments")
      .update({
        status: unknown
          ? "unknown"
          : comment.status === "unknown"
            ? "unknown"
            : comment.draft
              ? "drafted"
              : "new",
        last_error: unknown
          ? "Meta didn't confirm this reply. Press Send again: Mellox checks first, so it won't post twice."
          : message,
      })
      .eq("workspace_id", args.workspaceId)
      .eq("id", comment.id);
    if (unknown) return { status: "unknown" };
    throw new HttpError(error instanceof GraphError && error.kind === "limit" ? 429 : 502, message);
  }
}
