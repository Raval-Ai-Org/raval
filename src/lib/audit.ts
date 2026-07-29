import { supabase } from "@/integrations/supabase/client";

export type AuditAction =
  | "approve"
  | "reject"
  | "approve_bulk"
  | "reject_bulk"
  | "undo_bulk"
  | "draft_week"
  | "draft_generate"
  | "skip";

/**
 * Fire-and-forget audit logger. Never throws — audit failures must not
 * block the user's action. Records who did what, when, in which workspace.
 */
export async function logAudit(
  workspaceId: string,
  action: AuditAction | string,
  entity?: string | null,
  payload: Record<string, unknown> = {},
): Promise<void> {
  if (!workspaceId) return;
  try {
    await supabase.rpc("log_audit", {
      _workspace_id: workspaceId,
      _action: action,
      _entity: entity ?? undefined,
      _payload: payload as never,
    });
  } catch {
    // Swallow: audit is best-effort.
  }
}

/** Log the same action across many workspaces (e.g. bulk cross-client approve). */
export async function logAuditMany(
  workspaceIds: string[],
  action: AuditAction | string,
  entity?: string | null,
  payload: Record<string, unknown> = {},
): Promise<void> {
  const unique = Array.from(new Set(workspaceIds.filter(Boolean)));
  await Promise.all(unique.map((w) => logAudit(w, action, entity, payload)));
}
