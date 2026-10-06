import "server-only";
import { connectorEncryptionKeys, SecretKeyError } from "@/server/crypto/secret-box.server";
import { HttpError } from "@/server/http-error";

export const NOTION_VERSION = "2026-03-11";
export function notionConfig() {
  const clientId = process.env.NOTION_CLIENT_ID;
  const clientSecret = process.env.NOTION_CLIENT_SECRET;
  const redirectUri = process.env.NOTION_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri)
    throw new HttpError(503, "Notion is not configured on this server.");
  let uri: URL;
  try {
    uri = new URL(redirectUri);
  } catch {
    throw new HttpError(503, "Notion callback URL is invalid.");
  }
  if (
    uri.pathname !== "/api/integrations/notion/callback" ||
    (uri.protocol !== "https:" && uri.hostname !== "localhost") ||
    uri.username ||
    uri.password ||
    uri.search ||
    uri.hash
  )
    throw new HttpError(503, "Notion callback URL is invalid.");
  const appUrl = process.env.APP_URL;
  if (appUrl) {
    let appOrigin: string;
    try {
      appOrigin = new URL(appUrl).origin;
    } catch {
      throw new HttpError(503, "APP_URL is invalid for the Notion callback.");
    }
    if (uri.origin !== appOrigin)
      throw new HttpError(503, "Notion callback URL must use the APP_URL origin.");
  }
  let keys: ReturnType<typeof connectorEncryptionKeys>;
  try {
    keys = connectorEncryptionKeys("NOTION_TOKEN_ENCRYPTION_KEY");
  } catch (error) {
    if (error instanceof SecretKeyError)
      throw new HttpError(503, "Notion token encryption key is missing or invalid on this server.");
    throw error;
  }
  return {
    clientId,
    clientSecret,
    redirectUri: uri.toString(),
    ...keys,
  };
}
export function notionConfigured() {
  try {
    notionConfig();
    return true;
  } catch {
    return false;
  }
}
