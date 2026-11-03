import "server-only";
import { connectorEncryptionKeys, SecretKeyError } from "@/server/crypto/secret-box.server";
import { allowedReturnOriginFrom } from "@/server/connectors/return-url";
import { HttpError } from "@/server/http-error";

export const WIX_CALLBACK_PATH = "/api/integrations/wix/callback";
export const WIX_TOKEN_KEY_ENV = "WIX_TOKEN_ENCRYPTION_KEY";

export type WixConfig = {
  appId: string;
  appSecret: string;
  redirectUri: string;
  shareUrlId: string | null;
};

export function checkWixConfig(env: Record<string, string | undefined> = process.env) {
  const issues: string[] = [];
  const appId = env.WIX_CLIENT_ID?.trim() ?? "";
  const appSecret = env.WIX_CLIENT_SECRET?.trim() ?? "";
  const shareUrlId = env.WIX_SHARE_URL_ID?.trim() || null;
  let redirectUri = env.WIX_REDIRECT_URI?.split(",")[0]?.trim() ?? "";
  if (!appId) issues.push("WIX_CLIENT_ID is not set");
  if (!appSecret) issues.push("WIX_CLIENT_SECRET is not set");
  try {
    connectorEncryptionKeys(WIX_TOKEN_KEY_ENV, env);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : `${WIX_TOKEN_KEY_ENV} is invalid`);
  }
  if (!redirectUri) redirectUri = `${(env.APP_URL ?? "").replace(/\/+$/, "")}${WIX_CALLBACK_PATH}`;
  try {
    const url = new URL(redirectUri);
    if (url.pathname !== WIX_CALLBACK_PATH)
      issues.push(`WIX_REDIRECT_URI must end with ${WIX_CALLBACK_PATH}`);
    // Wix only redirects to HTTPS after an install.
    if (url.protocol !== "https:" && !/^(localhost|127\.0\.0\.1)$/.test(url.hostname))
      issues.push("WIX_REDIRECT_URI must use https");
  } catch {
    issues.push("WIX_REDIRECT_URI is not a valid URL");
  }
  return issues.length
    ? { ok: false as const, issues }
    : { ok: true as const, config: { appId, appSecret, redirectUri, shareUrlId } };
}

export function requireWixConfig(): WixConfig {
  const result = checkWixConfig();
  if (!result.ok) throw new HttpError(503, "Wix isn't set up on this server yet.");
  return result.config;
}

export function wixKeys() {
  try {
    return connectorEncryptionKeys(WIX_TOKEN_KEY_ENV);
  } catch (error) {
    if (error instanceof SecretKeyError)
      throw new HttpError(503, "Wix isn't set up on this server yet.");
    throw error;
  }
}

export function allowedWixReturnOrigin(candidate: string | null | undefined) {
  return allowedReturnOriginFrom(candidate, process.env, {
    allowLocal: process.env.NODE_ENV !== "production",
    extraOrigins: process.env.GITHUB_ALLOWED_RETURN_ORIGINS,
  });
}
