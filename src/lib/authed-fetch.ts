import { supabase } from "@/integrations/supabase/client";
import { workspaceIdFromPath } from "@/lib/workspace/paths";

// Authenticated fetch for our /api/* server routes.
// Attaches the Supabase access token as a Bearer header, and the workspace as
// `x-workspace-id` so the server can attribute AI spend to it for metering and
// plan budgets. The server only honours that header after verifying the
// caller is a member (src/server/route.ts) — it is attribution, never
// authorization. Routes that act on workspace data take the id in their input
// and verify it (defineRoute auth: "workspace" / requireWorkspaceRole).

/**
 * The workspace of the page the user is on, read from the canonical URL
 * (/w/<id>/...) at the moment of the call. There is no cached or stored
 * "active workspace": a request captures the id when it starts, so switching
 * workspaces mid-request can never re-point it.
 */
export function getActiveWorkspaceId(): string | null {
  if (typeof window === "undefined") return null;
  return workspaceIdFromPath(window.location.pathname);
}

export type AuthedFetchInit = RequestInit & {
  /** The workspace this request acts for; defaults to the current page's. */
  workspaceId?: string | null;
};

export async function authedFetch(input: RequestInfo | URL, init: AuthedFetchInit = {}) {
  const { workspaceId: explicit, ...rest } = init;
  // Captured before the first await so a navigation during token refresh
  // cannot change which workspace this request is attributed to.
  const workspaceId = explicit !== undefined ? explicit : getActiveWorkspaceId();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const headers = new Headers(rest.headers);
  if (token && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${token}`);
  }
  if (workspaceId && !headers.has("x-workspace-id")) {
    headers.set("x-workspace-id", workspaceId);
  }
  return fetch(input, { ...rest, headers });
}
