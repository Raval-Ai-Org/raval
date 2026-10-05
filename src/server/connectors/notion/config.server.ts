import "server-only";
import { readEncryptionKey } from "@/server/crypto/secret-box.server";
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
    (uri.protocol !== "https:" && uri.hostname !== "localhost")
  )
    throw new HttpError(503, "Notion callback URL is invalid.");
  return {
    clientId,
    clientSecret,
    redirectUri: uri.toString(),
    key: readEncryptionKey("NOTION_TOKEN_ENCRYPTION_KEY"),
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
