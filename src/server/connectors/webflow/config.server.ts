import "server-only";
import { readEncryptionKey } from "@/server/crypto/secret-box.server";
import { allowedReturnOriginFrom } from "@/server/connectors/return-url";
import { HttpError } from "@/server/http-error";

export const WEBFLOW_SCOPES = [
  "authorized_user:read",
  "sites:read",
  "sites:write",
  "pages:read",
  "pages:write",
  "cms:read",
  "cms:write",
] as const;

/** What Mellox needs to change a site (fixes, articles); older connections lack them. */
export const WEBFLOW_WRITE_SCOPES = ["sites:write", "pages:write", "cms:write"] as const;

export function missingWebflowWriteScopes(scopes: readonly string[] | null | undefined): string[] {
  const granted = new Set(scopes ?? []);
  return WEBFLOW_WRITE_SCOPES.filter((s) => !granted.has(s));
}
export const WEBFLOW_CALLBACK_PATH = "/api/integrations/webflow/callback";
export const WEBFLOW_TOKEN_KEY_ENV = "WEBFLOW_TOKEN_ENCRYPTION_KEY";

export type WebflowConfig = { clientId: string; clientSecret: string; redirectUri: string };

export function checkWebflowConfig(env: Record<string, string | undefined> = process.env) {
  const issues: string[] = [];
  const clientId = env.WEBFLOW_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.WEBFLOW_CLIENT_SECRET?.trim() ?? "";
  let redirectUri = env.WEBFLOW_REDIRECT_URI?.split(",")[0]?.trim() ?? "";
  if (!clientId) issues.push("WEBFLOW_CLIENT_ID is not set");
  if (!clientSecret) issues.push("WEBFLOW_CLIENT_SECRET is not set");
  try {
    readEncryptionKey(WEBFLOW_TOKEN_KEY_ENV, env as NodeJS.ProcessEnv);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : `${WEBFLOW_TOKEN_KEY_ENV} is invalid`);
  }
  if (!redirectUri)
    redirectUri = `${(env.APP_URL ?? "").replace(/\/+$/, "")}${WEBFLOW_CALLBACK_PATH}`;
  try {
    if (new URL(redirectUri).pathname !== WEBFLOW_CALLBACK_PATH)
      issues.push(`WEBFLOW_REDIRECT_URI must end with ${WEBFLOW_CALLBACK_PATH}`);
  } catch {
    issues.push("WEBFLOW_REDIRECT_URI is not a valid URL");
  }
  return issues.length
    ? { ok: false as const, issues }
    : { ok: true as const, config: { clientId, clientSecret, redirectUri } };
}

export function requireWebflowConfig(): WebflowConfig {
  const result = checkWebflowConfig();
  if (!result.ok) throw new HttpError(503, "Webflow isn't configured on this server.");
  return result.config;
}

export function webflowTokenKey() {
  return readEncryptionKey(WEBFLOW_TOKEN_KEY_ENV);
}

export function allowedWebflowReturnOrigin(candidate: string | null | undefined) {
  return allowedReturnOriginFrom(candidate, process.env, {
    allowLocal: process.env.NODE_ENV !== "production",
    extraOrigins: process.env.GITHUB_ALLOWED_RETURN_ORIGINS,
  });
}
