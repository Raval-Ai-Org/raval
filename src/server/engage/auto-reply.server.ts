// auto-reply.server.ts — Inbox auto-reply: Mox answers new comments by itself.
//
//   * Runs after the quick replies on every read (`syncEngage`, from the
//     existing run-schedules sweep or Refresh). A comment a quick reply
//     matched is left to it.
//   * Each comment is claimed once (`mox_checked`, compare-and-set) and Mox
//     decides (`decideEngageReply`, route engage.auto); what happens is pure
//     (`autoOutcome`): send within the hourly cap, ask the team, hold for a
//     person with a draft, or skip.
//   * A missing fact becomes one open question (`engage_questions`, one per
//     fingerprint). The team's answer — in the Inbox or in chat — is kept as
//     an answer Mox uses from then on, and every comment that waited is read
//     again on the next sweep (or straight away).
//   * Only comments written after auto-reply was turned on are answered.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { recordAudit } from "@/server/audit.server";
import { HttpError } from "@/server/http-error";
import { runWithScope } from "@/server/request-context";
import {
  AUTO_REPLY_PER_RUN,
  addGuideline,
  autoOutcome,
  questionFingerprint,
  tidyGuidelines,
} from "@/lib/engage/auto-reply";
import { AUTO_SENDS_PER_HOUR } from "@/lib/engage/rules";
import { COMMENT_COLUMNS, deliverReply, type CommentDbRow } from "./service.server";

const db = supabaseAdmin as unknown as SupabaseClient;

type Settings = { auto_reply: boolean; auto_reply_since: string; guidelines: string };

async function settingsFor(workspaceId: string): Promise<Settings | null> {
  const { data } = await db
    .from("engage_settings")
    .select("auto_reply,auto_reply_since,guidelines")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  return (data as Settings | null) ?? null;
}

async function ensureSettings(workspaceId: string) {
  await db
    .from("engage_settings")
    .upsert({ workspace_id: workspaceId }, { onConflict: "workspace_id", ignoreDuplicates: true });
}

/** How long Mox keeps retrying a comment when the AI service itself failed. */
const RETRY_WINDOW_MS = 6 * 60 * 60 * 1000;

const note = (text: string) => text.replace(/\s+/g, " ").trim().slice(0, 300);

