// tokens.server.ts — encrypted Google credentials (service role only) and an
// access-token provider for the API client. Access tokens are refreshed when
// they expire within a minute, cached encrypted in the row, and never leave
// the server. A refresh that Google rejects (invalid_grant: revoked, expired,
// password change, Testing-mode 7-day expiry) marks the connection for
// reconnect instead of retrying forever.
import "server-only";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { decryptWithKey, encryptWithKey } from "@/server/crypto/secret-box.server";
import { googleTokenKey, requireGoogleConfig } from "./config.server";
import { GoogleApiError, userMessageFor } from "./errors";
import { refreshAccess, type TokenSet } from "./oauth.server";
import { createGoogleApi, type GoogleApi, type TokenProvider } from "./api.server";

const EXPIRY_SKEW_MS = 60_000;

export async function saveCredentials(args: {
  connectionId: string;
  workspaceId: string;
  tokens: TokenSet;
  refreshToken: string;
  sub: string | null;
  email: string | null;
}): Promise<void> {
  const key = googleTokenKey();
  const { error } = await supabaseAdmin.from("google_oauth_credentials").upsert(
    {
      connection_id: args.connectionId,
      workspace_id: args.workspaceId,
      refresh_token_enc: encryptWithKey(args.refreshToken, key),
      access_token_enc: encryptWithKey(args.tokens.accessToken, key),
      access_token_expires_at: args.tokens.expiresAt.toISOString(),
      scopes: args.tokens.scopes,
      google_sub: args.sub,
      email: args.email,
    },
    { onConflict: "connection_id" },
  );
  if (error) throw new Error(`Couldn't save the Google connection: ${error.message}`);
}

export async function deleteCredentials(connectionId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("google_oauth_credentials")
    .delete()
    .eq("connection_id", connectionId);
  if (error) throw new Error(error.message);
}

/** Decrypted refresh token, for revoke on disconnect. */
export async function readRefreshToken(connectionId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("google_oauth_credentials")
    .select("refresh_token_enc")
    .eq("connection_id", connectionId)
    .maybeSingle();
  if (!data?.refresh_token_enc) return null;
  try {
    return decryptWithKey(data.refresh_token_enc, googleTokenKey());
  } catch {
    return null;
  }
}

async function markReconnectNeeded(connectionId: string): Promise<void> {
  await supabaseAdmin
    .from("workspace_connections")
    .update({ status: "error", last_error: userMessageFor("token_expired") })
    .eq("id", connectionId)
    .eq("provider", "google");
}

/**
 * An access-token provider bound to one connection. Refreshes are serialized
 * per provider instance, so one sync slice never refreshes twice at once.
 */
export function accessTokenProvider(connectionId: string, workspaceId: string): TokenProvider {
  let cached: { token: string; expiresAt: number } | null = null;
  let inflight: Promise<string> | null = null;

  async function load(forceRefresh: boolean): Promise<string> {
    if (!forceRefresh && cached && cached.expiresAt - EXPIRY_SKEW_MS > Date.now())
      return cached.token;
    const key = googleTokenKey();
    const { data: row, error } = await supabaseAdmin
      .from("google_oauth_credentials")
      .select("workspace_id, refresh_token_enc, access_token_enc, access_token_expires_at")
      .eq("connection_id", connectionId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    // Service-role read: prove the credential belongs to the workspace we act for.
    if (!row || row.workspace_id !== workspaceId)
      throw new GoogleApiError("token_expired", "Google isn't connected for this workspace.");
    const expiresAt = row.access_token_expires_at ? Date.parse(row.access_token_expires_at) : 0;
    if (!forceRefresh && row.access_token_enc && expiresAt - EXPIRY_SKEW_MS > Date.now()) {
      const token = decryptWithKey(row.access_token_enc, key);
      cached = { token, expiresAt };
      return token;
    }
    const refreshToken = decryptWithKey(row.refresh_token_enc, key);
    let fresh: TokenSet;
    try {
      fresh = await refreshAccess(refreshToken, requireGoogleConfig(workspaceId));
    } catch (e) {
      if (e instanceof GoogleApiError && e.code === "token_expired")
        await markReconnectNeeded(connectionId);
      throw e;
    }
    await supabaseAdmin
      .from("google_oauth_credentials")
      .update({
        access_token_enc: encryptWithKey(fresh.accessToken, key),
        access_token_expires_at: fresh.expiresAt.toISOString(),
        // Google may rotate the refresh token; keep the newest.
        ...(fresh.refreshToken
          ? { refresh_token_enc: encryptWithKey(fresh.refreshToken, key) }
          : {}),
        ...(fresh.scopes.length ? { scopes: fresh.scopes } : {}),
      })
      .eq("connection_id", connectionId);
    cached = { token: fresh.accessToken, expiresAt: fresh.expiresAt.getTime() };
    return fresh.accessToken;
  }

  return (opts) => {
    const force = opts?.forceRefresh === true;
    if (!force && cached && cached.expiresAt - EXPIRY_SKEW_MS > Date.now())
      return Promise.resolve(cached.token);
    if (!inflight) {
      inflight = load(force).finally(() => {
        inflight = null;
      });
    }
    return inflight;
  };
}

export function googleApiFor(connectionId: string, workspaceId: string): GoogleApi {
  return createGoogleApi(accessTokenProvider(connectionId, workspaceId));
}

/** Test seam: the runner and service accept an API factory. */
export type GoogleApiFactory = (connectionId: string, workspaceId: string) => GoogleApi;
