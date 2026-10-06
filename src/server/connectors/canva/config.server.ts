import "server-only";
import { connectorEncryptionKeys, SecretKeyError } from "@/server/crypto/secret-box.server";
import { HttpError } from "@/server/http-error";

export const CANVA_SCOPES = [
  "asset:read",
  "asset:write",
  "design:content:read",
  "design:content:write",
  "design:meta:read",
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
  return { clientId, clientSecret, ...keys, ...canvaOrigins() };
}

/**
 * Canva accepts HTTPS callbacks, and for local development only
 * `http://127.0.0.1:<port>` — never `localhost`. The session lives on the
 * origin the person is using (APP_URL), so the callback hands back to it.
 */
export function canvaOrigins(appUrl = process.env.APP_URL) {
  const base = appUrl?.trim();
  if (!base) throw new HttpError(503, "Canva callback URL is not configured on this server.");
  let origin: URL;
  try {
    origin = new URL(base);
  } catch {
    throw new HttpError(503, "APP_URL must be a valid HTTPS origin for Canva.");
  }
  const local = origin.protocol === "http:" && /^(localhost|127\.0\.0\.1)$/.test(origin.hostname);
  if (origin.protocol !== "https:" && !local)
    throw new HttpError(503, "APP_URL must be a valid HTTPS origin for Canva.");
  const callbackOrigin = local
    ? `http://127.0.0.1${origin.port ? `:${origin.port}` : ""}`
    : origin.origin;
  return {
    appOrigin: origin.origin,
    redirectUri: new URL(CANVA_CALLBACK, callbackOrigin).toString(),
  };
}

/** Why Canva can't connect here, in words a person can act on; null when ready. */
export function canvaConfigurationMessage(): string | null {
  try {
    canvaConfig();
    return null;
  } catch (error) {
    return error instanceof HttpError ? error.message : "Canva is not set up on this server.";
  }
}

export function canvaConfigured() {
  try {
    canvaConfig();
    return true;
  } catch {
    return false;
  }
}
