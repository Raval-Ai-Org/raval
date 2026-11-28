// service.server.ts — Engage: comments on the brand's own Instagram and
// Facebook posts, answered by a person or by an automation the team set up.
//
// Reads for the inbox use the caller's own RLS client. Everything that holds
// a token or writes runs with the service role, for a workspace id the RPC
// (or the cron sweep) has already verified, and every row is matched on that
// id. A reply goes out only from a person's click, or from a live automation
// with fixed words the team wrote (`automations.server.ts`); a reply Mox
// writes always waits for a person.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { decryptWithKeys, encryptWithKey } from "@/server/crypto/secret-box.server";
import { recordAudit } from "@/server/audit.server";
import { HttpError } from "@/server/http-error";
import type {
  EngageAnswer,
  EngageComment,
  EngageDmStatus,
  EngageExample,
  EngageHome,
  EngageMoxState,
  EngagePlatform,
  EngageQuestion,
  EngageRule,
  EngageStatus,
  EngageSyncResult,
} from "@/lib/engage/contracts";
import { MAX_OPEN_QUESTIONS } from "@/lib/engage/auto-reply";
import { sendableReply } from "@/lib/engage/reply";
import { KEEP_EXAMPLES, worthKeeping } from "@/lib/engage/training";
import {
  COMMENTS_PER_POST,
  POSTS_PER_SYNC,
  hasComments,
  dmWindowOpen,
  readConversation,
  CONVERSATIONS_PER_SYNC,
  MESSAGES_PER_CONVERSATION,
  type DmRead,
  type GraphConversation,
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
  graphDelete,
  graphGet,
  graphPost,
  type GraphList,
} from "./meta/graph.server";
import { consumeMetaState } from "./meta/oauth.server";

const db = supabaseAdmin as unknown as SupabaseClient;

/** Instagram refuses a DM over 1,000 characters; Messenger takes 2,000. */
const DM_MAX_CHARS = 1_000;

export type PageRow = {
  id: string;
  workspace_id: string;
  page_id: string;
  page_name: string;
  ig_user_id: string | null;
  ig_username: string | null;
  synced_at: string | null;
  last_error: string | null;
};

export type CommentDbRow = {
  id: string;
  kind: "comment" | "dm";
  sender_id: string | null;
  page_row_id: string;
  platform: EngagePlatform;
  external_id: string;
  post_id: string;
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
  rule_id: string | null;
  matched_keyword: string | null;
  auto_sent: boolean;
  dm_status: EngageDmStatus;
  dm_text: string | null;
  dm_error: string | null;
  mox_state: EngageMoxState;
  mox_note: string | null;
  question_id: string | null;
};

export const COMMENT_COLUMNS =
  "id,kind,sender_id,page_row_id,platform,external_id,post_id,author_name,body,commented_at,post_caption,post_permalink,status,draft,reply_text,replied_at,last_error,rule_id,matched_keyword,auto_sent,dm_status,dm_text,dm_error,mox_state,mox_note,question_id";

export const PAGE_COLUMNS =
  "id,workspace_id,page_id,page_name,ig_user_id,ig_username,synced_at,last_error";

export const RULE_COLUMNS =
  "id,name,status,platforms,post_scope,post_ids,match,keywords,whole_word,reply_mode,replies,mox_guidance,dm_enabled,dm_message,dm_link,send_mode,position,live_since,matched_count,sent_count,dm_count,last_matched_at";

export type RuleDbRow = {
  id: string;
  name: string;
  status: "live" | "paused";
  platforms: EngagePlatform[];
  post_scope: "any" | "posts";
  post_ids: string[];
  match: "keywords" | "any";
  keywords: string[];
  whole_word: boolean;
  reply_mode: "fixed" | "mox" | "none";
  replies: string[];
  mox_guidance: string | null;
  dm_enabled: boolean;
  dm_message: string | null;
  dm_link: string | null;
  send_mode: "auto" | "approve";
  position: number;
  live_since: string;
  matched_count: number;
  sent_count: number;
  dm_count: number;
  last_matched_at: string | null;
};

