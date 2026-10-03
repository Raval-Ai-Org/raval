// Per-workspace MCP settings and the record of tool calls (migration
// 20261005090000_mcp.sql). Service role: every caller here has already been
// verified as a member (or admin, for changes) of the workspace it names.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { recordAudit, scrubAuditPayload } from "@/server/audit.server";

const db = supabaseAdmin as unknown as SupabaseClient;

export type McpSettings = {
  enabled: boolean;
  /** When false an assistant can read but not change anything. */
  allowWrites: boolean;
  updatedAt: string | null;
};

const OFF: McpSettings = { enabled: false, allowWrites: false, updatedAt: null };

type SettingsRow = {
  workspace_id: string;
  enabled: boolean;
  allow_writes: boolean;
  updated_at: string;
};

function present(row: SettingsRow | null): McpSettings {
  if (!row) return OFF;
  return {
    enabled: row.enabled,
    // "Allow changes" means nothing while the workspace is off.
    allowWrites: row.enabled && row.allow_writes,
    updatedAt: row.updated_at,
  };
}

/** No row means off. */
export async function getMcpSettings(workspaceId: string): Promise<McpSettings> {
  const { data, error } = await db
    .from("mcp_workspace_settings")
    .select("workspace_id, enabled, allow_writes, updated_at")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return present(data as SettingsRow | null);
}

export async function getMcpSettingsFor(workspaceIds: string[]): Promise<Map<string, McpSettings>> {
  const out = new Map<string, McpSettings>();
  if (!workspaceIds.length) return out;
  const { data, error } = await db
    .from("mcp_workspace_settings")
    .select("workspace_id, enabled, allow_writes, updated_at")
    .in("workspace_id", workspaceIds);
  if (error) throw new Error(error.message);
  for (const row of (data ?? []) as SettingsRow[]) out.set(row.workspace_id, present(row));
  return out;
}

/** The caller must already be verified as an admin of the workspace. */
export async function updateMcpSettings(args: {
  workspaceId: string;
  userId: string;
  enabled: boolean;
  allowWrites: boolean;
}): Promise<McpSettings> {
  const { data, error } = await db
    .from("mcp_workspace_settings")
    .upsert(
      {
        workspace_id: args.workspaceId,
        enabled: args.enabled,
        allow_writes: args.enabled && args.allowWrites,
        updated_by: args.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id" },
    )
    .select("workspace_id, enabled, allow_writes, updated_at")
    .single();
  if (error) throw new Error(error.message);
  const settings = present(data as SettingsRow);
  await recordAudit({
    workspaceId: args.workspaceId,
    userId: args.userId,
    action: "mcp.settings_changed",
    entity: args.workspaceId,
    payload: { enabled: settings.enabled, allowWrites: settings.allowWrites },
  });
  return settings;
}

export type McpCallRecord = {
  workspaceId: string | null;
  userId: string;
  clientId: string | null;
  tool: string;
  isWrite: boolean;
  ok: boolean;
  errorCode: string | null;
  durationMs: number;
  summary: Record<string, unknown>;
};

/** Never throws: the call already happened and must not fail on its record. */
export async function recordToolCall(entry: McpCallRecord): Promise<void> {
  try {
    const { error } = await db.from("mcp_tool_calls").insert({
      workspace_id: entry.workspaceId,
      user_id: entry.userId,
      client_id: entry.clientId,
      tool: entry.tool,
      is_write: entry.isWrite,
      ok: entry.ok,
      error_code: entry.errorCode,
      duration_ms: Math.max(0, Math.round(entry.durationMs)),
      summary: scrubAuditPayload(entry.summary),
    });
    if (error) console.error("[mcp] call not recorded", entry.tool, error.message);
  } catch (error) {
    console.error("[mcp] call not recorded", entry.tool, error);
  }
}

export type McpActivityItem = {
  id: string;
  tool: string;
  isWrite: boolean;
  ok: boolean;
  errorCode: string | null;
  createdAt: string;
};

export async function listMcpActivity(workspaceId: string, limit = 20): Promise<McpActivityItem[]> {
  const { data, error } = await db
    .from("mcp_tool_calls")
    .select("id, tool, is_write, ok, error_code, created_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    tool: String(row.tool),
    isWrite: Boolean(row.is_write),
    ok: Boolean(row.ok),
    errorCode: typeof row.error_code === "string" ? row.error_code : null,
    createdAt: String(row.created_at),
  }));
}
