// Client portal link tokens. The database keeps sha256(token) for access
// checks and, when SHARE_LINK_ENCRYPTION_KEY is set, the token itself
// encrypted, so "Copy link" returns the link the client already has instead
// of minting a new one (which would break it).
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import {
  decryptWithKey,
  encryptWithKey,
  readEncryptionKey,
  SecretKeyError,
} from "@/server/crypto/secret-box.server";

const KEY_ENV = "SHARE_LINK_ENCRYPTION_KEY";

export function makeShareToken(): string {
  return randomBytes(24).toString("base64url");
}

export function hashShareToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function shareKey(): Buffer | null {
  try {
    return readEncryptionKey(KEY_ENV);
  } catch (e) {
    if (e instanceof SecretKeyError) return null;
    throw e;
  }
}

/** Encrypted token for storage, or null when no key is configured. */
export function sealShareToken(token: string): string | null {
  const key = shareKey();
  return key ? encryptWithKey(token, key) : null;
}

/**
 * The stored token, if it can be recovered and still matches the current
 * hash. Null means the caller has to issue a new link.
 */
export function openShareToken(
  ciphertext: string | null | undefined,
  tokenHash: string | null | undefined,
): string | null {
  if (!ciphertext || !tokenHash) return null;
  const key = shareKey();
  if (!key) return null;
  try {
    const token = decryptWithKey(ciphertext, key);
    return hashShareToken(token) === tokenHash ? token : null;
  } catch {
    return null;
  }
}

export function shareUrl(origin: string, slug: string, token: string): string {
  return `${origin}/share/${slug}?t=${encodeURIComponent(token)}`;
}
