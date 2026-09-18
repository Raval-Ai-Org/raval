// config.server.ts — Google Analytics / Search Console OAuth client config.
// A web OAuth client separate from the Supabase sign-in client, so data access
// (sensitive read-only scopes) never rides on the login consent screen.
import "server-only";
import { isGoogleAnalyticsEnabled } from "@/lib/feature-flags";
import { getAppUrl } from "@/server/env";
import { HttpError } from "@/server/http-error";
import { readEncryptionKey } from "@/server/crypto/secret-box.server";
import { allowedReturnOriginFrom } from "@/server/connectors/return-url";

type Env = Record<string, string | undefined>;

export const GOOGLE_SCOPES = {
  analytics: "https://www.googleapis.com/auth/analytics.readonly",
  searchConsole: "https://www.googleapis.com/auth/webmasters.readonly",
} as const;

export const GOOGLE_REQUESTED_SCOPES = [
  "openid",
  "email",
  GOOGLE_SCOPES.analytics,
  GOOGLE_SCOPES.searchConsole,
] as const;

export const CALLBACK_PATH = "/api/integrations/google/callback";
export const TOKEN_KEY_ENV = "GOOGLE_TOKEN_ENCRYPTION_KEY";

export type GoogleConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export type GoogleConfigCheck =
  { ok: true; config: GoogleConfig } | { ok: false; issues: string[] };

export function checkGoogleConfig(env: Env = process.env): GoogleConfigCheck {
  const issues: string[] = [];
  const clientId = env.GOOGLE_ANALYTICS_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.GOOGLE_ANALYTICS_CLIENT_SECRET?.trim() ?? "";
  if (!clientId) issues.push("GOOGLE_ANALYTICS_CLIENT_ID is not set");
  else if (!/\.apps\.googleusercontent\.com$/.test(clientId))
    issues.push("GOOGLE_ANALYTICS_CLIENT_ID doesn't look like a Google OAuth client id");
  if (!clientSecret) issues.push("GOOGLE_ANALYTICS_CLIENT_SECRET is not set");
  try {
    readEncryptionKey(TOKEN_KEY_ENV, env as NodeJS.ProcessEnv);
  } catch (e) {
    issues.push(e instanceof Error ? e.message : `${TOKEN_KEY_ENV} is invalid`);
  }
  let redirectUri = env.GOOGLE_ANALYTICS_REDIRECT_URI?.trim() || "";
  if (!redirectUri) {
    const base = (env.APP_URL || env.NEXT_PUBLIC_APP_URL || "").replace(/\/+$/, "");
    redirectUri = base ? `${base}${CALLBACK_PATH}` : `${getAppUrl()}${CALLBACK_PATH}`;
  }
  try {
    const u = new URL(redirectUri);
    if (!u.pathname.endsWith(CALLBACK_PATH))
      issues.push(`GOOGLE_ANALYTICS_REDIRECT_URI must end with ${CALLBACK_PATH}`);
  } catch {
    issues.push("GOOGLE_ANALYTICS_REDIRECT_URI is not a valid URL");
  }
  if (issues.length) return { ok: false, issues };
  return { ok: true, config: { clientId, clientSecret, redirectUri } };
}

export class GoogleNotConfiguredError extends HttpError {
  constructor(readonly issues: string[]) {
    super(
      503,
      "Google Analytics isn't set up on this server yet. Ask your admin to add the Google OAuth settings.",
    );
    this.name = "GoogleNotConfiguredError";
  }
}

export function isGoogleConfigured(workspaceId?: string): boolean {
  return isGoogleAnalyticsEnabled(workspaceId) && checkGoogleConfig().ok;
}

export function requireGoogleConfig(workspaceId?: string): GoogleConfig {
  const check = checkGoogleConfig();
  if (!check.ok) throw new GoogleNotConfiguredError(check.issues);
  if (!isGoogleAnalyticsEnabled(workspaceId))
    throw new GoogleNotConfiguredError(["feature disabled"]);
  return check.config;
}

export function googleTokenKey(): Buffer {
  return readEncryptionKey(TOKEN_KEY_ENV);
}

/** Origins the Google callback may hand the user back to. */
export function allowedGoogleReturnOrigin(
  candidate: string | null | undefined,
  opts: { allowLocal: boolean },
  env: Env = process.env,
): string | null {
  return allowedReturnOriginFrom(candidate, env, {
    ...opts,
    extraOrigins: [env.GOOGLE_ALLOWED_RETURN_ORIGINS, env.GITHUB_ALLOWED_RETURN_ORIGINS]
      .filter(Boolean)
      .join(","),
  });
}