export function ruleView(r: RuleDbRow): EngageRule {
  return {
    id: r.id,
    name: r.name,
    status: r.status,
    platforms: r.platforms ?? [],
    postScope: r.post_scope,
    postIds: r.post_ids ?? [],
    match: r.match,
    keywords: r.keywords ?? [],
    wholeWord: r.whole_word,
    replyMode: r.reply_mode,
    replies: r.replies ?? [],
    moxGuidance: r.mox_guidance,
    dmEnabled: r.dm_enabled,
    dmMessage: r.dm_message,
    dmLink: r.dm_link,
    sendMode: r.send_mode,
    position: r.position,
    liveSince: r.live_since,
    matchedCount: r.matched_count,
    sentCount: r.sent_count,
    dmCount: r.dm_count,
    lastMatchedAt: r.last_matched_at,
  };
}

/** Which networks the person allowed private messages on. */
export function messagingFrom(scopes: unknown): { instagram: boolean; facebook: boolean } {
  const list = Array.isArray(scopes)
    ? scopes.filter((s): s is string => typeof s === "string")
    : [];
  return {
    instagram: list.includes("instagram_manage_messages"),
    facebook: list.includes("pages_messaging"),
  };
}

async function activeConnection(workspaceId: string) {
  const { data } = await db
    .from("workspace_connections")
    .select("id,status,account_login,last_error,permissions")
    .eq("workspace_id", workspaceId)
    .eq("provider", "meta")
    .neq("status", "revoked")
    .maybeSingle();
  return data as {
    id: string;
    status: string;
    account_login: string;
    last_error: string | null;
    permissions: { scopes?: unknown } | null;
  } | null;
}

export async function canMessageFor(workspaceId: string) {
  const conn = await activeConnection(workspaceId);
  return messagingFrom(conn?.permissions?.scopes);
}

// ── Inbox ─────────────────────────────────────────────────────────────────

