// sdr.helpers.server.ts — request-scoped helpers for the SDR proxy routes:
// (1) authorize the caller as a workspace member, (2) resolve the workspace's
// per-workspace SDR key (provisioning on first use). Server-only.
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { jsonError, requireUserId } from "@/server/api-auth";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { decryptSecret, ensureWorkspaceSdrProvisioning } from "@/lib/sdr-provisioning.server";

function createUserClientFromRequest(request: Request) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase not configured (server env)");
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return createClient<Database>(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
  });
}

export type WorkspaceAccess =
  { ok: true; userId: string; workspaceId: string } | { ok: false; response: Response };

/** 401 if not authenticated; 400 if workspaceId missing; 403 if not a member. */
export async function requireWorkspaceAccess(
  request: Request,
  workspaceId: unknown,
): Promise<WorkspaceAccess> {
  const auth = await requireUserId(request);
  if (!auth.ok) return auth;
  if (typeof workspaceId !== "string" || workspaceId.length === 0) {
    return { ok: false, response: jsonError(400, "workspaceId is required") };
  }
  const supabase = createUserClientFromRequest(request);
  const { data } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", auth.userId)
    .maybeSingle();
  if (!data) {
    return { ok: false, response: jsonError(403, "Not a member of this workspace") };
  }
  return { ok: true, userId: auth.userId, workspaceId };
}

/** Resolve the workspace's per-workspace SDR API key (provisioning on first use). */
export async function getWorkspaceSdrKey(workspaceId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("workspace_sdr")
    .select("encrypted_api_key")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (data?.encrypted_api_key) {
    return decryptSecret(data.encrypted_api_key);
  }
  const record = await ensureWorkspaceSdrProvisioning(workspaceId);
  return decryptSecret(record.encrypted_api_key);
}
