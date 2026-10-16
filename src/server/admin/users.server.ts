// Customer accounts, as the admin console sees them. Reads go through the
// narrow functions in the admin migration; changes go through functions that
// write their own audit row in the same transaction.
import "server-only";
import type {
  AdminBillingSummary,
  AdminNote,
  AdminUserDetail,
  AdminUserRow,
  Paged,
} from "@/lib/admin/types";
import { isBillingAdmin } from "@/server/billing/admin.server";
import { HttpError } from "@/server/http-error";
import { auditForTarget, emailsFor, showEmail } from "./audit-read.server";
import type { AuditContext } from "./audit.server";
import { adminDb, adminRpc, httpErrorFromPg } from "./db.server";

type DirectoryRow = {
  id: string;
  email: string | null;
  name: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  banned_until: string | null;
  email_confirmed_at: string | null;
  providers: unknown;
  workspace_count: number | string;
  persona: string | null;
  is_admin: boolean;
};

export function isSuspended(bannedUntil: string | null | undefined): boolean {
  return Boolean(bannedUntil) && new Date(bannedUntil as string).getTime() > Date.now();
}

function providersOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function mapUser(row: DirectoryRow, pii: boolean): AdminUserRow {
  return {
    id: row.id,
    email: showEmail(row.email, pii),
    name: row.name,
    createdAt: row.created_at,
    lastSignInAt: row.last_sign_in_at,
    suspended: isSuspended(row.banned_until),
    emailConfirmed: Boolean(row.email_confirmed_at),
    providers: providersOf(row.providers),
    workspaceCount: Number(row.workspace_count ?? 0),
    persona: row.persona,
    isAdmin: Boolean(row.is_admin),
  };
}

export type UserListQuery = {
  search?: string;
  filter: "all" | "suspended" | "unconfirmed" | "recent" | "admins";
  sort: "created" | "last_seen";
  page: number;
  pageSize: number;
};

export async function listUsers(query: UserListQuery, pii: boolean): Promise<Paged<AdminUserRow>> {
  const result = await adminRpc<{ total: number; rows: DirectoryRow[] }>("admin_user_directory", {
    p_search: query.search ?? "",
    p_filter: query.filter,
    p_sort: query.sort,
    p_limit: query.pageSize,
    p_offset: (query.page - 1) * query.pageSize,
  });
  return {
    total: Number(result.total ?? 0),
    page: query.page,
    pageSize: query.pageSize,
    rows: (result.rows ?? []).map((row) => mapUser(row, pii)),
  };
}

