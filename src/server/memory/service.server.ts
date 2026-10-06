// service.server.ts — a brand's memory (ADR-0033): reading it, changing it and
// the switch that turns it off. Callers (src/server/fns/memory.ts, the chat
// route) have already checked the workspace role; writes here use the service
// role for that one workspace. Every change from chat or the background reader
// is decided by applyMemoryOps (src/lib/memory/decide.ts), never by a model.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isMemoryEnabled } from "@/lib/feature-flags";
import {
  MEMORY_KINDS,
  MEMORY_LIMIT,
  MEMORY_TOPICS,
  type Memory,
  type MemoryChange,
  type MemoryKind,
  type MemoryOp,
  type MemorySource,
  type MemoryTopic,
  type MemoryView,
  type StoredMemory,
} from "@/lib/memory/contracts";
import { applyMemoryOps, expiryFor, isSensitive, type MemoryWrite } from "@/lib/memory/decide";
import { cleanMemoryText, fingerprintOf, isExpired } from "@/lib/memory/normalize";
import { recordAudit } from "@/server/audit.server";
import { detectInjection } from "@/server/guardrails/injection";
import { HttpError } from "@/server/http-error";
import type { WorkspaceRole } from "@/server/api-auth";
import { invalidateMemoryContext } from "./context.server";

const db = supabaseAdmin as unknown as SupabaseClient;
const TABLE = "workspace_memories";
const SETTINGS = "workspace_memory_settings";
const COLUMNS =
  "id, body, kind, topic, status, source, fingerprint, expires_at, created_at, updated_at";

export type MemoryCaller = { workspaceId: string; userId: string; role: WorkspaceRole };

type Row = {
  id: string;
  body: string;
  kind: MemoryKind;
  topic: MemoryTopic;
  status: "active" | "removed";
  source: MemorySource;
  fingerprint: string;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
};

const canEdit = (role: WorkspaceRole) => role !== "viewer";
const canManage = (role: WorkspaceRole) => role === "owner" || role === "admin";
const looksLikeInjection = (text: string) => detectInjection(text).length > 0;

function toStored(row: Row): StoredMemory {
  return {
    id: row.id,
    body: row.body,
    kind: row.kind,
    topic: row.topic,
    source: row.source,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: row.status,
    fingerprint: row.fingerprint,
  };
}

function toMemory({ status: _status, fingerprint: _fingerprint, ...memory }: StoredMemory): Memory {
  return memory;
}

export function assertMemoryEnabled(workspaceId: string): void {
  if (!isMemoryEnabled(workspaceId)) throw new HttpError(404, "Not found");
}

/** Every row, removed ones included: what the rules need to decide. */
async function readAll(workspaceId: string): Promise<StoredMemory[]> {
  const { data, error } = await db
    .from(TABLE)
    .select(COLUMNS)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) throw new Error(`Could not read memory: ${error.message}`);
  return ((data ?? []) as Row[]).map(toStored);
}

/** The brand's own switch. No row means on. */
export async function readEnabled(workspaceId: string): Promise<boolean> {
  const { data, error } = await db
    .from(SETTINGS)
    .select("enabled")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(`Could not read memory settings: ${error.message}`);
  return (data as { enabled: boolean } | null)?.enabled ?? true;
}

/** What generators read: active, not ended, and only while memory is on. */
export async function readActiveMemories(workspaceId: string): Promise<Memory[]> {
  if (!isMemoryEnabled(workspaceId)) return [];
  const [enabled, rows] = await Promise.all([readEnabled(workspaceId), readAll(workspaceId)]);
  if (!enabled) return [];
  const now = new Date();
  return rows
    .filter((m) => m.status === "active" && !isExpired(m.expiresAt, now))
    .slice(0, MEMORY_LIMIT)
    .map(toMemory);
}

export async function getMemoryView(caller: MemoryCaller): Promise<MemoryView> {
  const [enabled, rows] = await Promise.all([
    readEnabled(caller.workspaceId),
    readAll(caller.workspaceId),
  ]);
  const now = new Date();
  return {
    enabled,
    canEdit: canEdit(caller.role),
    canManage: canManage(caller.role),
    memories: rows
      .filter((m) => m.status === "active" && !isExpired(m.expiresAt, now))
      .map(toMemory),
    limit: MEMORY_LIMIT,
  };
}

function changed(caller: MemoryCaller, action: string, payload: Record<string, unknown>) {
  invalidateMemoryContext(caller.workspaceId);
  void recordAudit({
    workspaceId: caller.workspaceId,
    userId: caller.userId,
    action: `memory.${action}`,
    entity: "memory",
    payload,
  });
}

