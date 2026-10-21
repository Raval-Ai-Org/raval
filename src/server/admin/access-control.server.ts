// Workspace suspension / read-only mode and read-only support views.
//
// A mode change and its audit row are written together by
// admin_workspace_set_access; the app enforces the mode in
// checkWorkspaceMembership (see src/server/platform/workspace-access.server.ts).
//
// A support view is NOT a login as the customer: no token is minted and nothing
// can be changed through it. It is a 30-minute permission for one admin to read
// an allow-listed snapshot of one workspace (admin_view_read), and every read is
// audited. Emails in the snapshot follow the same masking as the rest of the
// console.
import "server-only";
import { maskEmail } from "@/lib/admin/permissions";
import type {
  AdminSupportView,
  AdminSupportViewSection,
  AdminSupportViewStart,
  AdminWorkspaceAccessMode,
} from "@/lib/admin/types";
import { clearWorkspaceAccessCache } from "@/server/platform/workspace-access.server";
import type { AuditContext } from "./audit.server";
import { adminRpc } from "./db.server";

type Actor = { actorId: string; actorRole: string; audit: AuditContext };

function meta(actor: Actor) {
  return {
    p_actor: actor.actorId,
    p_actor_role: actor.actorRole,
    p_request_id: actor.audit.requestId,
    p_ip: actor.audit.ip,
    p_user_agent: actor.audit.userAgent,
  };
}

export async function setWorkspaceAccess(
  actor: Actor,
  workspaceId: string,
  mode: AdminWorkspaceAccessMode,
  reason: string,
): Promise<{ mode: AdminWorkspaceAccessMode }> {
  const result = await adminRpc<{ mode: AdminWorkspaceAccessMode }>(
    "admin_workspace_set_access",
    { ...meta(actor), p_workspace: workspaceId, p_mode: mode, p_reason: reason },
    "Could not change the workspace.",
  );
  clearWorkspaceAccessCache(workspaceId);
  return result;
}

export async function startSupportView(
  actor: Actor,
  workspaceId: string,
  reason: string,
): Promise<AdminSupportViewStart> {
  const row = await adminRpc<{ session_id: string; workspace_id: string; expires_at: string }>(
    "admin_view_start",
    { ...meta(actor), p_workspace: workspaceId, p_reason: reason },
    "Could not open the support view.",
  );
  return { sessionId: row.session_id, workspaceId: row.workspace_id, expiresAt: row.expires_at };
}

export async function endSupportView(actor: Actor, sessionId: string): Promise<{ ended: boolean }> {
  const { p_actor, p_actor_role, p_request_id, p_ip, p_user_agent } = meta(actor);
  return adminRpc<{ ended: boolean }>(
    "admin_view_end",
    { p_actor, p_actor_role, p_session: sessionId, p_request_id, p_ip, p_user_agent },
    "Could not end the support view.",
  );
}

const hideEmail = (value: unknown, pii: boolean): unknown =>
  typeof value === "string" ? (pii ? value : maskEmail(value)) : value;

export async function readSupportView(
  actor: Actor,
  sessionId: string,
  section: AdminSupportViewSection,
  pii: boolean,
): Promise<AdminSupportView> {
  const raw = await adminRpc<{
    workspace_id: string;
    expires_at: string;
    section: AdminSupportViewSection;
    data: Record<string, unknown>;
  }>(
    "admin_view_read",
    { ...meta(actor), p_session: sessionId, p_section: section },
    "Could not read the support view.",
  );
  const data = raw.data ?? {};
  // Only the member list carries personal data in a snapshot.
  if (Array.isArray(data.members)) {
    data.members = (data.members as Array<Record<string, unknown>>).map((member) => ({
      ...member,
      email: hideEmail(member.email, pii),
    }));
  }
  return {
    workspaceId: raw.workspace_id,
    expiresAt: raw.expires_at,
    section: raw.section,
    data,
  };
}
