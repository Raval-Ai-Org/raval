// sdr-provisioning.server.ts — per-workspace SDR identity provisioning (FR-022).
// On first use, mints a per-workspace SDR API key (via the admin token), registers
// the workspace's delivery webhook, and stores the key + secret ENCRYPTED in
// workspace_sdr (service-role only — never readable by the user client, FR-014).
// Idempotent: concurrent first-uses converge on one active row.
//
// Dependencies are injectable for tests (mock Supabase + mock SDR calls); in
// production they default to supabaseAdmin + callSdr + server-only env.

import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { decryptWithKey, encryptWithKey, readEncryptionKey } from "@/server/crypto/secret-box.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { callSdr } from "@/lib/sdr.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// ─── Secret encryption (app-layer, AES-256-GCM; mirrors the SDR's Fernet posture) ──
const SDR_KEY_ENV = "SDR_SECRET_ENCRYPTION_KEY";

export function encryptSecret(plaintext: string): string {
  return encryptWithKey(plaintext, readEncryptionKey(SDR_KEY_ENV));
}

export function decryptSecret(payload: string): string {
  return decryptWithKey(payload, readEncryptionKey(SDR_KEY_ENV));
}

// ─── Provisioning ─────────────────────────────────────────────────────────────
export const WS_SDR_TABLE = "workspace_sdr";

export type WorkspaceSdrRecord = {
  id: string;
  workspace_id: string;
  sdr_workspace_id: string;
  encrypted_api_key: string;
  webhook_secret: string | null;
  sdr_base_url: string;
  status: "provisioning" | "active" | "error";
};

export type ProvisioningDeps = {
  sdrBaseUrl?: string;
  adminToken?: string;
  webhookBaseUrl?: string;
  callSdrFn?: typeof callSdr;
  db?: Pick<SupabaseClient, "from">;
  now?: () => string;
};

export async function ensureWorkspaceSdrProvisioning(
  workspaceId: string,
  deps: ProvisioningDeps = {},
): Promise<WorkspaceSdrRecord> {
  const db = deps.db ?? supabaseAdmin;
  const baseUrl = deps.sdrBaseUrl ?? process.env.SDR_BASE_URL ?? "";
  const adminToken = deps.adminToken ?? process.env.SDR_ADMIN_TOKEN ?? "";
  if (!baseUrl || !adminToken) {
    throw new Error("SDR_BASE_URL / SDR_ADMIN_TOKEN not configured (server-only env)");
  }
  const call = deps.callSdrFn ?? callSdr;

  // 1. Idempotency: an existing active row short-circuits (FR-022).
  const { data: existing } = await db
    .from(WS_SDR_TABLE)
    .select("*")
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (existing && existing.status === "active") {
    return existing as unknown as WorkspaceSdrRecord;
  }

  // 2. Mint a per-workspace key via the SDR admin endpoint (global token is
  //    admin-only; tenant traffic uses the minted key — never the global one).
  //    The SDR contract requires BOTH workspace_id and brand_id (its admin
  //    schema: `workspace_id` + `brand_id`, each 1–64 chars). RavalAI's model is
  //    one workspace per client brand, so brand_id maps to the same workspace id.
  const keyRes = await call({
    baseUrl,
    token: adminToken,
    method: "POST",
    path: "/api/v1/admin/api-keys",
    body: { workspace_id: workspaceId, brand_id: workspaceId },
  });
  if (keyRes.status !== 201 || !keyRes.data?.api_key) {
    throw new Error(`SDR per-workspace key mint failed (status ${keyRes.status})`);
  }
  const apiKey = keyRes.data.api_key as string;

  // 3. Per-workspace webhook secret + endpoint. Only when a public base URL is
  //    configured; dev relies on job polling (R2h) until the receiver is deployed.
  const webhookBase = deps.webhookBaseUrl ?? process.env.SDR_WEBHOOK_BASE_URL ?? "";
  let webhookSecret: string | null = null;
  if (webhookBase) {
    webhookSecret = randomBytes(24).toString("base64url");
    const wh = await call({
      baseUrl,
      token: apiKey, // the minted per-workspace key, not the admin token
      method: "POST",
      path: "/api/v1/webhooks/config",
      body: { url: `${webhookBase}/api/public/hooks/sdr`, secret: webhookSecret },
    });
    if (wh.status !== 201) {
      throw new Error(`SDR webhook registration failed (status ${wh.status})`);
    }
  }

  const row: WorkspaceSdrRecord = {
    id: randomUUID(),
    workspace_id: workspaceId,
    sdr_workspace_id: workspaceId, // SDR accepts the RavalAI workspace id directly
    encrypted_api_key: encryptSecret(apiKey),
    webhook_secret: webhookSecret ? encryptSecret(webhookSecret) : null,
    sdr_base_url: baseUrl,
    status: "active",
  };

  const { error } = await db.from(WS_SDR_TABLE).upsert(row, { onConflict: "workspace_id" });
  if (error) throw new Error(`workspace_sdr upsert failed: ${error.message}`);
  return row;
}
