// automations.server.ts — Engage automations (ManyChat-style) and Train Mox.
//
//   * Rules, answers and examples are written here, with the service role,
//     for a workspace id the RPC verified (editor).
//   * `applyRules` runs after every sync: each new comment is matched once
//     (`rules_checked` is a compare-and-set) by the pure `pickRule`.
//       - a live rule with fixed words set to "send by itself" replies (and
//         sends its private message) within the hourly cap;
//       - every other match waits for a person: fixed words become the
//         draft, a Mox rule keeps its guidance for "Draft with Mox";
//       - a quick reply set to "Mox writes" waits for a person
//         (`sendsByItself`); Mox's own auto-reply is auto-reply.server.ts.
//   * `runDueEngage` is called by the existing every-minute run-schedules
//     hook: a brand with auto-reply on, or automations on and a live rule, is
//     read about every three minutes (then Mox answers, auto-reply.server.ts). No cron job of its own. Graph reads cost nothing.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { recordAudit } from "@/server/audit.server";
import { HttpError } from "@/server/http-error";
import type { EngagePost, EngageRule, RuleInput } from "@/lib/engage/contracts";
import {
  AUTO_SENDS_PER_HOUR,
  MAX_RULES,
  dmText,
  personalize,
  pickReply,
  pickRule,
  sendsByItself,
  tidyRule,
} from "@/lib/engage/rules";
import { MAX_ANSWERS, tidyAnswer } from "@/lib/engage/training";
import { POSTS_PER_SYNC, type FbPost, type IgMedia } from "@/lib/engage/sync";
import { graphGet, type GraphList } from "./meta/graph.server";
import {
  COMMENT_COLUMNS,
  RULE_COLUMNS,
  deliverReply,
  pageToken,
  pagesFor,
  ruleView,
  sendPrivateReply,
  syncEngage,
  type CommentDbRow,
  type RuleDbRow,
} from "./service.server";

const db = supabaseAdmin as unknown as SupabaseClient;

/** How often a brand with live automations is read. */
const SYNC_EVERY_MS = 3 * 60_000;
/** Brands read at the same time by one sweep. */
const SWEEP_LANES = 5;
/** Comments matched per run; the rest wait for the next one. */
const CHECK_PER_RUN = 60;

// ── Rules ─────────────────────────────────────────────────────────────────

