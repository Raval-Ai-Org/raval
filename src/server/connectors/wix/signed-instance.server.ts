import "server-only";
// signed-instance.server.ts — trust the instance id Wix hands back after an
// install only when its signature says Wix sent it.
//
// Wix appends `instanceId` and `signedInstance` to the post-install redirect.
// `signedInstance` is "<signature>.<data>": data is base64url JSON
// ({ instanceId, signDate, siteOwnerId, … }), signature is the base64url
// HMAC-SHA256 of the data part with the app secret. An instance id sent as
// plain text can be forged; this check is what makes it a credential.
import { createHmac, timingSafeEqual } from "node:crypto";

export type WixInstanceClaims = {
  instanceId: string;
  signDate: string | null;
  siteOwnerId: string | null;
  uid: string | null;
  permissions: string | null;
};

/** How old a signature may be when the person lands back on Mellox. */
const MAX_AGE_MS = 30 * 60_000;

const fromB64url = (s: string) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

/** The claims when the signature is valid, recent and names `instanceId`; otherwise null. */
export function verifySignedInstance(
  signed: string,
  appSecret: string,
  expectInstanceId: string,
  now = Date.now(),
): WixInstanceClaims | null {
  if (!signed || signed.length > 4096 || !appSecret) return null;
  const dot = signed.indexOf(".");
  if (dot <= 0 || dot === signed.length - 1) return null;
  const sig = fromB64url(signed.slice(0, dot));
  const data = signed.slice(dot + 1);
  const expected = createHmac("sha256", appSecret).update(data).digest();
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null;
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(fromB64url(data).toString("utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  const instanceId = str(json.instanceId);
  if (!instanceId || instanceId !== expectInstanceId) return null;
  const signDate = str(json.signDate);
  if (signDate) {
    const at = Date.parse(signDate);
    if (!Number.isFinite(at) || now - at > MAX_AGE_MS || at - now > 5 * 60_000) return null;
  }
  return {
    instanceId,
    signDate,
    siteOwnerId: str(json.siteOwnerId),
    uid: str(json.uid),
    permissions: str(json.permissions),
  };
}