/** Run what the rules decided. Returns the ids of inserted rows, in order. */
async function runWrites(
  caller: MemoryCaller,
  writes: MemoryWrite[],
  meta: { source: MemorySource; conversationId?: string | null },
): Promise<string[]> {
  const inserted: string[] = [];
  const now = new Date().toISOString();
  for (const write of writes) {
    if (write.type === "insert") {
      const { data, error } = await db
        .from(TABLE)
        .insert({
          workspace_id: caller.workspaceId,
          body: write.body,
          kind: write.kind,
          topic: write.topic,
          fingerprint: write.fingerprint,
          expires_at: write.expiresAt,
          source: meta.source,
          conversation_id: meta.conversationId ?? null,
          created_by: caller.userId,
          updated_by: caller.userId,
        })
        .select("id")
        .maybeSingle();
      // 23505: the same memory arrived twice at once. The first one stands.
      if (error && error.code !== "23505") {
        throw new Error(`Could not save the memory: ${error.message}`);
      }
      inserted.push((data as { id: string } | null)?.id ?? "");
    } else if (write.type === "update") {
      const { error } = await db
        .from(TABLE)
        .update({
          body: write.body,
          fingerprint: write.fingerprint,
          status: "active",
          ...(write.kind ? { kind: write.kind } : {}),
          ...(write.topic ? { topic: write.topic } : {}),
          ...(write.expiresAt !== undefined ? { expires_at: write.expiresAt } : {}),
          updated_by: caller.userId,
          updated_at: now,
        })
        .eq("workspace_id", caller.workspaceId)
        .eq("id", write.id);
      if (error && error.code !== "23505") {
        throw new Error(`Could not save the memory: ${error.message}`);
      }
    } else {
      const { error } = await db
        .from(TABLE)
        .update({ status: "removed", updated_by: caller.userId, updated_at: now })
        .eq("workspace_id", caller.workspaceId)
        .eq("id", write.id);
      if (error) throw new Error(`Could not remove the memory: ${error.message}`);
    }
  }
  return inserted;
}

/**
 * Apply proposed changes (chat's memory tools, the background reader). Quietly
 * does nothing when memory is off or the person can't edit: a reply never
 * fails because of memory.
 */
export async function applyOps(
  caller: MemoryCaller,
  ops: MemoryOp[],
  meta: { source: MemorySource; conversationId?: string | null },
): Promise<MemoryChange[]> {
  if (!ops.length || !canEdit(caller.role) || !isMemoryEnabled(caller.workspaceId)) return [];
  if (!(await readEnabled(caller.workspaceId))) return [];
  const decision = applyMemoryOps(await readAll(caller.workspaceId), ops, {
    now: new Date(),
    source: meta.source,
    refuse: looksLikeInjection,
  });
  if (!decision.writes.length) return [];
  const inserted = await runWrites(caller, decision.writes, meta);
  let next = 0;
  const changes = decision.changes
    .map((change) => (change.id ? change : { ...change, id: inserted[next++] ?? "" }))
    .filter((change) => change.id);
  if (changes.length) changed(caller, "chat", { changes: changes.map((c) => [c.op, c.id]) });
  return changes;
}

export type MemoryInput = {
  body: string;
  kind?: MemoryKind;
  topic?: MemoryTopic;
  /** Hours it should last; null or absent keeps it until removed. */
  hours?: number | null;
};

function checkedBody(raw: string): string {
  const body = cleanMemoryText(raw);
  if (body.length < 3) throw new HttpError(400, "Write a few words to remember.");
  if (isSensitive(body) || looksLikeInjection(body)) {
    throw new HttpError(400, "Mellox doesn't keep passwords, card numbers or private details.");
  }
  return body;
}

/** A person adds a memory by hand. */
export async function addMemory(caller: MemoryCaller, input: MemoryInput): Promise<void> {
  const body = checkedBody(input.body);
  const decision = applyMemoryOps(
    await readAll(caller.workspaceId),
    [
      {
        op: "add",
        text: body,
        kind: input.kind,
        topic: input.topic,
        lasts: input.hours ? "hours" : "always",
        hours: input.hours ?? undefined,
      },
    ],
    { now: new Date(), source: "manual" },
  );
  const refusal = decision.refused[0]?.reason;
  if (refusal === "duplicate") throw new HttpError(409, "That's already in memory.");
  if (refusal === "full") {
    throw new HttpError(409, `Memory is full (${MEMORY_LIMIT}). Remove something first.`);
  }
  if (!decision.writes.length) throw new HttpError(400, "That couldn't be saved.");
  await runWrites(caller, decision.writes, { source: "manual" });
  changed(caller, "add", {});
}

