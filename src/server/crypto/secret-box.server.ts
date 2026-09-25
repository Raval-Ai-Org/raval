// secret-box.server.ts — app-layer secret encryption at rest (AES-256-GCM).
// Each feature has its own key in a server-only env var (base64 of 32 bytes),
// so rotating or leaking one key never exposes another feature's secrets.
//
// Format: v1:<iv>:<tag>:<ciphertext>, all base64url. Used by the SDR
// provisioning (SDR_SECRET_ENCRYPTION_KEY) and the Google connector
// (GOOGLE_TOKEN_ENCRYPTION_KEY).
import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export class SecretKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretKeyError";
  }
}

export function readEncryptionKey(envName: string, env = process.env): Buffer {
  const raw = env[envName];
  if (!raw) throw new SecretKeyError(`${envName} not set (server-only env)`);
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32)
    throw new SecretKeyError(`${envName} must be a base64-encoded 32-byte key`);
  return key;
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
