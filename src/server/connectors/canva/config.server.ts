import "server-only";
import { readEncryptionKey } from "@/server/crypto/secret-box.server";
import { HttpError } from "@/server/http-error";

export const CANVA_SCOPES = [
  "asset:read",
  "asset:write",
  "design:content:read",
  "design:content:write",
  "design:meta:read",
  "profile:read", // GET /users/me/capabilities for Preview availability.
] as const;
export const CANVA_CALLBACK = "/api/integrations/canva/callback";

export function canvaMagicLayersEnabled(
  value = process.env.FEATURE_FLAG_CANVA_MAGIC_LAYERS_ENABLED,
) {
  return value === "true";
}

export function canvaConfig() {
  const clientId = process.env.CANVA_CLIENT_ID;
  const clientSecret = process.env.CANVA_CLIENT_SECRET;
  const key = readEncryptionKey("CANVA_TOKEN_ENCRYPTION_KEY");
  if (!clientId || !clientSecret)
    throw new HttpError(503, "Canva is not configured on this server.");
  const base = process.env.APP_URL?.replace(/\/$/, "");
  if (!base) throw new HttpError(503, "Canva callback URL is not configured.");
  const redirectUri = new URL(CANVA_CALLBACK, base).toString();
  return { clientId, clientSecret, key, redirectUri };
}

export function canvaConfigured() {
  try {
    canvaConfig();
    return true;
  } catch {
    return false;
  }
}
