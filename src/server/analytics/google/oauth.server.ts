// oauth.server.ts — Google OAuth 2.0 (web server flow + PKCE) for the
// analytics connector.
//
//   createAuthUrl   single-use state (only its SHA-256 is stored, bound to the
//                   user + workspace, 20-minute expiry) + encrypted PKCE verifier
//   readAuthState   checks format, hash, user, expiry — CSRF + tenant binding
//   exchangeCode    code → tokens (refresh token required: access_type=offline)
//   refreshAccess   refresh token → access token; invalid_grant = reconnect
//   revokeToken     best-effort revoke on disconnect
//
// Tokens are never logged, returned to the browser or written to audit rows.
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { HttpError } from "@/server/http-error";
import { decryptWithKey, encryptWithKey } from "@/server/crypto/secret-box.server";
import { safeReturnPath } from "@/server/connectors/return-url";
import { fetchWithRetry, UpstreamError } from "@/server/upstream";
import {
  allowedGoogleReturnOrigin,
  GOOGLE_REQUESTED_SCOPES,
  GOOGLE_SCOPES,
  googleTokenKey,
  requireGoogleConfig,
  type GoogleConfig,
} from "./config.server";
import { GoogleApiError } from "./errors";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const STATE_TTL_MS = 20 * 60_000;
const STATE_FORMAT = /^[A-Za-z0-9_-]{32,128}$/;
export const PROVIDER = "google";

export class GoogleConnectError extends HttpError {
  constructor(message: string, status = 400) {
    super(status, message);
    this.name = "GoogleConnectError";
  }
}

export const hashState = (state: string) => createHash("sha256").update(state).digest("hex");

function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function buildAuthUrl(
  config: GoogleConfig,
  state: string,
  codeChallenge: string,
  loginHint?: string | null,
): string {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_REQUESTED_SCOPES.join(" "));
  // offline + consent: always return a refresh token, even on reconnect.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (loginHint) url.searchParams.set("login_hint", loginHint);
  return url.toString();
}

export async function createAuthUrl(args: {
  workspaceId: string;
  userId: string;
  returnOrigin?: string | null;
  returnPath?: string | null;
  loginHint?: string | null;
}): Promise<{ url: string; expiresInSeconds: number }> {
  const config = requireGoogleConfig(args.workspaceId);
  const returnOrigin = allowedGoogleReturnOrigin(args.returnOrigin, {
    allowLocal: process.env.NODE_ENV !== "production",
  });
  if (args.returnOrigin && !returnOrigin) {
    throw new GoogleConnectError(
      "Google can't send you back to this address. Open Mellox on its main address, or add it to GOOGLE_ALLOWED_RETURN_ORIGINS.",
    );
  }
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const now = Date.now();
  await supabaseAdmin
    .from("connector_install_states")
    .delete()
    .eq("provider", PROVIDER)
    .lt("expires_at", new Date(now - 24 * 3600_000).toISOString());
  const { error } = await supabaseAdmin.from("connector_install_states").insert({
    state_hash: hashState(state),
    workspace_id: args.workspaceId,
    user_id: args.userId,
    provider: PROVIDER,
    expires_at: new Date(now + STATE_TTL_MS).toISOString(),
    return_origin: returnOrigin,
    return_path: safeReturnPath(args.returnPath),
    pkce_verifier_enc: encryptWithKey(verifier, googleTokenKey()),
  });
  if (error) throw new Error(`Couldn't start the Google connection: ${error.message}`);
  return {
    url: buildAuthUrl(config, state, pkceChallenge(verifier), args.loginHint),
    expiresInSeconds: STATE_TTL_MS / 1000,
  };
}

export type AuthState = {
  id: string;
  workspaceId: string;
  userId: string;
  createdAt: string;
  consumedAt: string | null;
  returnPath: string | null;
  verifier: string;
};

const EXPIRED = "This connection link has expired. Start the Google connection again from Mellox.";

/** Look up a state for the returning user without consuming it (a failed completion can retry). */
export async function readAuthState(state: string, userId: string): Promise<AuthState> {
  if (!STATE_FORMAT.test(state)) {
    throw new GoogleConnectError(
      "This connection link is invalid. Start the connection again from Mellox.",
    );
  }
  const { data: row, error } = await supabaseAdmin
    .from("connector_install_states")
    .select(
      "id, workspace_id, user_id, expires_at, consumed_at, created_at, return_path, pkce_verifier_enc",
    )
    .eq("state_hash", hashState(state))
    .eq("provider", PROVIDER)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) throw new GoogleConnectError(EXPIRED);
  if (row.user_id !== userId) {
    throw new GoogleConnectError(
      "This connection was started by a different Mellox user. Sign in as that user or start again.",
    );
  }
  if (Date.parse(row.expires_at) < Date.now()) throw new GoogleConnectError(EXPIRED);
  if (!row.pkce_verifier_enc) throw new GoogleConnectError(EXPIRED);
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    createdAt: row.created_at,
    consumedAt: row.consumed_at,
    returnPath: safeReturnPath(row.return_path),
    verifier: decryptWithKey(row.pkce_verifier_enc, googleTokenKey()),
  };
}