/** Answer, ask about or set aside every new comment no quick reply took. */
export async function runAutoReply(
  workspaceId: string,
  opts: { deadline?: number } = {},
): Promise<{ replied: number; asked: number; held: number }> {
  const settings = await settingsFor(workspaceId);
  const out = { replied: 0, asked: 0, held: 0 };
  if (!settings?.auto_reply) return out;
  const { data: rows } = await db
    .from("engage_comments")
    .select(COMMENT_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("mox_checked", false)
    .eq("rules_checked", true)
    .in("status", ["new", "drafted"])
    .gte("commented_at", settings.auto_reply_since)
    .order("commented_at")
    .limit(AUTO_REPLY_PER_RUN);
  const comments = (rows ?? []) as CommentDbRow[];
  if (!comments.length) return out;
  const { decideEngageReply } = await import("./reply.server");

  for (const c of comments) {
    // Never claim a comment the run may not finish: a cut-off run would leave
    // it checked with nothing done. The next sweep takes the rest.
    if (opts.deadline && Date.now() > opts.deadline) break;
    const { data: claimed } = await db
      .from("engage_comments")
      .update({ mox_checked: true })
      .eq("workspace_id", workspaceId)
      .eq("id", c.id)
      .eq("mox_checked", false)
      .select("id");
    if (!claimed?.length) continue;
    // A quick reply handled this one (or a person is already on it).
    if (c.rule_id || c.status !== "new") continue;

    let outcome: ReturnType<typeof autoOutcome>;
    try {
      const decided = await runWithScope({ workspaceId, route: "engage.auto" }, () =>
        decideEngageReply({
          workspaceId,
          platform: c.platform,
          kind: c.kind,
          comment: { body: c.body, authorName: c.author_name, postCaption: c.post_caption },
        }),
      );
      outcome = autoOutcome(decided.decision, decided.finished);
      if (outcome.kind === "send") {
        const { data: allowed } = await db.rpc("engage_take_send", {
          p_workspace: workspaceId,
          p_cap: AUTO_SENDS_PER_HOUR,
        });
        if (allowed !== true)
          outcome = {
            kind: "hold",
            draft: outcome.text,
            note: `This hour's ${AUTO_SENDS_PER_HOUR} automatic replies are used. Check it and send.`,
          };
        else {
          const sent = await deliverReply({
            workspaceId,
            commentId: c.id,
            text: outcome.text,
            userId: null,
            brandDomain: decided.brandDomain,
          });
          await db
            .from("engage_comments")
            .update({
              mox_state: sent.status === "replied" ? "replied" : "needs_person",
              mox_note: sent.status === "replied" ? null : "Meta didn't confirm the reply.",
            })
            .eq("workspace_id", workspaceId)
            .eq("id", c.id);
          if (sent.status === "replied") out.replied++;
          continue;
        }
      }
    } catch (error) {
      // Mox couldn't think (the AI service was down or out of balance): that
      // says nothing about the comment, so let the next sweep try again while
      // it's fresh instead of leaving it for a person.
      const fresh = Date.now() - Date.parse(c.commented_at) < RETRY_WINDOW_MS;
      if (fresh) {
        await db
          .from("engage_comments")
          .update({ mox_checked: false, mox_note: "Mox will try again in a few minutes." })
          .eq("workspace_id", workspaceId)
          .eq("id", c.id);
        continue;
      }
      const message = error instanceof Error ? error.message : "Mox couldn't answer this one.";
      outcome = { kind: "hold", draft: null, note: message };
    }

    if (outcome.kind === "ask") {
      const questionId = await askTeam(workspaceId, outcome.question, c.body);
      await db
        .from("engage_comments")
        .update({
          mox_state: "waiting_info",
          mox_note: note(outcome.question),
          question_id: questionId,
        })
        .eq("workspace_id", workspaceId)
        .eq("id", c.id);
      out.asked++;
    } else if (outcome.kind === "hold") {
      await db
        .from("engage_comments")
        .update({
          mox_state: "needs_person",
          mox_note: note(outcome.note),
          ...(outcome.draft
            ? { draft: outcome.draft, drafted_at: new Date().toISOString(), status: "drafted" }
            : {}),
        })
        .eq("workspace_id", workspaceId)
        .eq("id", c.id)
        .in("status", ["new", "drafted"]);
      out.held++;
    } else if (outcome.kind === "skip") {
      await db
        .from("engage_comments")
        .update({ mox_state: "skipped", mox_note: note(outcome.note) })
        .eq("workspace_id", workspaceId)
        .eq("id", c.id);
    }
  }
  return out;
}

/** One open question per fingerprint; a repeat only counts up. */
async function askTeam(workspaceId: string, question: string, example: string) {
  const fingerprint = questionFingerprint(question);
  const { data: open } = await db
    .from("engage_questions")
    .select("id,asked_count")
    .eq("workspace_id", workspaceId)
    .eq("fingerprint", fingerprint)
    .eq("status", "open")
    .maybeSingle();
  const row = open as { id: string; asked_count: number } | null;
  if (row) {
    await db
      .from("engage_questions")
      .update({ asked_count: row.asked_count + 1 })
      .eq("id", row.id);
    return row.id;
  }
  const { data, error } = await db
    .from("engage_questions")
    .insert({
      workspace_id: workspaceId,
      question: question.slice(0, 300),
      fingerprint,
      example_comment: example.slice(0, 500),
    })
    .select("id")
    .single();
  if (error) {
    // Another sweep asked the same thing a moment ago.
    const { data: again } = await db
      .from("engage_questions")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("fingerprint", fingerprint)
      .eq("status", "open")
      .maybeSingle();
    return (again as { id: string } | null)?.id ?? null;
  }
  return (data as { id: string }).id;
}

/**
 * Comments that waited for a fact are read again: on the next sweep, or now
 * when the caller runs `runAutoReply`.
 */
export async function retryWaiting(workspaceId: string, questionId?: string) {
  let q = db
    .from("engage_comments")
    .update({ mox_checked: false, mox_state: "none", mox_note: null })
    .eq("workspace_id", workspaceId)
    .eq("mox_state", "waiting_info")
    .eq("status", "new");
  if (questionId) q = q.eq("question_id", questionId);
  await q;
}

/** The team answered what Mox asked: Mox keeps it and answers who waited. */
export async function answerQuestion(args: {
  workspaceId: string;
  userId: string;
  questionId: string;
  answer: string;
}) {
  const { data } = await db
    .from("engage_questions")
    .select("id,question,status")
    .eq("workspace_id", args.workspaceId)
    .eq("id", args.questionId)
    .maybeSingle();
  const row = data as { id: string; question: string; status: string } | null;
  if (!row) throw new HttpError(404, "That question isn't here any more.");
  if (row.status !== "open") throw new HttpError(409, "That question was already answered.");
  const { saveAnswer } = await import("./automations.server");
  const knowledgeId = await saveAnswer({
    workspaceId: args.workspaceId,
    userId: args.userId,
    question: row.question,
    answer: args.answer,
  });
  await db
    .from("engage_questions")
    .update({
      status: "answered",
      answer: args.answer.slice(0, 1_500),
      knowledge_id: knowledgeId,
      answered_by: args.userId,
      answered_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .eq("status", "open");
  await retryWaiting(args.workspaceId, row.id);
  await recordAudit({
    workspaceId: args.workspaceId,
    userId: args.userId,
    action: "engage.question.answered",
    entity: `engage_questions:${row.id}`,
    payload: {},
  });
  return { question: row.question };
}

export async function dismissQuestion(workspaceId: string, questionId: string) {
  await db
    .from("engage_questions")
    .update({ status: "dismissed" })
    .eq("workspace_id", workspaceId)
    .eq("id", questionId)
    .eq("status", "open");
  // The comments it held now wait for a person instead.
  await db
    .from("engage_comments")
    .update({ mox_state: "needs_person", mox_note: "You skipped Mox's question." })
    .eq("workspace_id", workspaceId)
    .eq("question_id", questionId)
    .eq("mox_state", "waiting_info");
}

export async function setAutoReply(workspaceId: string, userId: string, on: boolean) {
  await ensureSettings(workspaceId);
  const before = await settingsFor(workspaceId);
  await db
    .from("engage_settings")
    .update({
      auto_reply: on,
      // Turning it on answers from now, never the backlog.
      ...(on && !before?.auto_reply ? { auto_reply_since: new Date().toISOString() } : {}),
      next_sync_at: new Date().toISOString(),
    })
    .eq("workspace_id", workspaceId);
  await recordAudit({
    workspaceId,
    userId,
    action: on ? "engage.auto_reply.on" : "engage.auto_reply.off",
    entity: `engage_settings:${workspaceId}`,
    payload: {},
  });
}

/** Replace the team's rules for every reply. */
export async function setGuidelines(workspaceId: string, userId: string, text: string) {
  await ensureSettings(workspaceId);
  const guidelines = tidyGuidelines(text);
  await db.from("engage_settings").update({ guidelines }).eq("workspace_id", workspaceId);
  await retryWaiting(workspaceId);
  await recordAudit({
    workspaceId,
    userId,
    action: "engage.guidelines.saved",
    entity: `engage_settings:${workspaceId}`,
    payload: { chars: guidelines.length },
  });
  return guidelines;
}

/** Add one rule (from chat), keeping the rest. */
export async function addGuidelineLine(workspaceId: string, userId: string, line: string) {
  const current = (await settingsFor(workspaceId))?.guidelines ?? "";
  return setGuidelines(workspaceId, userId, addGuideline(current, line));
}

/** Open questions, for chat. */
export async function openQuestions(workspaceId: string) {
  const { data } = await db
    .from("engage_questions")
    .select("id,question,asked_count")
    .eq("workspace_id", workspaceId)
    .eq("status", "open")
    .order("asked_count", { ascending: false })
    .limit(10);
  return (data ?? []) as { id: string; question: string; asked_count: number }[];
}
