// audit.server.ts — the platform audit trail (public.admin_audit_log).
//
// Changes are audited by the database function that makes them, in the same
// transaction (see the admin migration), so a change cannot exist without its
// row. This file covers the rest: refused attempts, and request context.
// Payloads are scrubbed with the same rule as workspace audit rows and never
// carry tokens, keys or message bodies.
import "server-only";
import { scrubAuditPayload } from "@/server/audit.server";
import { adminDb } from "./db.server";

export type AuditContext = {
  requestId: string;
  ip: string | null;
  userAgent: string | null;
};

export function auditContext(request: Request, requestId: string): AuditContext {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || request.headers.get("x-real-ip")?.trim() || null;
  const userAgent = request.headers.get("user-agent");
  return { requestId, ip, userAgent: userAgent ? userAgent.slice(0, 300) : null };
}

export type AdminAuditEntry = {
  actorUserId: string;
  actorRole: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  workspaceId?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  reason?: string;
  success?: boolean;
  error?: string;
};

/** Failure to write is logged, never thrown: the caller already has its answer. */
export async function recordAdminAudit(
  entry: AdminAuditEntry,
  context: AuditContext,
): Promise<void> {
  const { error } = await adminDb.from("admin_audit_log").insert({
    actor_user_id: entry.actorUserId,
    actor_role: entry.actorRole,
    action: entry.action,
    target_type: entry.targetType ?? null,
    target_id: entry.targetId ?? null,
    workspace_id: entry.workspaceId ?? null,
    before_state: entry.before ? scrubAuditPayload(entry.before) : null,
    after_state: entry.after ? scrubAuditPayload(entry.after) : null,
    reason: entry.reason?.slice(0, 500) ?? null,
    success: entry.success ?? true,
    error: entry.error?.slice(0, 500) ?? null,
    request_id: context.requestId,
    ip: context.ip?.slice(0, 64) ?? null,
    user_agent: context.userAgent,
  });
  if (error) console.error("[admin-audit] not recorded", entry.action, error.message);
}
