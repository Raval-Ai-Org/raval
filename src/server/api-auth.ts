// Authentication primitives shared by every server entry point: the /api route
// kernel (src/server/route.ts), the RPC middleware (requireSupabaseAuth) and the
// few routes that still authenticate by hand.
import "server-only";
import type { JwtPayload } from "@supabase/supabase-js";
import {
  createUserClient,
  type UserSupabaseClient,
} from "@/integrations/supabase/client.user.server";

export function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export type VerifiedUser = {
  ok: true;
  userId: string;
  claims: JwtPayload;
  /** RLS-bound client carrying the caller's own JWT. */
  supabase: UserSupabaseClient;
};

export type VerifyFailure = { ok: false; status: 401 | 500; message: string };

/**
 * Validate the request's Bearer token and build the caller's RLS-bound client.
 * The single implementation behind `requireUserId` and `requireSupabaseAuth`.
 */
export async function verifyBearer(request: Request): Promise<VerifiedUser | VerifyFailure> {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_PUBLISHABLE_KEY) {
    console.error("[auth] SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY not configured");
    return { ok: false, status: 500, message: "Server not configured" };
  }
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    return { ok: false, status: 401, message: "Authentication required" };
  }
  const token = header.slice(7).trim();
  // Supabase access tokens are JWTs; anything else is rejected before a network call.
  if (!token || token.split(".").length !== 3) {
    return { ok: false, status: 401, message: "Invalid session" };
  }

  const supabase = createUserClient(token);
  try {
    const { data, error } = await supabase.auth.getClaims(token);
    if (error || !data?.claims?.sub) {
      return { ok: false, status: 401, message: "Invalid session" };
    }
    return { ok: true, userId: data.claims.sub, claims: data.claims, supabase };
  } catch {
    // getClaims throws (rather than returning an error) on tokens it cannot
    // decode, e.g. three dot-separated segments that are not base64url JSON.
    return { ok: false, status: 401, message: "Invalid session" };
  }
}

export async function requireUserId(
  request: Request,
): Promise<VerifiedUser | { ok: false; response: Response }> {
  const result = await verifyBearer(request);
  if (!result.ok) return { ok: false, response: jsonError(result.status, result.message) };
  return result;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** workspace_members.role (public.app_role), most to least privileged. */
export type WorkspaceRole = "owner" | "admin" | "editor" | "viewer";
const ROLE_RANK: Record<WorkspaceRole, number> = { owner: 4, admin: 3, editor: 2, viewer: 1 };

export function roleAtLeast(role: string | null | undefined, min: WorkspaceRole): boolean {
  const rank = ROLE_RANK[role as WorkspaceRole] ?? 0;
  return rank >= ROLE_RANK[min];
}

export type WorkspaceAccess =
  (VerifiedUser & { workspaceId: string; role: WorkspaceRole }) | { ok: false; response: Response };

/**
 * Confirm an authenticated user belongs to `workspaceId` (400 missing or
 * malformed id, 403 not a member or below `minRole`). Uses the caller's
 * RLS-bound client. Membership alone is not authorization for side effects:
 * publishing, scheduling and account changes pass `minRole: "editor"` so a
 * viewer cannot trigger them through a service-role write.
 */
export async function checkWorkspaceMembership(
  auth: VerifiedUser,
  workspaceId: unknown,
  opts: { minRole?: WorkspaceRole } = {},
): Promise<
  { ok: true; workspaceId: string; role: WorkspaceRole } | { ok: false; response: Response }
> {
  if (typeof workspaceId !== "string" || workspaceId.length === 0) {
    return { ok: false, response: jsonError(400, "workspaceId is required") };
  }
  // workspace_members.workspace_id is a uuid; a malformed id would otherwise
  // surface as a Postgres cast error below.
  if (!UUID_RE.test(workspaceId)) {
    return { ok: false, response: jsonError(400, "workspaceId is invalid") };
  }
  const { data, error } = await auth.supabase
    .from("workspace_members")
    .select("workspace_id, role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", auth.userId)
    .maybeSingle();
  if (error) {
    console.error("[auth] workspace membership lookup failed", error.message);
    return { ok: false, response: jsonError(500, "Could not verify workspace access") };
  }
  if (!data) {
    return { ok: false, response: jsonError(403, "Not a member of this workspace") };
  }
  const role = ((data as { role?: string }).role ?? "viewer") as WorkspaceRole;
  if (opts.minRole && !roleAtLeast(role, opts.minRole)) {
    return {
      ok: false,
      response: jsonError(403, `This action needs the ${opts.minRole} role or higher`),
    };
  }
  return { ok: true, workspaceId, role };
}

/** 401 if not authenticated; 400 if workspaceId missing; 403 if not a member. */
export async function requireWorkspaceAccess(
  request: Request,
  workspaceId: unknown,
  opts: { minRole?: WorkspaceRole } = {},
): Promise<WorkspaceAccess> {
  const auth = await requireUserId(request);
  if (!auth.ok) return auth;
  const membership = await checkWorkspaceMembership(auth, workspaceId, opts);
  if (!membership.ok) return membership;
  return { ...auth, workspaceId: membership.workspaceId, role: membership.role };
}
