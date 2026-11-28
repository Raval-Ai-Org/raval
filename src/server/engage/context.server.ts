// context.server.ts — what chat knows about the Inbox auto-reply, read on the
// server for the verified workspace id: whether it is on, the team's rules,
// how many answers Mox has, and what Mox is waiting to learn. Chat asks the
// person those questions and saves their answer with `teach_auto_reply`.
// Null when the Inbox is off or Instagram/Facebook isn't connected. Never throws.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { wrapUntrusted } from "@/server/guardrails/untrusted";
import {
  customerVoice,
  customerVoiceBlock,
  type CustomerVoice,
  type VoiceQuestion,
} from "@/lib/engage/customer-voice";

const db = supabaseAdmin as unknown as SupabaseClient;

export async function inboxBlockFor(workspaceId: string): Promise<string | null> {
  try {
    const { isEngageEnabled } = await import("@/lib/feature-flags");
    if (!isEngageEnabled(workspaceId)) return null;
    const [conn, settings, answers, questions] = await Promise.all([
      db
        .from("workspace_connections")
        .select("status")
        .eq("workspace_id", workspaceId)
        .eq("provider", "meta")
        .neq("status", "revoked")
        .maybeSingle(),
      db
        .from("engage_settings")
        .select("auto_reply,guidelines")
        .eq("workspace_id", workspaceId)
        .maybeSingle(),
      db
        .from("engage_knowledge")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId),
      db
        .from("engage_questions")
        .select("id,question,asked_count")
        .eq("workspace_id", workspaceId)
        .eq("status", "open")
        .order("asked_count", { ascending: false })
        .limit(5),
    ]);
    if (!conn.data) return null;
    const s = settings.data as { auto_reply: boolean; guidelines: string } | null;
    const open = (questions.data ?? []) as { id: string; question: string; asked_count: number }[];
    const lines = [
      "## Comment auto-reply (Inbox)",
      `Mox ${s?.auto_reply === false ? "does NOT" : "DOES"} answer Instagram and Facebook comments by itself. It knows ${answers.count ?? 0} answers the team taught it.`,
      s?.guidelines
        ? `The team's rules for every reply:\n${s.guidelines.slice(0, 1_500)}`
        : "The team hasn't given rules for replies yet.",
      "When the person tells you how comments should be answered, or gives a fact customers ask about (prices, delivery, hours, stock, policies), save it with teach_auto_reply right away and say so in a few words.",
    ];
    if (open.length) {
      lines.push(
        "Mox is waiting for the team to answer these before it can reply to some comments. If the person isn't busy with something urgent, ask the first one in one short line at the end of your reply (once per conversation, never invent the answer). When they answer, call teach_auto_reply with its questionId.",
        wrapUntrusted(
          "mox-open-questions",
          open
            .map(
              (q) =>
                `[${q.id}] ${q.question}${q.asked_count > 1 ? ` (asked by ${q.asked_count} people)` : ""}`,
            )
            .join("\n"),
          { maxChars: 2_000, route: "chat" },
        ),
      );
    }
    return lines.join("\n");
  } catch (error) {
    console.error("[chat] inbox block failed, answering without it", error);
    return null;
  }
}

// ── What customers ask (the customer brain) ─────────────────────────────────
// Read from the brand's own Inbox, for the verified workspace id. Studio,
// Autopilot's plan and the Home card read it; cached a minute; never throws.

const VOICE_TTL_MS = 60_000;
const VOICE_WINDOW_DAYS = 60;
const voiceCache = new Map<string, { at: number; voice: CustomerVoice }>();

export async function customerVoiceFor(workspaceId: string): Promise<CustomerVoice | null> {
  const hit = voiceCache.get(workspaceId);
  if (hit && Date.now() - hit.at < VOICE_TTL_MS) return hit.voice;
  try {
    const { isEngageEnabled } = await import("@/lib/feature-flags");
    if (!isEngageEnabled(workspaceId)) return null;
    const since = new Date(Date.now() - VOICE_WINDOW_DAYS * 86_400_000).toISOString();
    const [questions, comments] = await Promise.all([
      db
        .from("engage_questions")
        .select("question,asked_count,status,answer")
        .eq("workspace_id", workspaceId)
        .neq("status", "dismissed")
        .gte("updated_at", since)
        .order("asked_count", { ascending: false })
        .limit(30),
      db
        .from("engage_comments")
        .select("body,kind,mox_state")
        .eq("workspace_id", workspaceId)
        .gte("commented_at", since)
        .order("commented_at", { ascending: false })
        .limit(300),
    ]);
    const voice = customerVoice(
      (
        (questions.data ?? []) as {
          question: string;
          asked_count: number;
          status: VoiceQuestion["status"];
          answer: string | null;
        }[]
      ).map((r) => ({
        question: r.question,
        askedCount: r.asked_count,
        status: r.status,
        answer: r.answer,
      })),
      (
        (comments.data ?? []) as { body: string; kind: string | null; mox_state: string | null }[]
      ).map((r) => ({
        body: r.body ?? "",
        kind: r.kind === "dm" ? "dm" : "comment",
        moxState: r.mox_state ?? "none",
      })),
    );
    voiceCache.set(workspaceId, { at: Date.now(), voice });
    return voice;
  } catch (error) {
    console.warn(
      "[engage] customer voice unavailable",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/** The block generators read; customers' words are fenced as untrusted. "" when empty. */
export async function customerVoiceBlockFor(
  workspaceId: string,
  route = "studio",
): Promise<string> {
  const voice = await customerVoiceFor(workspaceId);
  const block = voice ? customerVoiceBlock(voice) : "";
  if (!block) return "";
  const [head, rule, ...rest] = block.split("\n");
  return [
    head,
    rule,
    wrapUntrusted("customer-questions", rest.join("\n"), { maxChars: 1_600, route }),
  ]
    .filter(Boolean)
    .join("\n");
}
