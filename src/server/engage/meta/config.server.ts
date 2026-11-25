// config.server.ts — Mellox's own Meta app (Facebook Login for Business).
// The brand never brings a Meta app or a token of its own.
import "server-only";
import { connectorEncryptionKeys, SecretKeyError } from "@/server/crypto/secret-box.server";
import { HttpError } from "@/server/http-error";

export const META_CALLBACK_PATH = "/api/integrations/meta/callback";

/** What Phase 1 asks for: read and answer comments on the brand's own posts. */
export const META_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_read_user_content",
  "pages_manage_engagement",
  "instagram_basic",
  "instagram_manage_comments",
  "business_management",
] as const;

export function metaConfig() {
  const appId = process.env.META_APP_ID?.trim();
  const appSecret = process.env.META_APP_SECRET?.trim();
  const redirectUri = process.env.META_REDIRECT_URI?.trim();
  if (!appId || !appSecret || !redirectUri)
    throw new HttpError(503, "Instagram and Facebook replies are not configured on this server.");
  if (!/^[0-9]{5,32}$/.test(appId)) throw new HttpError(503, "META_APP_ID is invalid.");
  let uri: URL;
  try {
    uri = new URL(redirectUri);
  } catch {
    throw new HttpError(503, "META_REDIRECT_URI is invalid.");
  }
  if (
    uri.pathname !== META_CALLBACK_PATH ||
    (uri.protocol !== "https:" && uri.hostname !== "localhost") ||
    uri.username ||
    uri.password ||
    uri.search ||
    uri.hash
  )
    throw new HttpError(503, "META_REDIRECT_URI is invalid.");
  const appUrl = process.env.APP_URL;
  if (appUrl) {
    let appOrigin: string;
    try {
      appOrigin = new URL(appUrl).origin;
    } catch {
      throw new HttpError(503, "APP_URL is invalid for the Meta callback.");
    }
    if (uri.origin !== appOrigin)
      throw new HttpError(503, "META_REDIRECT_URI must use the APP_URL origin.");
  }
  const version = (process.env.META_GRAPH_VERSION ?? "v24.0").trim();
  if (!/^v\d{1,2}\.\d$/.test(version)) throw new HttpError(503, "META_GRAPH_VERSION is invalid.");
  const loginConfigId = process.env.META_LOGIN_CONFIG_ID?.trim() || null;
  if (loginConfigId && !/^[0-9]{5,32}$/.test(loginConfigId))
    throw new HttpError(503, "META_LOGIN_CONFIG_ID is invalid.");
  let keys: ReturnType<typeof connectorEncryptionKeys>;
  try {
    keys = connectorEncryptionKeys("META_TOKEN_ENCRYPTION_KEY");
  } catch (error) {
    if (error instanceof SecretKeyError)
      throw new HttpError(503, "Meta token encryption key is missing or invalid on this server.");
    throw error;
  }
  return { appId, appSecret, redirectUri: uri.toString(), version, loginConfigId, ...keys };
}

export function metaConfigured(): boolean {
  try {
    metaConfig();
    return true;
  } catch {
    return false;
  }
}
