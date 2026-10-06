import "server-only";
import { connectorEncryptionKeys, SecretKeyError } from "@/server/crypto/secret-box.server";
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
  if (!clientId || !clientSecret)
    throw new HttpError(503, "Canva client credentials are missing on this server.");
  let keys: ReturnType<typeof connectorEncryptionKeys>;
  try {
    keys = connectorEncryptionKeys("CANVA_TOKEN_ENCRYPTION_KEY");
  } catch (error) {
    if (error instanceof SecretKeyError)
      throw new HttpError(503, "Canva token encryption key is missing or invalid on this server.");
    throw error;
  }
  const base = process.env.APP_URL?.replace(/\/$/, "");
  if (!base) throw new HttpError(503, "Canva callback URL is not configured on this server.");
  let redirectUri: string;
  try {
    const origin = new URL(base);
    if (
      origin.protocol !== "https:" &&
      !(origin.protocol === "http:" && origin.hostname === "localhost")
    )
      throw new Error("Invalid Canva callback origin");
    redirectUri = new URL(CANVA_CALLBACK, origin).toString();
  } catch {
    throw new HttpError(503, "APP_URL must be a valid HTTPS origin for Canva.");
  }
  return { clientId, clientSecret, ...keys, redirectUri };
}

export function canvaConfigured() {
  try {
    canvaConfig();
    return true;
  } catch {
    return false;
  }
}
