// actions.server.ts — the buttons a chat reply offers (ADR-0033).
//
// A model never changes anything. When it asks for a change, the exact request
// is stored here (`offered`) and shown as a button. A click runs it as the
// person who clicked: their role is checked again, and the tool calls the same
// server function the app calls, so plan, credits and approval rules apply
// exactly as they do in the app (posting still needs an approved piece).
//
// One click, one run: only an `offered` row can move to `running`, and that
// move is a compare-and-set. A finished row answers every later click with the
// stored result. A failed row stays failed; asking again makes a new button,
// so nothing with an unknown outcome is ever retried blindly.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { ChatActionView } from "@/lib/chat/events";
import { recordAudit } from "@/server/audit.server";
import { HttpError } from "@/server/http-error";
import { toMcpError } from "@/server/mcp/errors.server";
import { asObject, cleanOutput, type McpTool } from "@/server/mcp/tool";
import { runWithScope } from "@/server/request-context";
import {
  chatActionTool,
  describeAction,
  roleAtLeast,
  toMcpCaller,
  type ChatToolCaller,
} from "./tools.server";

const db = supabaseAdmin as unknown as SupabaseClient;
const TABLE = "chat_actions";
const COLUMNS =
  "id, workspace_id, tool, args, title, detail, destructive, status, result, error, run_at, created_at";

/** A button older than this is out of date: the thing it names may have changed. */
const OFFER_TTL_MS = 24 * 3_600_000;
/** A run that never reported back (a restart mid-run) is called failed after this. */
const RUNNING_TTL_MS = 10 * 60_000;

type Row = {
  id: string;
  workspace_id: string;
  tool: string;
  args: Record<string, unknown> | null;
  title: string;
  detail: string;
  destructive: boolean;
  status: ChatActionView["state"];
  result: Record<string, unknown> | null;
  error: string | null;
  run_at: string | null;
  created_at: string;
};

function view(row: Row): ChatActionView {
  return {
    id: row.id,
    title: row.title,
    detail: row.detail,
    destructive: row.destructive,
    state: row.status,
    note: row.status === "failed" ? (row.error ?? undefined) : noteFor(row),
  };
}

/** A few plain words about what happened, from the stored result. */
function noteFor(row: Row): string | undefined {
  if (row.status !== "done") return undefined;
  const result = row.result ?? {};
  const message = [result.message, result.summary, result.note].find(
    (v): v is string => typeof v === "string" && v.trim().length > 0,
  );
  // No message: the "Done" on the button says it all.
  return message?.slice(0, 300);
}

/** Store a requested change and return the button for it. Nothing runs. */
export async function offerChatAction(
  caller: ChatToolCaller,
  tool: McpTool,
  args: Record<string, unknown>,
): Promise<ChatActionView> {
  const { data, error } = await db
    .from(TABLE)
    .insert({
      workspace_id: caller.workspaceId,
      conversation_id: caller.conversationId ?? null,
      tool: tool.name,
      args,
      title: tool.title.slice(0, 200),
      detail: describeAction(args),
      destructive: tool.destructive === true,
      offered_to: caller.userId,
    })
    .select(COLUMNS)
    .single();
  if (error || !data) throw new Error(`Could not prepare that action: ${error?.message}`);
  return view(data as Row);
}

async function read(workspaceId: string, id: string): Promise<Row | null> {
  const { data, error } = await db
    .from(TABLE)
    .select(COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Could not read that action: ${error.message}`);
  return (data as Row | null) ?? null;
}

async function finish(
  row: Row,
  patch: { status: "done" | "failed"; result?: unknown; error?: string },
): Promise<Row> {
  const { data, error } = await db
    .from(TABLE)
    .update({
      status: patch.status,
      result: patch.result ?? null,
      error: patch.error?.slice(0, 500) ?? null,
    })
    .eq("workspace_id", row.workspace_id)
    .eq("id", row.id)
    .eq("status", "running")
    .select(COLUMNS)
    .maybeSingle();
  if (error) console.error("[chat] could not store an action's outcome", row.id, error.message);
  return (data as Row | null) ?? { ...row, status: patch.status, error: patch.error ?? null };
}

/** Where the buttons under a stored reply stand now. */
export async function readChatActions(
  workspaceId: string,
  ids: string[],
): Promise<ChatActionView[]> {
  if (!ids.length) return [];
  const { data, error } = await db
    .from(TABLE)
    .select(COLUMNS)
    .eq("workspace_id", workspaceId)
    .in("id", ids.slice(0, 50));
  if (error) throw new Error(`Could not read those actions: ${error.message}`);
  return ((data ?? []) as Row[]).map((row) => view(row));
}

/** A person clicked the button. Runs once, as them. */
export async function runChatAction(caller: ChatToolCaller, id: string): Promise<ChatActionView> {
  const row = await read(caller.workspaceId, id);
  if (!row) throw new HttpError(404, "That action is no longer there.");

  if (row.status === "done" || row.status === "failed") return view(row);
  if (row.status === "running") {
    const startedAt = row.run_at ? Date.parse(row.run_at) : 0;
    if (Date.now() - startedAt < RUNNING_TTL_MS) return view(row);
    return view(
      await finish(row, {
        status: "failed",
        error: "This didn't finish. Check whether it happened before asking again.",
      }),
    );
  }

  const tool = chatActionTool(row.tool);
  if (!tool) throw new HttpError(400, "That action can't be run from chat.");
  if (!roleAtLeast(caller.role, tool.minRole)) {
    throw new HttpError(403, "Your role in this workspace can't do that.");
  }
  if (Date.now() - Date.parse(row.created_at) > OFFER_TTL_MS) {
    return { ...view(row), state: "failed", note: "This button is out of date. Ask again." };
  }

  // Only one click wins. Everyone else reads what that click did.
  const { data: claimed, error: claimError } = await db
    .from(TABLE)
    .update({ status: "running", run_by: caller.userId, run_at: new Date().toISOString() })
    .eq("workspace_id", caller.workspaceId)
    .eq("id", id)
    .eq("status", "offered")
    .select(COLUMNS)
    .maybeSingle();
  if (claimError) throw new Error(`Could not start that action: ${claimError.message}`);
  if (!claimed) {
    const current = await read(caller.workspaceId, id);
    if (!current) throw new HttpError(404, "That action is no longer there.");
    return view(current);
  }
  const running = claimed as Row;

  try {
    const args = { ...(running.args ?? {}), workspaceId: caller.workspaceId };
    const data = await runWithScope(
      { userId: caller.userId, workspaceId: caller.workspaceId },
      () =>
        tool.run(args, {
          caller: toMcpCaller(caller),
          workspaceId: caller.workspaceId,
          role: caller.role,
        }),
    );
    const done = await finish(running, { status: "done", result: asObject(cleanOutput(data)) });
    await recordAudit({
      workspaceId: caller.workspaceId,
      userId: caller.userId,
      action: `chat.${tool.name}`,
      entity: running.id,
      payload: { tool: tool.name, detail: running.detail },
    });
    return view(done);
  } catch (error) {
    const { message } = toMcpError(error);
    return view(await finish(running, { status: "failed", error: message }));
  }
}
