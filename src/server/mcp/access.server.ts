// Who is calling the MCP server, and what they may touch. Three gates, in
// order, before any tool runs on a workspace:
//   1. the kill switch (FEATURE_FLAG_MCP_ENABLED[_WS_<id>]),
//   2. workspace membership and role, read with the caller's own RLS client,
//   3. the workspace's own switch: on at all, and may an assistant change things.
import "server-only";
import type { JwtPayload } from "@supabase/supabase-js";
import type { UserSupabaseClient } from "@/integrations/supabase/client.user.server";
import { isMcpEnabled } from "@/lib/feature-flags";
import {
  checkWorkspaceMembership,
  oauthClientId,
  verifyBearer,
  type WorkspaceRole,
} from "@/server/api-auth";
import { McpError } from "./errors.server";
import { getMcpSettings } from "./settings.server";

export type McpCaller = {
  userId: string;
  claims: JwtPayload;
  /** RLS-bound client carrying the caller's own token. */
  supabase: UserSupabaseClient;
  /** The assistant app the token was issued to; null for a plain session token. */
  clientId: string | null;
  /** The caller's own access token, replayed in-process by the bridge. Never logged or returned. */
  token: string;
};

export type McpWorkspaceAccess = { workspaceId: string; role: WorkspaceRole };

export async function authenticateMcp(
  request: Request,
): Promise<{ ok: true; caller: McpCaller } | { ok: false; status: 401 | 500; message: string }> {
  const auth = await verifyBearer(request, { allowOAuthClient: true });
  if (!auth.ok) return auth;
  return {
    ok: true,
    caller: {
      userId: auth.userId,
      claims: auth.claims,
      supabase: auth.supabase,
      clientId: oauthClientId(auth.claims),
      token: (request.headers.get("authorization") ?? "").slice(7).trim(),
    },
  };
}

const OFF_MESSAGE =
  "AI assistant access is off for this workspace. An admin can turn it on in Mellox under Settings, AI assistants.";

export async function requireMcpWorkspace(
  caller: McpCaller,
  workspaceId: unknown,
  minRole: WorkspaceRole,
  opts: { write: boolean },
): Promise<McpWorkspaceAccess> {
  const membership = await checkWorkspaceMembership(
    { ok: true, userId: caller.userId, claims: caller.claims, supabase: caller.supabase },
    workspaceId,
    { minRole },
  );
  if (!membership.ok) {
    const status = membership.response.status;
    const body = (await membership.response.json().catch(() => null)) as { error?: string } | null;
    if (status === 400) {
      throw new McpError("invalid_input", body?.error ?? "workspaceId is invalid");
    }
    if (status === 403) {
      throw new McpError("forbidden", body?.error ?? "You don't have access to this workspace");
    }
    throw new McpError("internal_error", "Could not check workspace access. Please try again.");
  }
  if (!isMcpEnabled(membership.workspaceId)) throw new McpError("mcp_disabled", OFF_MESSAGE);
  const settings = await getMcpSettings(membership.workspaceId);
  if (!settings.enabled) throw new McpError("mcp_disabled", OFF_MESSAGE);
  if (opts.write && !settings.allowWrites) {
    throw new McpError(
      "read_only",
      "This workspace only lets AI assistants read. An admin can allow changes in Mellox under Settings, AI assistants.",
    );
  }
  return { workspaceId: membership.workspaceId, role: membership.role };
}
