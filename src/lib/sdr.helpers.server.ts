// sdr.helpers.server.ts — resolve a workspace's per-workspace SDR key
// (provisioning on first use). Workspace authorization lives in
// src/server/api-auth.ts (requireWorkspaceAccess). Server-only.
import "server-only";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { decryptSecret, ensureWorkspaceSdrProvisioning } from "@/lib/sdr-provisioning.server";

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
