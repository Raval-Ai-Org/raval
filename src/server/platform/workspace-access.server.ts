// Workspace access mode — the runtime half of workspace suspension / read-only.
//
// An admin can put one workspace in read-only mode (nothing can be changed) or
// suspend it (nothing can be used). The state lives in workspace_access_state,
// a service-role-only table, and is checked in the ONE place every workspace
// request already passes through: `checkWorkspaceMembership`
// (src/server/api-auth.ts), which both `defineRoute` and server functions use.
//
//   suspended → every workspace-scoped request is refused (403)
//   read_only → a request that needs "editor" or higher is refused (403); a plain
//               member read still works. Side-effecting routes declare
//               minRole "editor" by convention (CLAUDE.md), which is what this relies on.
//
// Fails OPEN like the other platform switches: an unreadable table means the
// workspace keeps working. Cached for a few seconds per process, so a change
// reaches every instance quickly.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type AccessMode = "active" | "read_only" | "suspended";

const TTL_MS = 10_000;
const MAX_ENTRIES = 2_000;

export type AccessReader = (workspaceId: string) => Promise<AccessMode>;

const defaultReader: AccessReader = async (workspaceId) => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const client = supabaseAdmin as unknown as SupabaseClient;
  const { data, error } = await client
    .from("workspace_access_state")
    .select("mode")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const mode = (data as { mode?: string } | null)?.mode;
  return mode === "read_only" || mode === "suspended" ? mode : "active";
};

let reader: AccessReader = defaultReader;
const cache = new Map<string, { at: number; mode: AccessMode }>();

/** Tests inject a reader. */
export function setAccessReader(next: AccessReader | null): void {
  reader = next ?? defaultReader;
  cache.clear();
}

export function clearWorkspaceAccessCache(workspaceId?: string): void {
  if (workspaceId) cache.delete(workspaceId);
  else cache.clear();
}

export async function workspaceAccessMode(workspaceId: string): Promise<AccessMode> {
  const hit = cache.get(workspaceId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.mode;
  try {
    const mode = await reader(workspaceId);
    if (cache.size >= MAX_ENTRIES) cache.clear();
    cache.set(workspaceId, { at: Date.now(), mode });
    return mode;
  } catch (error) {
    console.error(
      "[workspace-access] read failed, treating as active",
      error instanceof Error ? error.message : error,
    );
    return hit?.mode ?? "active";
  }
}

export type AccessRefusal = { status: 403; code: string; message: string };

/**
 * Pure decision: may a request that needs `needsWrite` proceed in this mode?
 * `needsWrite` is true when the route requires editor or higher.
 */
export function accessRefusal(mode: AccessMode, needsWrite: boolean): AccessRefusal | null {
  if (mode === "suspended") {
    return {
      status: 403,
      code: "workspace_suspended",
      message: "This workspace is suspended. Please contact Mellox support.",
    };
  }
  if (mode === "read_only" && needsWrite) {
    return {
      status: 403,
      code: "workspace_read_only",
      message:
        "This workspace is read-only right now, so changes are paused. Please contact Mellox support.",
    };
  }
  return null;
}
