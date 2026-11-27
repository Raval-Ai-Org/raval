// meta-signed.ts — Meta's signed_request (data deletion and deauthorize
// callbacks) and the confirmation code Mellox hands back. Pure: the app
// secret is passed in.
//
// A signed_request is `<base64url HMAC-SHA256 of payload>.<base64url JSON>`,
// signed with the app secret. Anything that doesn't verify is refused.
import { createHmac, timingSafeEqual } from "node:crypto";

export type MetaSignedPayload = { userId: string; issuedAt: number | null };

const USER_RE = /^[0-9]{1,40}$/;

function b64url(input: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(input)) return null;
  return Buffer.from(input, "base64url");
}

export function parseSignedRequest(signed: string, appSecret: string): MetaSignedPayload | null {
  if (!signed || signed.length > 4_096 || !appSecret) return null;
  const [sig, body, extra] = signed.split(".");
  if (!sig || !body || extra !== undefined) return null;
  const given = b64url(sig);
  const raw = b64url(body);
  if (!given || !raw) return null;
  const expected = createHmac("sha256", appSecret).update(body).digest();
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let data: { algorithm?: unknown; user_id?: unknown; issued_at?: unknown };
  try {
    data = JSON.parse(raw.toString("utf8"));
  } catch {
    return null;
  }
  if (typeof data.algorithm !== "string" || data.algorithm.toUpperCase() !== "HMAC-SHA256")
    return null;
  const userId = typeof data.user_id === "number" ? String(data.user_id) : data.user_id;
  if (typeof userId !== "string" || !USER_RE.test(userId)) return null;
  return {
    userId,
    issuedAt: typeof data.issued_at === "number" ? data.issued_at : null,
  };
}

/**
 * A code the person can check at /data-deletion/status. It carries the
 * request time and is signed, so the status page needs no table and a code
 * can't be made up.
 */
export function deletionCode(at: number, appSecret: string): string {
  const t = Math.floor(at / 1000).toString(36);
  const mac = createHmac("sha256", appSecret)
    .update(`mellox-data-deletion:${t}`)
    .digest("base64url")
    .slice(0, 16);
  return `${t}-${mac}`;
}

/** The request time a code stands for, or null when it isn't one of ours. */
export function readDeletionCode(code: string, appSecret: string): number | null {
  const m = /^([0-9a-z]{1,10})-([A-Za-z0-9_-]{16})$/.exec(code ?? "");
  if (!m || !appSecret) return null;
  const at = parseInt(m[1], 36) * 1000;
  if (!Number.isFinite(at)) return null;
  const expected = deletionCode(at, appSecret);
  const a = Buffer.from(expected);
  const b = Buffer.from(code);
  return a.length === b.length && timingSafeEqual(a, b) ? at : null;
}
