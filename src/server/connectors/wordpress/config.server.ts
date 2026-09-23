import "server-only";
import { readEncryptionKey } from "@/server/crypto/secret-box.server";
import { HttpError } from "@/server/http-error";

export const WORDPRESS_CALLBACK_PATH = "/api/integrations/wordpress/callback";
export const WORDPRESS_AUTH_ENDPOINT = "https://public-api.wordpress.com/oauth2/authorize";
export const WORDPRESS_TOKEN_ENDPOINT = "https://public-api.wordpress.com/oauth2/token";
export const WORDPRESS_API_ENDPOINT = "https://public-api.wordpress.com";
export const WORDPRESS_TOKEN_KEY_ENV = "WORDPRESS_TOKEN_ENCRYPTION_KEY";

export type WordPressOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export function checkWordPressOAuthConfig(env: Record<string, string | undefined> = process.env) {
  const issues: string[] = [];
  const clientId = env.WORDPRESS_CLIENT_ID?.trim() ?? "";
  const clientSecret = env.WORDPRESS_CLIENT_SECRET?.trim() ?? "";
  const redirectUri = env.WORDPRESS_REDIRECT_URI?.split(",")[0]?.trim() ?? "";
  if (!clientId) issues.push("WORDPRESS_CLIENT_ID is not set");
  if (!clientSecret) issues.push("WORDPRESS_CLIENT_SECRET is not set");
  try {
    readEncryptionKey(WORDPRESS_TOKEN_KEY_ENV, env as NodeJS.ProcessEnv);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : `${WORDPRESS_TOKEN_KEY_ENV} is invalid`);
  }
  try {
    const parsed = new URL(redirectUri || `${env.APP_URL ?? ""}${WORDPRESS_CALLBACK_PATH}`);
    if (parsed.pathname !== WORDPRESS_CALLBACK_PATH)
      issues.push(`WORDPRESS_REDIRECT_URI must end with ${WORDPRESS_CALLBACK_PATH}`);
    if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:")
      issues.push("WORDPRESS_REDIRECT_URI must use HTTPS in production");
  } catch {
    issues.push("WORDPRESS_REDIRECT_URI is not a valid URL");
  }
  return issues.length
    ? { ok: false as const, issues }
    : {
        ok: true as const,
        config: {
          clientId,
          clientSecret,
          redirectUri: redirectUri || `${env.APP_URL}${WORDPRESS_CALLBACK_PATH}`,
        },
      };
}

export function requireWordPressOAuthConfig(): WordPressOAuthConfig {
  const result = checkWordPressOAuthConfig();
  if (!result.ok) throw new HttpError(503, "WordPress.com OAuth isn't configured on this server.");
  return result.config;
}

export function wordpressTokenKey() {
  return readEncryptionKey(WORDPRESS_TOKEN_KEY_ENV);
}
