// The admin team: who may use the console and with which role. Changes go
// through admin_team_save, which refuses self-edits and removing the last super
// admin, and writes the audit row in the same transaction.
import "server-only";
import {
  effectivePermissions,
  isAdminRoleKey,
  isPermission,
  type AdminRoleKey,
  type Permission,
} from "@/lib/admin/permissions";
import type { AdminSecurity, AdminTeamMember } from "@/lib/admin/types";
import { isBillingAdmin, billingAdminIds } from "@/server/billing/admin.server";
import { HttpError } from "@/server/http-error";
import { adminMfaRequired } from "./config.server";
import { emailsFor, securityEvents, showEmail } from "./audit-read.server";
import type { AuditContext } from "./audit.server";
import { adminDb, adminRpc, httpErrorFromPg } from "./db.server";

type TeamRow = {
  user_id: string;
  role: string;
  status: string;
  extra_permissions: string[] | null;
  denied_permissions: string[] | null;
  note: string | null;
  created_at: string;
  last_seen_at: string | null;
};

function permissionsOnly(values: string[] | null): Permission[] {
  return (values ?? []).filter(isPermission);
}

export async function listTeam(pii: boolean): Promise<AdminTeamMember[]> {
  const { data, error } = await adminDb
    .from("admin_users")
    .select("user_id,role,status,extra_permissions,denied_permissions,note,created_at,last_seen_at")
    .order("created_at", { ascending: true })
    .limit(200);
  if (error) throw httpErrorFromPg(error, "Could not load the team.");
  const rows = (data ?? []) as TeamRow[];
  const envIds = billingAdminIds().filter((id) => !rows.some((r) => r.user_id === id));
  const emails = await emailsFor([...rows.map((r) => r.user_id), ...envIds]);

  const fromTable: AdminTeamMember[] = rows
    .filter((row) => isAdminRoleKey(row.role))
    .map((row) => ({
      userId: row.user_id,
      email: showEmail(emails.get(row.user_id), pii),
      role: row.role as AdminRoleKey,
      status: row.status === "active" ? "active" : "disabled",
      source: "team" as const,
      extraPermissions: permissionsOnly(row.extra_permissions),
      deniedPermissions: permissionsOnly(row.denied_permissions),
      effectivePermissions: effectivePermissions(
        row.role,
        row.extra_permissions ?? [],
        row.denied_permissions ?? [],
      ),
      note: row.note,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
    }));

  const fromEnv: AdminTeamMember[] = envIds.map((id) => ({
    userId: id,
    email: showEmail(emails.get(id), pii),
    role: "super_admin" as const,
    status: "active" as const,
    source: "environment" as const,
    extraPermissions: [],
    deniedPermissions: [],
    effectivePermissions: effectivePermissions("super_admin"),
    note: "Set in the server environment (BILLING_ADMIN_USER_IDS).",
    createdAt: "",
    lastSeenAt: null,
  }));

  return [...fromEnv, ...fromTable];
}

/** Find a user by exact email (case-insensitive), or null. */
async function userIdByEmail(email: string): Promise<string | null> {
  const needle = email.trim().toLowerCase();
  const result = await adminRpc<{ rows: Array<{ id: string; email: string | null }> }>(
    "admin_user_directory",
    { p_search: needle, p_filter: "all", p_sort: "created", p_limit: 25, p_offset: 0 },
  );
  return result.rows.find((row) => row.email?.toLowerCase() === needle)?.id ?? null;
}

export type SaveTeamInput = {
  userId?: string;
  email?: string;
  role: AdminRoleKey;
  status: "active" | "disabled";
  extraPermissions: Permission[];
  deniedPermissions: Permission[];
  note?: string;
  reason: string;
};

export async function saveTeamMember(
  actor: { actorId: string; actorRole: string; audit: AuditContext },
  input: SaveTeamInput,
): Promise<AdminTeamMember["userId"]> {
  const userId = input.userId ?? (input.email ? await userIdByEmail(input.email) : null);
  if (!userId) throw new HttpError(404, "No account with that email. They need to sign up first.");
  if (isBillingAdmin(userId)) {
    throw new HttpError(409, "This person is a super admin through the server environment.");
  }
  await adminRpc(
    "admin_team_save",
    {
      p_actor: actor.actorId,
      p_actor_role: actor.actorRole,
      p_user: userId,
      p_role: input.role,
      p_status: input.status,
      p_extra: input.extraPermissions,
      p_denied: input.deniedPermissions,
      p_note: input.note ?? null,
      p_reason: input.reason,
      p_request_id: actor.audit.requestId,
      p_ip: actor.audit.ip,
      p_user_agent: actor.audit.userAgent,
    },
    "Could not save the admin.",
  );
  return userId;
}

export async function getSecurity(pii: boolean): Promise<AdminSecurity> {
  const team = await listTeam(pii);
  const [factors, events] = await Promise.all([
    Promise.all(
      team.map(async (member) => {
        try {
          const stats = await adminRpc<{ mfa_factors: number }>("admin_user_stats", {
            p_user: member.userId,
          });
          return Number(stats?.mfa_factors ?? 0);
        } catch {
          return 0;
        }
      }),
    ),
    securityEvents(pii),
  ]);
  return {
    mfaRequired: adminMfaRequired(),
    admins: team.map((member, index) => ({
      userId: member.userId,
      email: member.email,
      role: member.role,
      status: member.status,
      mfaFactors: factors[index] ?? 0,
      lastSeenAt: member.lastSeenAt,
    })),
    events,
  };
}
