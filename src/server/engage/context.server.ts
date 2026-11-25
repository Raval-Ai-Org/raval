// context.server.ts — what chat knows about the Inbox auto-reply, read on the
// server for the verified workspace id: whether it is on, the team's rules,
// how many answers Mox has, and what Mox is waiting to learn. Chat asks the
// person those questions and saves their answer with `teach_auto_reply`.
// Null when the Inbox is off or Instagram/Facebook isn't connected. Never throws.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { wrapUntrusted } from "@/server/guardrails/untrusted";

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