export async function liveRules(workspaceId: string): Promise<EngageRule[]> {
  const { data } = await db
    .from("engage_rules")
    .select(RULE_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("status", "live")
    .order("position");
  return ((data ?? []) as RuleDbRow[]).map(ruleView);
}

async function ensureSettings(workspaceId: string) {
  await db
    .from("engage_settings")
    .upsert({ workspace_id: workspaceId }, { onConflict: "workspace_id", ignoreDuplicates: true });
}

function ruleColumns(rule: RuleInput) {
  return {
    name: rule.name,
    platforms: rule.platforms,
    post_scope: rule.postScope,
    post_ids: rule.postIds,
    match: rule.match,
    keywords: rule.keywords,
    whole_word: rule.wholeWord,
    reply_mode: rule.replyMode,
    replies: rule.replies,
    mox_guidance: rule.moxGuidance,
    dm_enabled: rule.dmEnabled,
    dm_message: rule.dmMessage,
    dm_link: rule.dmLink,
    send_mode: rule.sendMode,
  };
}

export async function saveRule(args: {
  workspaceId: string;
  userId: string;
  id?: string;
  input: Partial<RuleInput>;
}): Promise<EngageRule> {
  const tidy = tidyRule(args.input);
  if (!tidy.ok) throw new HttpError(400, tidy.reason);
  await ensureSettings(args.workspaceId);
  if (args.id) {
    const { data, error } = await db
      .from("engage_rules")
      .update(ruleColumns(tidy.rule))
      .eq("workspace_id", args.workspaceId)
      .eq("id", args.id)
      .select(RULE_COLUMNS)
      .maybeSingle();
    if (error) throw new HttpError(500, "Couldn't save the automation.");
    if (!data) throw new HttpError(404, "That automation isn't here any more.");
    await recordAudit({
      workspaceId: args.workspaceId,
      userId: args.userId,
      action: "engage.rule.updated",
      entity: `engage_rules:${args.id}`,
    });
    return ruleView(data as RuleDbRow);
  }
  const { data: existing, count } = await db
    .from("engage_rules")
    .select("position", { count: "exact" })
    .eq("workspace_id", args.workspaceId)
    .order("position", { ascending: false })
    .limit(1);
  if ((count ?? 0) >= MAX_RULES)
    throw new HttpError(409, `A brand can have up to ${MAX_RULES} automations.`);
  const top = (existing?.[0] as { position: number } | undefined)?.position ?? -1;
  const { data, error } = await db
    .from("engage_rules")
    .insert({
      ...ruleColumns(tidy.rule),
      workspace_id: args.workspaceId,
      status: "live",
      position: top + 1,
      live_since: new Date().toISOString(),
      created_by: args.userId,
    })
    .select(RULE_COLUMNS)
    .single();
  if (error || !data) throw new HttpError(500, "Couldn't save the automation.");
  await recordAudit({
    workspaceId: args.workspaceId,
    userId: args.userId,
    action: "engage.rule.created",
    entity: `engage_rules:${(data as RuleDbRow).id}`,
  });
  return ruleView(data as RuleDbRow);
}

export async function deleteRule(workspaceId: string, userId: string, id: string) {
  await db.from("engage_rules").delete().eq("workspace_id", workspaceId).eq("id", id);
  await recordAudit({
    workspaceId,
    userId,
    action: "engage.rule.deleted",
    entity: `engage_rules:${id}`,
  });
}

/** Live from now: a rule that goes live never answers older comments. */
export async function setRuleStatus(
  workspaceId: string,
  userId: string,
  id: string,
  status: "live" | "paused",
) {
  const { data } = await db
    .from("engage_rules")
    .update(status === "live" ? { status, live_since: new Date().toISOString() } : { status })
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .neq("status", status)
    .select("id");
  if (data?.length)
    await recordAudit({
      workspaceId,
      userId,
      action: status === "live" ? "engage.rule.live" : "engage.rule.paused",
      entity: `engage_rules:${id}`,
    });
}

/** The person's order: the first matching rule wins. */
export async function reorderRules(workspaceId: string, ids: string[]) {
  for (const [i, id] of ids.entries())
    await db
      .from("engage_rules")
      .update({ position: i })
      .eq("workspace_id", workspaceId)
      .eq("id", id);
}

export async function setAutomations(workspaceId: string, userId: string, on: boolean) {
  await ensureSettings(workspaceId);
  await db
    .from("engage_settings")
    .update({ automations_on: on, next_sync_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId);
  await recordAudit({
    workspaceId,
    userId,
    action: on ? "engage.automations.on" : "engage.automations.off",
    entity: `engage_settings:${workspaceId}`,
  });
}

// ── Train Mox ─────────────────────────────────────────────────────────────

export async function saveAnswer(args: {
  workspaceId: string;
  userId: string;
  id?: string;
  question: string;
  answer: string;
}): Promise<string> {
  const tidy = tidyAnswer(args.question, args.answer);
  if (!tidy.ok) throw new HttpError(400, tidy.reason);
  if (args.id) {
    const { data } = await db
      .from("engage_knowledge")
      .update({ question: tidy.question, answer: tidy.answer })
      .eq("workspace_id", args.workspaceId)
      .eq("id", args.id)
      .select("id");
    if (!data?.length) throw new HttpError(404, "That answer isn't here any more.");
    await retryAfterAnswer(args.workspaceId);
    return args.id;
  }
  const { count } = await db
    .from("engage_knowledge")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", args.workspaceId);
  if ((count ?? 0) >= MAX_ANSWERS)
    throw new HttpError(409, `Mox can keep up to ${MAX_ANSWERS} answers. Remove one first.`);
  const { data: row, error } = await db
    .from("engage_knowledge")
    .insert({
      workspace_id: args.workspaceId,
      question: tidy.question,
      answer: tidy.answer,
      created_by: args.userId,
    })
    .select("id")
    .single();
  if (error || !row) throw new HttpError(500, "Couldn't save the answer.");
  await retryAfterAnswer(args.workspaceId);
  return (row as { id: string }).id;
}

/** A new answer may be what a waiting comment needed: Mox reads them again. */
async function retryAfterAnswer(workspaceId: string) {
  const { retryWaiting } = await import("./auto-reply.server");
  await retryWaiting(workspaceId).catch(() => undefined);
}

export async function deleteAnswer(workspaceId: string, id: string) {
  await db.from("engage_knowledge").delete().eq("workspace_id", workspaceId).eq("id", id);
}

export async function deleteExample(workspaceId: string, id: string) {
  await db.from("engage_examples").delete().eq("workspace_id", workspaceId).eq("id", id);
}

// ── Posts (for the "which posts" picker) ──────────────────────────────────

export async function listEngagePosts(workspaceId: string): Promise<EngagePost[]> {
  const posts: EngagePost[] = [];
  for (const page of await pagesFor(workspaceId)) {
    const token = await pageToken(workspaceId, page.id);
    if (page.ig_user_id) {
      const media = await graphGet<
        GraphList<IgMedia & { media_url?: string; thumbnail_url?: string; media_type?: string }>
      >(`${page.ig_user_id}/media`, token, {
        fields: "id,caption,permalink,timestamp,media_url,thumbnail_url,media_type",
        limit: String(POSTS_PER_SYNC * 2),
      }).catch(() => ({ data: [] }));
      for (const m of media.data ?? [])
        if (/^[0-9]{1,40}$/.test(m.id))
          posts.push({
            id: m.id,
            platform: "instagram",
            caption: m.caption?.slice(0, 300) ?? null,
            permalink: httpsOrNull(m.permalink),
            thumbnail: httpsOrNull(m.thumbnail_url ?? m.media_url),
            postedAt: m.timestamp ?? null,
          });
    }
    const fb = await graphGet<GraphList<FbPost & { full_picture?: string }>>(
      `${page.page_id}/posts`,
      token,
      {
        fields: "id,message,permalink_url,created_time,full_picture",
        limit: String(POSTS_PER_SYNC * 2),
      },
    ).catch(() => ({ data: [] }));
    for (const p of fb.data ?? [])
      if (/^[0-9_]{1,80}$/.test(p.id))
        posts.push({
          id: p.id,
          platform: "facebook",
          caption: p.message?.slice(0, 300) ?? null,
          permalink: httpsOrNull(p.permalink_url),
          thumbnail: httpsOrNull(p.full_picture),
          postedAt: p.created_time ?? null,
        });
  }
  return posts.sort((a, b) => Date.parse(b.postedAt ?? "") - Date.parse(a.postedAt ?? ""));
}

function httpsOrNull(v: string | undefined): string | null {
  if (!v) return null;
  try {
    return new URL(v).protocol === "https:" ? v : null;
  } catch {
    return null;
  }
}

// ── Running the rules ─────────────────────────────────────────────────────

/** Match new comments to the live automations and act on them. */
export async function applyRules(workspaceId: string): Promise<{ matched: number; sent: number }> {
  const [{ data: settings }, rules, { data: rows }] = await Promise.all([
    db
      .from("engage_settings")
      .select("automations_on")
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
    liveRules(workspaceId),
    db
      .from("engage_comments")
      .select(COMMENT_COLUMNS)
      .eq("workspace_id", workspaceId)
      .eq("rules_checked", false)
      .order("commented_at")
      .limit(CHECK_PER_RUN),
  ]);
  const comments = (rows ?? []) as CommentDbRow[];
  if (!comments.length) return { matched: 0, sent: 0 };
  const on = (settings as { automations_on: boolean } | null)?.automations_on ?? true;
  let brandDomain: string | null | undefined;
  let matched = 0;
  let sent = 0;

  for (const c of comments) {
    const hit =
      on && c.status === "new"
        ? pickRule(
            {
              id: c.id,
              platform: c.platform,
              postId: c.post_id,
              body: c.body,
              commentedAt: c.commented_at,
            },
            rules,
          )
        : null;
    const dm = hit?.rule.dmEnabled ? dmText(hit.rule, c.author_name) : null;
    const reply =
      hit && hit.rule.replyMode === "fixed"
        ? personalize(pickReply(hit.rule.replies, c.id) ?? "", c.author_name) || null
        : null;
    // Claim the comment once: a second sweep or a refresh never acts twice.
    const { data: claimed } = await db
      .from("engage_comments")
      .update({
        rules_checked: true,
        rule_id: hit?.rule.id ?? null,
        matched_keyword: hit?.keyword?.slice(0, 60) ?? null,
        ...(dm ? { dm_status: "pending", dm_text: dm.slice(0, 3_000) } : {}),
      })
      .eq("workspace_id", workspaceId)
      .eq("id", c.id)
      .eq("rules_checked", false)
      .select("id");
    if (!claimed?.length || !hit) continue;
    matched++;
    await db.rpc("engage_rule_bump", { p_rule: hit.rule.id, p_matched: 1, p_sent: 0, p_dm: 0 });

    if (!sendsByItself(hit.rule)) {
      // Waits for a person; fixed words are ready as the draft.
      if (reply)
        await db
          .from("engage_comments")
          .update({ draft: reply, drafted_at: new Date().toISOString(), status: "drafted" })
          .eq("workspace_id", workspaceId)
          .eq("id", c.id)
          .eq("status", "new");
      continue;
    }

    const { data: allowed } = await db.rpc("engage_take_send", {
      p_workspace: workspaceId,
      p_cap: AUTO_SENDS_PER_HOUR,
    });
    if (allowed !== true) {
      await db
        .from("engage_comments")
        .update({
          draft: reply,
          drafted_at: reply ? new Date().toISOString() : null,
          status: reply ? "drafted" : "new",
          last_error: `This hour's ${AUTO_SENDS_PER_HOUR} automatic replies are used. This one waits for you.`,
        })
        .eq("workspace_id", workspaceId)
        .eq("id", c.id)
        .eq("status", "new");
      continue;
    }

    try {
      if (reply) {
        if (brandDomain === undefined) {
          const { brandDomainFor } = await import("./reply.server");
          brandDomain = await brandDomainFor(workspaceId).catch(() => null);
        }
        const out = await deliverReply({
          workspaceId,
          commentId: c.id,
          text: reply,
          userId: null,
          brandDomain,
        });
        if (out.status === "replied") {
          sent++;
          await db.rpc("engage_rule_bump", {
            p_rule: hit.rule.id,
            p_matched: 0,
            p_sent: 1,
            p_dm: 0,
          });
        }
      }
      if (dm) await sendPrivateReply(workspaceId, c.id, null);
    } catch (error) {
      // The comment keeps its error and waits for a person.
      const message = error instanceof Error ? error.message.slice(0, 300) : "Couldn't send.";
      await db
        .from("engage_comments")
        .update({ last_error: message, draft: reply })
        .eq("workspace_id", workspaceId)
        .eq("id", c.id)
        .in("status", ["new", "drafted"]);
    }
  }
  if (matched)
    await db
      .from("engage_settings")
      .update({ last_run_at: new Date().toISOString() })
      .eq("workspace_id", workspaceId);
  return { matched, sent };
}

/**
 * The every-minute sweep: brands with automations on and a live rule whose
 * turn has come. Each is claimed by moving `next_sync_at` (compare-and-set).
 */
export async function runDueEngage(opts: { max?: number; budgetMs?: number } = {}) {
  const started = Date.now();
  const budget = opts.budgetMs ?? 40_000;
  const now = new Date().toISOString();
  const { data } = await db
    .from("engage_settings")
    .select("workspace_id,next_sync_at,auto_reply")
    .or("automations_on.eq.true,auto_reply.eq.true")
    .lte("next_sync_at", now)
    .order("next_sync_at")
    .limit(opts.max ?? 40);
  const due = (data ?? []) as {
    workspace_id: string;
    next_sync_at: string;
    auto_reply: boolean;
  }[];
  const { isEngageEnabled } = await import("@/lib/feature-flags");
  const { loadBackgroundAccount } = await import("@/server/background/account.server");
  let ran = 0;
  let sent = 0;
  const one = async (row: (typeof due)[number]) => {
    const { data: claimed } = await db
      .from("engage_settings")
      .update({ next_sync_at: new Date(Date.now() + SYNC_EVERY_MS).toISOString() })
      .eq("workspace_id", row.workspace_id)
      .eq("next_sync_at", row.next_sync_at)
      .select("workspace_id");
    if (!claimed?.length) return;
    try {
      if (!isEngageEnabled(row.workspace_id)) return;
      const { count } = await db
        .from("engage_rules")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", row.workspace_id)
        .eq("status", "live");
      if (!count && !row.auto_reply) {
        // Nothing to run: look again in an hour.
        await db
          .from("engage_settings")
          .update({ next_sync_at: new Date(Date.now() + 60 * 60_000).toISOString() })
          .eq("workspace_id", row.workspace_id);
        return;
      }
      // A brand without a running plan gets no automatic replies.
      const account = await loadBackgroundAccount(row.workspace_id);
      if (!account || account.frozen || account.paused || account.plan === "free") {
        await db
          .from("engage_settings")
          .update({ next_sync_at: new Date(Date.now() + 6 * 60 * 60_000).toISOString() })
          .eq("workspace_id", row.workspace_id);
        return;
      }
      // Mox stops taking new comments once the sweep's budget is spent.
      const result = await syncEngage(row.workspace_id, { deadline: started + budget });
      ran++;
      sent += result.automated;
    } catch (error) {
      console.error("[engage] automation sweep failed", row.workspace_id, error);
    }
  };
  // A few brands at a time: each one mostly waits on Meta and the model, so
  // this serves many brands a minute without one slow brand holding the rest.
  const queue = [...due];
  const lanes = Array.from({ length: Math.min(SWEEP_LANES, queue.length) }, async () => {
    for (let row = queue.shift(); row; row = queue.shift()) {
      if (Date.now() - started > budget) return;
      await one(row);
    }
  });
  await Promise.all(lanes);
  return { due: due.length, ran, sent };
}

/** The team's instructions on a Mox rule, for "Draft with Mox". */
export async function ruleGuidance(workspaceId: string, ruleId: string): Promise<string | null> {
  const { data } = await db
    .from("engage_rules")
    .select("reply_mode,mox_guidance")
    .eq("workspace_id", workspaceId)
    .eq("id", ruleId)
    .maybeSingle();
  const row = data as { reply_mode: string; mox_guidance: string | null } | null;
  return row?.reply_mode === "mox" ? row.mox_guidance : null;
}