export type MemoryEdit = {
  id: string;
  body?: string;
  kind?: MemoryKind;
  topic?: MemoryTopic;
  /** null keeps it until removed; a number makes it last that many hours. */
  hours?: number | null;
};

export async function editMemory(
  caller: MemoryCaller,
  edit: MemoryEdit,
  retried = false,
): Promise<void> {
  const rows = await readAll(caller.workspaceId);
  const row = rows.find((m) => m.id === edit.id && m.status === "active");
  if (!row) throw new HttpError(404, "That memory is no longer there.");
  const body = edit.body === undefined ? row.body : checkedBody(edit.body);
  const fingerprint = fingerprintOf(body);
  if (rows.some((m) => m.id !== row.id && m.fingerprint === fingerprint && m.status === "active")) {
    throw new HttpError(409, "That's already in memory.");
  }
  const kind = MEMORY_KINDS.includes(edit.kind as MemoryKind) ? edit.kind : undefined;
  const topic = MEMORY_TOPICS.includes(edit.topic as MemoryTopic) ? edit.topic : undefined;
  const { error } = await db
    .from(TABLE)
    .update({
      body,
      fingerprint,
      ...(kind ? { kind } : {}),
      ...(topic ? { topic } : {}),
      ...(edit.hours === undefined
        ? {}
        : { expires_at: edit.hours === null ? null : expiryFor(edit.hours, new Date()) }),
      updated_by: caller.userId,
      updated_at: new Date().toISOString(),
    })
    .eq("workspace_id", caller.workspaceId)
    .eq("id", row.id);
  // A removed row with the same words is in the way: it gives up its place.
  if (error?.code === "23505" && !retried) {
    await db
      .from(TABLE)
      .delete()
      .eq("workspace_id", caller.workspaceId)
      .eq("fingerprint", fingerprint)
      .eq("status", "removed");
    return editMemory(caller, edit, true);
  }
  if (error) throw new Error(`Could not save the memory: ${error.message}`);
  changed(caller, "edit", { id: row.id });
}

async function setStatus(caller: MemoryCaller, id: string, status: "active" | "removed") {
  const { data, error } = await db
    .from(TABLE)
    .update({ status, updated_by: caller.userId, updated_at: new Date().toISOString() })
    .eq("workspace_id", caller.workspaceId)
    .eq("id", id)
    .select("id");
  if (error) throw new Error(`Could not update the memory: ${error.message}`);
  if (!data?.length) throw new HttpError(404, "That memory is no longer there.");
  changed(caller, status === "removed" ? "remove" : "restore", { id });
}

export const removeMemory = (caller: MemoryCaller, id: string) => setStatus(caller, id, "removed");
/** Undo for a removal. */
export const restoreMemory = (caller: MemoryCaller, id: string) => setStatus(caller, id, "active");

/** Remove everything. Rows stay as markers so the background reader starts clean. */
export async function clearMemories(caller: MemoryCaller): Promise<void> {
  const { error } = await db
    .from(TABLE)
    .update({ status: "removed", updated_by: caller.userId, updated_at: new Date().toISOString() })
    .eq("workspace_id", caller.workspaceId)
    .eq("status", "active");
  if (error) throw new Error(`Could not clear memory: ${error.message}`);
  changed(caller, "clear", {});
}

export async function setEnabled(caller: MemoryCaller, enabled: boolean): Promise<void> {
  const { error } = await db.from(SETTINGS).upsert(
    {
      workspace_id: caller.workspaceId,
      enabled,
      updated_by: caller.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "workspace_id" },
  );
  if (error) throw new Error(`Could not save the setting: ${error.message}`);
  changed(caller, enabled ? "on" : "off", {});
}

/** Temporary memories that have ended. Called from the run-schedules hook. */
export async function purgeExpiredMemories(): Promise<number> {
  const { data, error } = await db
    .from(TABLE)
    .delete()
    .lt("expires_at", new Date().toISOString())
    .select("workspace_id");
  if (error) throw new Error(`Could not clear ended memories: ${error.message}`);
  const rows = (data ?? []) as { workspace_id: string }[];
  for (const workspaceId of new Set(rows.map((r) => r.workspace_id))) {
    invalidateMemoryContext(workspaceId);
  }
  return rows.length;
}