export async function getEngageHome(
  client: SupabaseClient,
  workspaceId: string,
): Promise<EngageHome> {
  const [conn, pages, comments, replied, auto, rules, answers, examples, settings, questions] =
    await Promise.all([
      client
        .from("workspace_connections")
        .select("status,account_login,last_error,permissions")
        .eq("workspace_id", workspaceId)
        .eq("provider", "meta")
        .neq("status", "revoked")
        .maybeSingle(),
      client
        .from("meta_pages")
        .select(PAGE_COLUMNS)
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
      client
        .from("engage_comments")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("auto_sent", true),
      client
        .from("engage_rules")
        .select(RULE_COLUMNS)
        .eq("workspace_id", workspaceId)
        .order("position")
        .order("created_at"),
      client
        .from("engage_knowledge")
        .select("id,question,answer,updated_at")
        .eq("workspace_id", workspaceId)
        .order("updated_at", { ascending: false })
        .limit(100),
      client
        .from("engage_examples")
        .select("id,platform,comment,reply,created_at")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false })
        .limit(KEEP_EXAMPLES),
      client
        .from("engage_settings")
        .select("automations_on,auto_reply,guidelines")
        .eq("workspace_id", workspaceId)
        .maybeSingle(),
      client
        .from("engage_questions")
        .select("id,question,asked_count,example_comment,created_at")
        .eq("workspace_id", workspaceId)
        .eq("status", "open")
        .order("asked_count", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(MAX_OPEN_QUESTIONS),
    ]);
  const set = settings.data as {
    automations_on: boolean;
    auto_reply: boolean;
    guidelines: string;
  } | null;
  const pageRows = (pages.data ?? []) as PageRow[];
  const byId = new Map(pageRows.map((p) => [p.id, p]));
  const ruleRows = ((rules.data ?? []) as RuleDbRow[]).map(ruleView);
  const ruleName = new Map(ruleRows.map((r) => [r.id, r.name]));
  const rows = (comments.data ?? []) as CommentDbRow[];
  const view: EngageComment[] = rows.map((c) => {
    const page = byId.get(c.page_row_id);
    return {
      id: c.id,
      kind: c.kind ?? "comment",
      platform: c.platform,
      pageName: page?.page_name ?? "",
      igUsername: page?.ig_username ?? null,
      authorName: c.author_name,
      body: c.body,
      commentedAt: c.commented_at,
      postId: c.post_id,
      postCaption: c.post_caption,
      postPermalink: c.post_permalink,
      status: c.status,
      draft: c.draft,
      replyText: c.reply_text,
      repliedAt: c.replied_at,
      lastError: c.last_error,
      ruleId: c.rule_id,
      ruleName: c.rule_id ? (ruleName.get(c.rule_id) ?? null) : null,
      matchedKeyword: c.matched_keyword,
      autoSent: c.auto_sent,
      dmStatus: c.dm_status,
      dmText: c.dm_text,
      dmError: c.dm_error,
      moxState: c.mox_state ?? "none",
      moxNote: c.mox_note ?? null,
      questionId: c.question_id ?? null,
    };
  });
  const c = conn.data as {
    status: string;
    account_login: string;
    last_error: string | null;
    permissions: { scopes?: unknown } | null;
  } | null;
  // What customers ask (the customer brain), read only once Meta is connected.
  const voice = c
    ? await import("./context.server")
        .then((m) => m.customerVoiceFor(workspaceId))
        .catch(() => null)
    : null;
  return {
    configured: metaConfigured(),
    voice,
    connection: c
      ? {
          status:
            c.status === "active" ? "active" : c.status === "suspended" ? "suspended" : "error",
          accountName: c.account_login,
          lastError: c.last_error,
          canMessage: messagingFrom(c.permissions?.scopes),
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
      autoReplied: auto.count ?? 0,
    },
    automationsOn: set?.automations_on ?? true,
    autoReply: set?.auto_reply ?? true,
    guidelines: set?.guidelines ?? "",
    questions: (
      (questions.data ?? []) as {
        id: string;
        question: string;
        asked_count: number;
        example_comment: string | null;
        created_at: string;
      }[]
    ).map((q): EngageQuestion => ({
      id: q.id,
      question: q.question,
      askedCount: q.asked_count,
      exampleComment: q.example_comment,
      createdAt: q.created_at,
    })),
    rules: ruleRows,
    answers: (
      (answers.data ?? []) as { id: string; question: string; answer: string; updated_at: string }[]
    ).map((a): EngageAnswer => ({
      id: a.id,
      question: a.question,
      answer: a.answer,
      updatedAt: a.updated_at,
    })),
    examples: (
      (examples.data ?? []) as {
        id: string;
        platform: EngagePlatform;
        comment: string;
        reply: string;
        created_at: string;
      }[]
    ).map((e): EngageExample => ({
      id: e.id,
      platform: e.platform,
      comment: e.comment,
      reply: e.reply,
      createdAt: e.created_at,
    })),
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
    // Meta then tells Mellox about new comments and messages at once (the
    // webhook wakes the sweep). Best effort: without it the sweep still reads
    // every few minutes. Repeating it is harmless.
    await graphPost(`${p.id}/subscribed_apps`, p.access_token!, {
      subscribed_fields: "feed,messages",
    }).catch((error: unknown) =>
      console.warn(
        "[engage] page webhook subscribe skipped",
        p.id,
        error instanceof Error ? error.message : error,
      ),
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
  // The sweep reads a brand only with a settings row: auto-reply starts now.
  await db
    .from("engage_settings")
    .upsert(
      { workspace_id: txn.workspaceId },
      { onConflict: "workspace_id", ignoreDuplicates: true },
    );
  return { workspaceId: txn.workspaceId, pages: keep.length };
}

export async function disconnectMeta(workspaceId: string, userId: string): Promise<void> {
  const conn = await activeConnection(workspaceId);
  if (!conn) return;
  // Unsubscribe each Page from Mellox's webhook first, while the token is
  // still here. Best effort: a token Meta already revoked can't do it, and
  // Meta drops the subscription itself when the app is removed.
  const { data: pages } = await db
    .from("meta_pages")
    .select("id,page_id")
    .eq("workspace_id", workspaceId);
  for (const p of (pages ?? []) as { id: string; page_id: string }[]) {
    try {
      await graphDelete(`${p.page_id}/subscribed_apps`, await pageToken(workspaceId, p.id));
    } catch (error) {
      console.warn(
        "[engage] page webhook unsubscribe skipped",
        p.page_id,
        error instanceof Error ? error.message : error,
      );
    }
  }
  await db.from("meta_pages").delete().eq("workspace_id", workspaceId);
  await db.from("meta_oauth_credentials").delete().eq("connection_id", conn.id);
  // Everything from the account goes (privacy policy): reply examples and the
  // comments quoted on open questions came from it too.
  await db.from("engage_examples").delete().eq("workspace_id", workspaceId);
  await db
    .from("engage_questions")
    .update({ example_comment: null })
    .eq("workspace_id", workspaceId)
    .not("example_comment", "is", null);
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

export async function pageToken(workspaceId: string, pageRowId: string): Promise<string> {
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

export async function pagesFor(workspaceId: string): Promise<PageRow[]> {
  const { data } = await db.from("meta_pages").select(PAGE_COLUMNS).eq("workspace_id", workspaceId);
  return (data ?? []) as PageRow[];
}

// ── Sync ──────────────────────────────────────────────────────────────────

async function readPage(page: PageRow, token: string): Promise<CommentRow[]> {
  const rows: CommentRow[] = [];
  if (page.ig_user_id) {
    const media = await graphGet<GraphList<IgMedia>>(`${page.ig_user_id}/media`, token, {
      fields: "id,caption,permalink,timestamp,comments_count",
      limit: String(POSTS_PER_SYNC),
    });
    for (const m of media.data ?? []) {
      if (!/^[0-9]{1,40}$/.test(m.id)) continue;
      // No comments, no read: keeps every brand well inside Instagram's rate limit.
      if (!hasComments(m.comments_count)) continue;
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
    fields: "id,message,permalink_url,created_time,comments.summary(true).limit(0)",
    limit: String(POSTS_PER_SYNC),
  });
  for (const p of posts.data ?? []) {
    if (!/^[0-9_]{1,80}$/.test(p.id)) continue;
    if (!hasComments(p.comments?.summary?.total_count)) continue;
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

/** The DM conversations of one Page (Messenger) and its Instagram, newest first. */
async function readMessages(
  page: PageRow,
  token: string,
  allowed: { instagram: boolean; facebook: boolean },
): Promise<DmRead[]> {
  const reads: DmRead[] = [];
  const fields = `id,updated_time,messages.limit(${MESSAGES_PER_CONVERSATION}){id,message,created_time,from}`;
  const channels: { platform: EngagePlatform; meta: string; own: string[] }[] = [];
  if (allowed.facebook)
    channels.push({ platform: "facebook", meta: "messenger", own: [page.page_id] });
  if (allowed.instagram && page.ig_user_id)
    channels.push({
      platform: "instagram",
      meta: "instagram",
      own: [page.ig_user_id, page.page_id],
    });
  for (const ch of channels) {
    const list = await graphGet<GraphList<GraphConversation>>(
      `${page.page_id}/conversations`,
      token,
      {
        platform: ch.meta,
        fields,
        limit: String(CONVERSATIONS_PER_SYNC),
      },
    );
    for (const conv of list.data ?? []) reads.push(readConversation(ch.platform, conv, ch.own));
  }
  return reads;
}

/**
 * Store what the conversations say: a new message to answer (an older open
 * row of the same conversation is folded into it), or a reply the brand
 * already sent, which closes the open row.
 */
async function storeMessages(workspaceId: string, page: PageRow, reads: DmRead[]) {
  let added = 0;
  for (const r of reads) {
    if (r.kind === "answered") {
      await db
        .from("engage_comments")
        .update({
          status: "replied",
          reply_text: r.text.slice(0, 8_000) || null,
          replied_at: r.at ?? new Date().toISOString(),
          last_error: null,
        })
        .eq("workspace_id", workspaceId)
        .eq("kind", "dm")
        .eq("post_id", r.conversationId)
        .in("status", ["new", "drafted"]);
      continue;
    }
    if (r.kind !== "waiting") continue;
    const { data: inserted, error: insertError } = await db
      .from("engage_comments")
      .upsert(
        // Quick replies are for comments; Mox (auto-reply) takes DMs.
        [{ ...r.row, workspace_id: workspaceId, page_row_id: page.id, rules_checked: true }],
        { onConflict: "workspace_id,platform,external_id", ignoreDuplicates: true },
      )
      .select("id");
    if (insertError) throw new Error(`Couldn't save a message: ${insertError.message}`);
    const id = (inserted?.[0] as { id: string } | undefined)?.id;
    if (!id) continue;
    added++;
    // The new row carries every message since the brand's last reply.
    await db
      .from("engage_comments")
      .update({ status: "dismissed", mox_note: "Folded into a newer message." })
      .eq("workspace_id", workspaceId)
      .eq("kind", "dm")
      .eq("post_id", r.row.post_id)
      .neq("id", id)
      .in("status", ["new", "drafted"]);
  }
  return added;
}

/**
 * Read new comments for every Page. A comment already stored is left as it
 * is. New comments then go through the live automations.
 */
export async function syncEngage(
  workspaceId: string,
  opts: { deadline?: number } = {},
): Promise<EngageSyncResult> {
  const conn = await activeConnection(workspaceId);
  if (!conn) throw new HttpError(409, "Connect Instagram and Facebook first.");
  const pages = await pagesFor(workspaceId);
  let added = 0;
  let errors = 0;
  const allowed = messagingFrom(conn.permissions?.scopes);
  for (const page of pages) {
    try {
      const rows = await readPage(page, await pageToken(workspaceId, page.id));
      if (rows.length) {
        const { data: inserted, error: insertError } = await db
          .from("engage_comments")
          .upsert(
            rows.map((r) => ({ ...r, workspace_id: workspaceId, page_row_id: page.id })),
            { onConflict: "workspace_id,platform,external_id", ignoreDuplicates: true },
          )
          .select("id");
        if (insertError) throw new Error(`Couldn't save comments: ${insertError.message}`);
        added += inserted?.length ?? 0;
      }
      let dmError: string | null = null;
      if (allowed.facebook || allowed.instagram) {
        try {
          const token = await pageToken(workspaceId, page.id);
          added += await storeMessages(workspaceId, page, await readMessages(page, token, allowed));
        } catch (error) {
          // DMs failing never stops comments; the reason shows on the Page.
          if (error instanceof GraphError) await markTokenProblem(workspaceId, error);
          dmError =
            `Couldn't read messages: ${error instanceof Error ? error.message : "unknown"}`.slice(
              0,
              300,
            );
        }
      }
      await db
        .from("meta_pages")
        .update({ synced_at: new Date().toISOString(), last_error: dmError })
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
  let automated = 0;
  let asked = 0;
  try {
    const { applyRules } = await import("./automations.server");
    automated = (await applyRules(workspaceId)).sent;
  } catch (error) {
    console.error("[engage] automations failed", error);
  }
  // Whatever no quick reply answered, Mox answers (or asks the team).
  try {
    const { runAutoReply } = await import("./auto-reply.server");
    const out = await runAutoReply(workspaceId, opts);
    automated += out.replied;
    asked = out.asked;
  } catch (error) {
    console.error("[engage] auto-reply failed", error);
  }
  return { pages: pages.length, added, errors, automated, asked };
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
    .select(PAGE_COLUMNS)
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
  // A private message that was waiting for this reply is not sent either.
  await db
    .from("engage_comments")
    .update({ dm_status: "skipped", dm_error: "The comment was dismissed." })
    .eq("workspace_id", workspaceId)
    .eq("id", commentId)
    .eq("dm_status", "pending");
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

/** Does the conversation already hold this message from the brand, after theirs? */
async function findOwnMessage(page: PageRow, comment: CommentDbRow, token: string, text: string) {
  const norm = (s: string | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
  const conv = await graphGet<{
    messages?: {
      data?: { id: string; message?: string; created_time?: string; from?: { id?: string } }[];
    };
  }>(comment.post_id, token, { fields: "messages.limit(10){id,message,created_time,from}" });
  const own = [page.page_id, page.ig_user_id].filter(Boolean);
  return (conv.messages?.data ?? []).find(
    (m) =>
      norm(m.message) === norm(text) &&
      own.includes(m.from?.id ?? "") &&
      Date.parse(m.created_time ?? "") >= Date.parse(comment.commented_at),
  );
}

/**
 * Post a public reply. `new|drafted|unknown → sending` is a compare-and-set,
 * so a double click (or a click racing the automation) sends once. An unclear
 * outcome is kept as `unknown`; the next try first looks for the reply.
 * `userId` is null for an automation's send.
 */
export async function deliverReply(args: {
  workspaceId: string;
  commentId: string;
  text: string;
  userId: string | null;
  brandDomain: string | null;
}): Promise<{ status: EngageStatus }> {
  const { comment, page } = await commentFor(args.workspaceId, args.commentId);
  if (comment.status === "replied") return { status: "replied" };
  if (comment.status === "dismissed") throw new HttpError(409, "This comment was dismissed.");
  if (comment.status === "sending") throw new HttpError(409, "This reply is already being sent.");
  const ok = sendableReply(args.text, comment.platform, args.brandDomain);
  if (!ok.ok) throw new HttpError(400, ok.reason);
  if (comment.platform === "instagram" && !page.ig_user_id)
    throw new HttpError(409, "This Page has no Instagram account linked any more.");
  const dm = comment.kind === "dm";
  if (dm) {
    if (!comment.sender_id) throw new HttpError(409, "This message has no sender to answer.");
    if (ok.text.length > DM_MAX_CHARS)
      throw new HttpError(
        400,
        `A DM can be ${DM_MAX_CHARS.toLocaleString("en")} characters at most.`,
      );
    if (!dmWindowOpen(comment.commented_at))
      throw new HttpError(
        409,
        "Meta only allows a reply within 24 hours of their last message. Answer them in Meta's own inbox.",
      );
    if (!(await canMessageFor(args.workspaceId))[comment.platform])
      throw new HttpError(409, "Messages aren't allowed yet. Connect again and allow messages.");
  }

  const { data: claimed } = await db
    .from("engage_comments")
    .update({ status: "sending", last_error: null })
    .eq("workspace_id", args.workspaceId)
    .eq("id", comment.id)
    .eq("status", comment.status)
    .select("id");
  if (!claimed?.length) throw new HttpError(409, "This reply is already being sent.");

  const auto = args.userId === null;
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
        auto_sent: auto,
        last_error: null,
      })
      .eq("workspace_id", args.workspaceId)
      .eq("id", comment.id);
    await recordAudit({
      workspaceId: args.workspaceId,
      userId: args.userId,
      action: auto ? "engage.reply.auto_sent" : "engage.reply.sent",
      entity: `engage_comments:${comment.id}`,
      payload: { platform: comment.platform, reply_id: replyId, rule_id: comment.rule_id },
    });
    // A person's own words teach Mox the brand's voice.
    if (!auto && worthKeeping(ok.text)) await keepExample(args.workspaceId, comment, ok.text);
    return { status: "replied" as const };
  };

  try {
    if (comment.status === "unknown") {
      const found = dm
        ? await findOwnMessage(page, comment, token, ok.text)
        : await findOwnReply(page, comment, token, ok.text);
      if (found) return await done(found.id);
    }
    if (dm) {
      // Send API: the person who wrote, as a response inside Meta's 24-hour window.
      const res = await graphPost<{ message_id?: string }>(`${page.page_id}/messages`, token, {
        recipient: JSON.stringify({ id: comment.sender_id }),
        messaging_type: "RESPONSE",
        message: JSON.stringify({ text: ok.text }),
      });
      return await done(typeof res.message_id === "string" ? res.message_id.slice(0, 100) : "");
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

/** A person pressed Send. The private message the automation prepared goes with it. */
export async function sendEngageReply(args: {
  workspaceId: string;
  commentId: string;
  text: string;
  userId: string;
  brandDomain: string | null;
}): Promise<{ status: EngageStatus }> {
  const out = await deliverReply(args);
  // The reply is out; a message problem stays on the comment, never fails the reply.
  if (out.status === "replied")
    await sendPrivateReply(args.workspaceId, args.commentId, args.userId).catch((error) =>
      console.error("[engage] private message failed", error),
    );
  return out;
}

/**
 * Send the prepared private message for a comment (`dm_status = pending`).
 * Claimed `pending → unknown` before the call, so a crash or an unclear
 * answer is never sent twice: an unknown message stays unknown.
 */
export async function sendPrivateReply(
  workspaceId: string,
  commentId: string,
  userId: string | null,
): Promise<EngageDmStatus> {
  const { comment, page } = await commentFor(workspaceId, commentId);
  if (comment.dm_status !== "pending" || !comment.dm_text) return comment.dm_status;
  const allowed = await canMessageFor(workspaceId);
  if (!allowed[comment.platform]) {
    await db
      .from("engage_comments")
      .update({
        dm_status: "skipped",
        dm_error: "Private messages aren't allowed yet. Connect again and allow messages.",
      })
      .eq("workspace_id", workspaceId)
      .eq("id", comment.id)
      .eq("dm_status", "pending");
    return "skipped";
  }
  const { data: claimed } = await db
    .from("engage_comments")
    .update({ dm_status: "unknown", dm_error: null })
    .eq("workspace_id", workspaceId)
    .eq("id", comment.id)
    .eq("dm_status", "pending")
    .select("id");
  if (!claimed?.length) return "unknown";
  const set = (dm_status: EngageDmStatus, dm_error: string | null) =>
    db
      .from("engage_comments")
      .update({ dm_status, dm_error })
      .eq("workspace_id", workspaceId)
      .eq("id", comment.id);
  try {
    const token = await pageToken(workspaceId, page.id);
    // Private replies: one message to the person who wrote the comment.
    await graphPost<{ message_id?: string }>(`${page.page_id}/messages`, token, {
      recipient: JSON.stringify({ comment_id: comment.external_id }),
      message: JSON.stringify({ text: comment.dm_text.slice(0, 1_000) }),
    });
    await set("sent", null);
    if (comment.rule_id)
      await db.rpc("engage_rule_bump", {
        p_rule: comment.rule_id,
        p_matched: 0,
        p_sent: 0,
        p_dm: 1,
      });
    await recordAudit({
      workspaceId,
      userId,
      action: "engage.dm.sent",
      entity: `engage_comments:${comment.id}`,
      payload: { platform: comment.platform, rule_id: comment.rule_id },
    });
    return "sent";
  } catch (error) {
    if (error instanceof GraphError) await markTokenProblem(workspaceId, error);
    if (error instanceof GraphError && error.kind === "unknown") {
      await set("unknown", "Meta didn't confirm the private message. It won't be sent again.");
      return "unknown";
    }
    const message =
      error instanceof Error ? error.message.slice(0, 300) : "Couldn't send the message.";
    await set("failed", message);
    return "failed";
  }
}

/** Keep a person's sent reply as a voice example (newest KEEP_EXAMPLES). */
async function keepExample(workspaceId: string, comment: CommentDbRow, reply: string) {
  try {
    await db.from("engage_examples").insert({
      workspace_id: workspaceId,
      platform: comment.platform,
      comment: comment.body.slice(0, 1_000) || "(no words)",
      reply: reply.slice(0, 2_200),
    });
    const { data } = await db
      .from("engage_examples")
      .select("id")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .range(KEEP_EXAMPLES, KEEP_EXAMPLES + 50);
    const old = (data ?? []).map((r) => (r as { id: string }).id);
    if (old.length)
      await db.from("engage_examples").delete().eq("workspace_id", workspaceId).in("id", old);
  } catch (error) {
    console.error("[engage] keeping an example failed", error);
  }
}
