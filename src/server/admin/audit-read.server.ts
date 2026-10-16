// Reading the platform audit trail. Rows come back newest first; actor emails
// are looked up in one batch and shown unmasked only to admins who may see
// personal data.
import "server-only";
import { maskEmail } from "@/lib/admin/permissions";
import type { AdminAuditRow, Paged } from "@/lib/admin/types";
import { adminDb, httpErrorFromPg } from "./db.server";

export type AuditFilter = {
  actor?: string;
  action?: string;
  targetType?: string;
  targetId?: string;
  from?: string;
  to?: string;
  failedOnly?: boolean;
  page: number;
  pageSize: number;
};

type AuditDbRow = {
  id: string;
  created_at: string;
  actor_user_id: string | null;
  actor_role: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  workspace_id: string | null;
  before_state: Record<string, unknown> | null;
  after_state: Record<string, unknown> | null;
  reason: string | null;
  success: boolean;
  error: string | null;
  request_id: string | null;
  ip: string | null;
};

const COLUMNS =
  "id,created_at,actor_user_id,actor_role,action,target_type,target_id,workspace_id,before_state,after_state,reason,success,error,request_id,ip";

/** Emails for up to 100 user ids in one call. */
export async function emailsFor(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(ids)].slice(0, 100);
  if (!unique.length) return out;
  const { data, error } = await adminDb.rpc("admin_emails_for", { p_ids: unique });
  if (error) throw httpErrorFromPg(error, "Could not look up names.");
  for (const row of (data ?? []) as Array<{ id: string; email: string | null }>) {
    if (row.email) out.set(row.id, row.email);
  }
  return out;
}

export function showEmail(email: string | null | undefined, pii: boolean): string | null {
  if (!email) return null;
  return pii ? email : maskEmail(email);
}

function mapAuditRows(
  rows: AuditDbRow[],
  emails: Map<string, string>,
  pii: boolean,
): AdminAuditRow[] {
  return rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    actorUserId: row.actor_user_id,
    actorEmail: showEmail(row.actor_user_id ? emails.get(row.actor_user_id) : null, pii),
    actorRole: row.actor_role,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    workspaceId: row.workspace_id,
    before: row.before_state,
    after: row.after_state,
    reason: row.reason,
    success: row.success,
    error: row.error,
    requestId: row.request_id,
    ip: pii ? row.ip : null,
  }));
}

async function withActors(rows: AuditDbRow[], pii: boolean): Promise<AdminAuditRow[]> {
  const emails = await emailsFor(rows.map((r) => r.actor_user_id).filter((v): v is string => !!v));
  return mapAuditRows(rows, emails, pii);
}

export async function listAudit(filter: AuditFilter, pii: boolean): Promise<Paged<AdminAuditRow>> {
  let query = adminDb.from("admin_audit_log").select(COLUMNS, { count: "exact" });
  if (filter.actor) query = query.eq("actor_user_id", filter.actor);
  // Prefix match ("user." finds every user action); wildcards typed by the admin are literal.
  if (filter.action) query = query.like("action", `${filter.action.replace(/[%_\\]/g, "\\$&")}%`);
  if (filter.targetType) query = query.eq("target_type", filter.targetType);
  if (filter.targetId) query = query.eq("target_id", filter.targetId);
  if (filter.from) query = query.gte("created_at", filter.from);
  if (filter.to) query = query.lte("created_at", filter.to);
  if (filter.failedOnly) query = query.eq("success", false);
  const start = (filter.page - 1) * filter.pageSize;
  const { data, count, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(start, start + filter.pageSize - 1);
  if (error) throw httpErrorFromPg(error, "The audit log is unavailable.");
  const rows = (data ?? []) as AuditDbRow[];
  return {
    total: count ?? rows.length,
    page: filter.page,
    pageSize: filter.pageSize,
    rows: await withActors(rows, pii),
  };
}

/** Latest rows about one target (a user, a workspace, an admin). */
export async function auditForTarget(
  targetType: string,
  targetId: string,
  pii: boolean,
  limit = 30,
): Promise<AdminAuditRow[]> {
  const { data, error } = await adminDb
    .from("admin_audit_log")
    .select(COLUMNS)
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw httpErrorFromPg(error, "The audit log is unavailable.");
  return withActors((data ?? []) as AuditDbRow[], pii);
}

/** Refused attempts and the sensitive changes, for the Security page. */
export async function securityEvents(pii: boolean, limit = 40): Promise<AdminAuditRow[]> {
  const { data, error } = await adminDb
    .from("admin_audit_log")
    .select(COLUMNS)
    .or("success.eq.false,action.like.admin.*,action.in.(user.suspended,user.sessions_revoked)")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw httpErrorFromPg(error, "The audit log is unavailable.");
  return withActors((data ?? []) as AuditDbRow[], pii);
}
