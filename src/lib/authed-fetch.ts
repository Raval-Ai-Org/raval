import { supabase } from "@/integrations/supabase/client";
import { onAppEvent } from "@/lib/app-events";

// Authenticated fetch for our /api/* server routes.
// Attaches the Supabase access token as a Bearer header, and the active
// workspace as `x-workspace-id` so the server can attribute AI spend to it for
// metering and plan budgets. The server only honours that header after
// verifying the caller is a member (src/server/route.ts) — it is attribution,
// never authorization.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SELECTED_WORKSPACE_KEY = "workspace:selected";

let activeWorkspaceId: string | null | undefined;
let subscribed = false;

function readStoredWorkspace(): string | null {
  try {
    const raw = window.localStorage.getItem(SELECTED_WORKSPACE_KEY);
    if (!raw) return null;
    if (UUID_RE.test(raw)) return raw;
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === "string" && UUID_RE.test(parsed)) return parsed;
    const id = (parsed as { id?: unknown } | null)?.id;
    return typeof id === "string" && UUID_RE.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** The workspace the user is currently working in (browser only). */
export function getActiveWorkspaceId(): string | null {
  if (typeof window === "undefined") return null;
  if (!subscribed) {
    subscribed = true;
    onAppEvent("workspace:changed", (event) => {
      const id = event.detail?.id ?? null;
      activeWorkspaceId = id && UUID_RE.test(id) ? id : null;
    });
  }
  if (activeWorkspaceId === undefined) activeWorkspaceId = readStoredWorkspace();
  return activeWorkspaceId;
}

export async function authedFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const headers = new Headers(init.headers);
  if (token && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${token}`);
  }
  const workspaceId = getActiveWorkspaceId();
  if (workspaceId && !headers.has("x-workspace-id")) {
    headers.set("x-workspace-id", workspaceId);
  }
  return fetch(input, { ...init, headers });
}