/** Consume a state exactly once. Returns false when another request already used it. */
export async function consumeAuthState(state: AuthState): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("connector_install_states")
    .update({ consumed_at: new Date().toISOString(), pkce_verifier_enc: null })
    .eq("id", state.id)
    .is("consumed_at", null)
    .select("id");
  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
}

/** Where the callback should send the user: the allowlisted origin the flow started from. */
export async function authReturnOrigin(state: string): Promise<string | null> {
  if (!STATE_FORMAT.test(state)) return null;
  const { data } = await supabaseAdmin
    .from("connector_install_states")
    .select("return_origin")
    .eq("state_hash", hashState(state))
    .eq("provider", PROVIDER)
    .maybeSingle();
  if (!data?.return_origin) return null;
  return allowedGoogleReturnOrigin(data.return_origin, { allowLocal: true });
}

// ── Token endpoint ──────────────────────────────────────────────────────────
const TokenResponse = z.object({
  access_token: z.string().min(10),
  expires_in: z.number().int().positive().optional(),
  refresh_token: z.string().optional(),
  scope: z.string().optional(),
  id_token: z.string().optional(),
  token_type: z.string().optional(),
});

export type TokenSet = {
  accessToken: string;
  expiresAt: Date;
  refreshToken: string | null;
  scopes: string[];
  idToken: string | null;
};

async function tokenRequest(params: Record<string, string>): Promise<TokenSet> {
  let res: Response;
  try {
    res = await fetchWithRetry(
      TOKEN_ENDPOINT,
      {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: new URLSearchParams(params).toString(),
        cache: "no-store",
      },
      {
        timeoutMs: 15_000,
        retries: 2,
        onTransportError: (f) =>
          new UpstreamError(f.kind === "timeout" ? 504 : 502, `Google OAuth ${f.kind}`, {
            provider: "google",
          }),
      },
    );
  } catch (e) {
    if (e instanceof UpstreamError)
      throw new GoogleApiError("upstream", "Google sign-in didn't respond.");
    throw e;
  }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const code = typeof body?.error === "string" ? body.error : "";
    if (code === "invalid_grant")
      throw new GoogleApiError("token_expired", "Google access has expired or was removed.");
    if (
      code === "invalid_client" ||
      code === "unauthorized_client" ||
      code === "redirect_uri_mismatch"
    )
      throw new GoogleApiError(
        "config",
        "The Google OAuth client for this server is misconfigured.",
      );
    throw new GoogleApiError(res.status >= 500 ? "upstream" : "internal", "Google sign-in failed.");
  }
  const parsed = TokenResponse.safeParse(body);
  if (!parsed.success)
    throw new GoogleApiError("upstream", "Google sign-in returned an unexpected response.");
  const t = parsed.data;
  return {
    accessToken: t.access_token,
    expiresAt: new Date(Date.now() + (t.expires_in ?? 3600) * 1000),
    refreshToken: t.refresh_token ?? null,
    scopes: (t.scope ?? "").split(/\s+/).filter(Boolean),
    idToken: t.id_token ?? null,
  };
}

export function exchangeCode(
  code: string,
  verifier: string,
  config: GoogleConfig,
): Promise<TokenSet> {
  return tokenRequest({
    grant_type: "authorization_code",
    code,
    code_verifier: verifier,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
  });
}

export function refreshAccess(refreshToken: string, config: GoogleConfig): Promise<TokenSet> {
  return tokenRequest({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });
}

/** Best effort: a failed revoke never blocks a disconnect. */
export async function revokeToken(token: string): Promise<boolean> {
  try {
    const res = await fetch(REVOKE_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Identity claims from the id_token returned by Google's token endpoint over
 * TLS to this server. Used only to label the connection (email) and dedupe it
 * (sub) — never for authorization, which comes from the Mellox session.
 */
export function identityFromIdToken(idToken: string | null): { sub: string; email: string } | null {
  if (!idToken) return null;
  const [, payload] = idToken.split(".");
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    const sub = typeof claims.sub === "string" ? claims.sub : "";
    const email = typeof claims.email === "string" ? claims.email : "";
    if (!/^\d{1,40}$/.test(sub)) return null;
    return { sub, email: email.slice(0, 200) };
  } catch {
    return null;
  }
}

export function scopeFlags(scopes: readonly string[]): {
  analytics: boolean;
  searchConsole: boolean;
} {
  return {
    analytics: scopes.includes(GOOGLE_SCOPES.analytics),
    searchConsole: scopes.includes(GOOGLE_SCOPES.searchConsole),
  };
}
