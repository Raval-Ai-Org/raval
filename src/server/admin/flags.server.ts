// Feature flags for the admin console: list them and save one. A save and its
// audit row are written together by admin_flag_save. Disabling is a save with
// enabled=false; flags are not deleted, so the history stays readable.
import "server-only";
import type { AdminFlag } from "@/lib/admin/types";
import { clearFlagCache, envFlagName } from "@/server/platform/flags.server";
import type { AuditContext } from "./audit.server";
import { adminDb, adminRpc, httpErrorFromPg } from "./db.server";

type Row = {
  key: string;
  description: string;
  enabled: boolean;
  rollout_percent: number;
  workspace_ids: string[] | null;
  expires_at: string | null;
  updated_at: string;
};

function envOverride(key: string): AdminFlag["envOverride"] {
  const value = process.env[envFlagName(key)]?.trim().toLowerCase();
  if (value === "true" || value === "1" || value === "yes") return "on";
  if (value === "false" || value === "0" || value === "no") return "off";
  return null;
}

export function flagState(
  row: Pick<Row, "enabled" | "rollout_percent" | "expires_at">,
  now = Date.now(),
): AdminFlag["state"] {
  if (row.expires_at && Date.parse(row.expires_at) <= now) return "expired";
  if (!row.enabled) return "off";
  return row.rollout_percent >= 100 ? "on" : "partial";
}

export async function listFlags(): Promise<AdminFlag[]> {
  const { data, error } = await adminDb
    .from("platform_flags")
    .select("key,description,enabled,rollout_percent,workspace_ids,expires_at,updated_at")
    .order("key", { ascending: true })
    .limit(500);
  if (error) throw httpErrorFromPg(error, "Could not read the flags.");
  return ((data ?? []) as Row[]).map((row) => ({
    key: row.key,
    description: row.description,
    enabled: row.enabled,
    rolloutPercent: row.rollout_percent,
    workspaceIds: row.workspace_ids ?? [],
    expiresAt: row.expires_at,
    updatedAt: row.updated_at,
    envOverride: envOverride(row.key),
    state: flagState(row),
  }));
}

export type FlagInput = {
  key: string;
  description: string;
  enabled: boolean;
  rolloutPercent: number;
  workspaceIds: string[];
  expiresAt: string | null;
  reason: string;
};

export async function saveFlag(
  actor: { actorId: string; actorRole: string; audit: AuditContext },
  input: FlagInput,
): Promise<{ key: string }> {
  const row = await adminRpc<{ key: string }>(
    "admin_flag_save",
    {
      p_actor: actor.actorId,
      p_actor_role: actor.actorRole,
      p_key: input.key,
      p_description: input.description,
      p_enabled: input.enabled,
      p_rollout: input.rolloutPercent,
      p_workspaces: input.workspaceIds,
      p_expires_at: input.expiresAt,
      p_reason: input.reason,
      p_request_id: actor.audit.requestId,
      p_ip: actor.audit.ip,
      p_user_agent: actor.audit.userAgent,
    },
    "Could not save the flag.",
  );
  clearFlagCache();
  return { key: row.key };
}
