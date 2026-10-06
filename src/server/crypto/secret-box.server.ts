// secret-box.server.ts — app-layer secret encryption at rest (AES-256-GCM).
// Most features use their own server-only base64 key. Canva and Notion derive
// separate keys from the required Supabase service credential when available.
//
// Format: v1:<iv>:<tag>:<ciphertext>, all base64url. Used by the SDR
// provisioning (SDR_SECRET_ENCRYPTION_KEY) and the Google connector
// (GOOGLE_TOKEN_ENCRYPTION_KEY).
import "server-only";
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

export class SecretKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretKeyError";
  }
}

export function readEncryptionKey(
  envName: string,
  env: Record<string, string | undefined> = process.env,
): Buffer {
  const raw = env[envName];
  if (!raw) throw new SecretKeyError(`${envName} not set (server-only env)`);
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32)
    throw new SecretKeyError(`${envName} must be a base64-encoded 32-byte key`);
  return key;
}

/**
 * Connector grants use a stable, provider-specific key even when a deployment
 * has not configured separate token keys. A valid explicit key remains a read
 * key for grants written before this fallback was introduced.
 */
export function connectorEncryptionKeys(
  envName: string,
  env: Record<string, string | undefined> = process.env,
) {
  const root = env.SUPABASE_SERVICE_ROLE_KEY;
  const derived =
    root && root.length >= 32
      ? Buffer.from(hkdfSync("sha256", root, "mellox-connector-tokens-v1", envName, 32))
      : null;
  let explicit: Buffer | null = null;
  if (env[envName]) {
    try {
      explicit = readEncryptionKey(envName, env);
    } catch (error) {
      if (!(error instanceof SecretKeyError)) throw error;
    }
  }
  const key = derived ?? explicit;
  if (!key)
    throw new SecretKeyError(
      `${envName} requires a base64 32-byte key or SUPABASE_SERVICE_ROLE_KEY`,
    );
  return {
    key,
    readKeys: explicit && !explicit.equals(key) ? [key, explicit] : [key],
  };
}

export function encryptWithKey(plaintext: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `v1:${iv.toString("base64url")}:${cipher.getAuthTag().toString("base64url")}:${enc.toString("base64url")}`;
}

export function decryptWithKey(payload: string, key: Buffer): string {
  const [ver, ivB64, tagB64, ctB64] = payload.split(":");
  if (ver !== "v1" || !ivB64 || !tagB64 || ctB64 === undefined) {
    throw new Error("Unknown secret format");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function decryptWithKeys(payload: string, keys: readonly Buffer[]): string {
  for (const key of keys) {
    try {
      return decryptWithKey(payload, key);
    } catch {
      // Try an older connector key before treating this grant as unreadable.
    }
  }
  throw new Error("No configured key could decrypt this secret");
}
