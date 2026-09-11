// sdr.helpers.server.ts — resolve a workspace's SDR connection (per-workspace
// key, provisioning on first use, and the SDR base URL). Workspace
// authorization lives in src/server/api-auth.ts. Server-only.
import "server-only";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { decryptSecret, ensureWorkspaceSdrProvisioning } from "@/lib/sdr-provisioning.server";
import { assertSdrBaseUrl } from "@/lib/sdr.server";

export type WorkspaceSdrConfig = { token: string; baseUrl: string };

/**
 * The base URL a workspace's SDR calls go to: its own `workspace_sdr.sdr_base_url`
 * when that is a valid, public (or loopback-dev) URL, else the global
 * SDR_BASE_URL. Every SDR call for a workspace — publish, schedule, cancel,
 * accounts, reconcile — must use the same URL, or reconciliation asks a
 * different SDR than the one that holds the job (audit: reconcile URL scoping).
 */
export function resolveSdrBaseUrl(override: string | null | undefined): string {
  const fallback = process.env.SDR_BASE_URL ?? "";
  if (!override) return fallback;
  try {
    assertSdrBaseUrl(override);
    return override;
  } catch {
    console.error("[sdr] ignoring invalid per-workspace sdr_base_url override");
    return fallback;
  }
}

/** Resolve the workspace's SDR key + base URL (provisioning on first use). */
export async function getWorkspaceSdrConfig(workspaceId: string): Promise<WorkspaceSdrConfig> {
  const { data } = await supabaseAdmin
    .from("workspace_sdr")
    .select("encrypted_api_key, sdr_base_url")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (data?.encrypted_api_key) {
    return {
      token: decryptSecret(data.encrypted_api_key),
      baseUrl: resolveSdrBaseUrl(data.sdr_base_url),
    };
  }
  const record = await ensureWorkspaceSdrProvisioning(workspaceId);
  return {
    token: decryptSecret(record.encrypted_api_key),
    baseUrl: resolveSdrBaseUrl(record.sdr_base_url),
  };
}

/** Resolve the workspace's per-workspace SDR API key (provisioning on first use). */
export async function getWorkspaceSdrKey(workspaceId: string): Promise<string> {
  return (await getWorkspaceSdrConfig(workspaceId)).token;
}