export async function getUserDetail(
  id: string,
  pii: boolean,
  includeAudit: boolean,
): Promise<AdminUserDetail> {
  const directory = await adminRpc<{ total: number; rows: DirectoryRow[] }>(
    "admin_user_directory",
    {
      p_search: id,
      p_filter: "all",
      p_sort: "created",
      p_limit: 1,
      p_offset: 0,
    },
  );
  const row = directory.rows?.[0];
  if (!row || row.id.toLowerCase() !== id.toLowerCase()) {
    throw new HttpError(404, "User not found.");
  }

  const [stats, memberships, owned, noteRows, audit] = await Promise.all([
    adminRpc<{ sessions: number; mfa_factors: number }>("admin_user_stats", { p_user: id }),
    adminDb
      .from("workspace_members")
      .select("role, workspaces:workspace_id (id, name, plan, owner_id)")
      .eq("user_id", id)
      .limit(100),
    adminDb
      .from("billing_accounts")
      .select(
        "id, plan_id, status, trial_ends_at, current_period_end, comped_plan_id, comped_until",
      )
      .eq("owner_user_id", id)
      .limit(20),
    adminDb
      .from("admin_user_notes")
      .select("id, author_id, body, created_at")
      .eq("user_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
    includeAudit ? auditForTarget("user", id, pii) : Promise.resolve([]),
  ]);
  if (memberships.error) throw httpErrorFromPg(memberships.error, "Could not load workspaces.");
  if (owned.error) throw httpErrorFromPg(owned.error, "Could not load billing.");
  if (noteRows.error) throw httpErrorFromPg(noteRows.error, "Could not load notes.");

  const authors = await emailsFor((noteRows.data ?? []).map((n) => n.author_id as string));
  const notes: AdminNote[] = (noteRows.data ?? []).map((n) => ({
    id: n.id as string,
    authorId: n.author_id as string,
    authorEmail: showEmail(authors.get(n.author_id as string), pii),
    body: n.body as string,
    createdAt: n.created_at as string,
  }));

  type Membership = {
    role: string;
    workspaces: { id: string; name: string; plan: string | null; owner_id: string } | null;
  };
  const workspaces = ((memberships.data ?? []) as unknown as Membership[])
    .filter((m) => m.workspaces)
    .map((m) => ({
      id: m.workspaces!.id,
      name: m.workspaces!.name,
      role: m.role,
      plan: m.workspaces!.plan,
      owned: m.workspaces!.owner_id === id,
    }));

  const billing: AdminBillingSummary[] = (owned.data ?? []).map((b) => ({
    id: b.id as string,
    planId: b.plan_id as string,
    status: b.status as string,
    trialEndsAt: (b.trial_ends_at as string | null) ?? null,
    currentPeriodEnd: (b.current_period_end as string | null) ?? null,
    comped: Boolean(
      b.comped_plan_id && b.comped_until && new Date(b.comped_until as string) > new Date(),
    ),
  }));

  return {
    user: {
      ...mapUser(row, pii),
      bannedUntil: row.banned_until,
      sessions: Number(stats?.sessions ?? 0),
      mfaFactors: Number(stats?.mfa_factors ?? 0),
    },
    workspaces,
    billing,
    notes,
    audit,
  };
}

/** People on the environment allowlist are staff too and are never suspended from here. */
export function assertNotStaff(userId: string): void {
  if (isBillingAdmin(userId)) {
    throw new HttpError(403, "Staff accounts are managed from Team, not here.");
  }
}

type ActorArgs = { actorId: string; actorRole: string; audit: AuditContext };

function actorParams({ actorId, actorRole, audit }: ActorArgs) {
  return {
    p_actor: actorId,
    p_actor_role: actorRole,
    p_request_id: audit.requestId,
    p_ip: audit.ip,
    p_user_agent: audit.userAgent,
  };
}

export async function setUserSuspended(
  actor: ActorArgs,
  userId: string,
  suspend: boolean,
  reason: string,
): Promise<{ suspended: boolean; sessionsEnded: number }> {
  if (suspend) assertNotStaff(userId);
  const result = await adminRpc<{ suspended: boolean; sessions_ended: number }>(
    "admin_user_set_suspended",
    { ...actorParams(actor), p_user: userId, p_suspend: suspend, p_reason: reason },
    "Could not change the account.",
  );
  return { suspended: result.suspended, sessionsEnded: Number(result.sessions_ended ?? 0) };
}

export async function revokeUserSessions(
  actor: ActorArgs,
  userId: string,
  reason: string,
): Promise<{ sessionsEnded: number }> {
  const result = await adminRpc<{ sessions_ended: number }>(
    "admin_user_revoke_sessions",
    { ...actorParams(actor), p_user: userId, p_reason: reason },
    "Could not end the sessions.",
  );
  return { sessionsEnded: Number(result.sessions_ended ?? 0) };
}

export async function addUserNote(
  actor: ActorArgs,
  userId: string,
  body: string,
): Promise<{ id: string }> {
  const { p_actor, p_actor_role, p_request_id, p_ip, p_user_agent } = actorParams(actor);
  const note = await adminRpc<{ id: string }>(
    "admin_user_add_note",
    { p_actor, p_actor_role, p_user: userId, p_body: body, p_request_id, p_ip, p_user_agent },
    "Could not save the note.",
  );
  return { id: note.id };
}
