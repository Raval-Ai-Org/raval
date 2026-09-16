// workspace-access.server.ts — role checks for server functions.
//
// `requireSupabaseAuth` proves who the caller is; RLS keeps reads inside their
// workspaces. Side effects additionally need a minimum workspace role, checked
// here before any service-role write.
import "server-only";
import { ForbiddenError } from "@/server/http-error";
import { setRequestScope } from "@/server/request-context";
import type { ServerFnContext } from "@/server/server-fn";
import { checkWorkspaceMembership, type VerifiedUser, type WorkspaceRole } from "@/server/api-auth";

/** Throws a user-facing error unless the caller holds at least `minRole`; returns their role. */
export async function requireWorkspaceRole(
  context: ServerFnContext,
  workspaceId: string,
  minRole: WorkspaceRole,
): Promise<WorkspaceRole> {
  const result = await checkWorkspaceMembership(
    {
      ok: true,
      userId: context.userId,
      claims: context.claims as never,
      supabase: context.supabase,
    } as VerifiedUser,
    workspaceId,
    { minRole },
  );
  if (!result.ok) {
    const body = (await result.response.json().catch(() => null)) as { error?: string } | null;
    throw new ForbiddenError(body?.error);
  }
  // The verified workspace this call acts on is also the one its AI spend is
  // metered against — not whatever x-workspace-id header the browser sent.
  setRequestScope({ workspaceId: result.workspaceId });
  return result.role;
}

/** The caller's role, or null when they aren't a member. Never throws for non-members. */
export async function getWorkspaceRole(
  context: ServerFnContext,
  workspaceId: string,
): Promise<WorkspaceRole | null> {
  const result = await checkWorkspaceMembership(
    {
      ok: true,
      userId: context.userId,
      claims: context.claims as never,
      supabase: context.supabase,
    } as VerifiedUser,
    workspaceId,
  );
  return result.ok ? result.role : null;
}
