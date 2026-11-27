// webhook.ts — Meta's webhook for Pages and Instagram. Pure: the app secret
// is passed in. Mellox only uses a delivery as a nudge ("this Page has
// something new"); the comment or message itself is read through the normal
// sweep, so nothing in the body is trusted beyond the account id.
import { createHmac, timingSafeEqual } from "node:crypto";

/** X-Hub-Signature-256: `sha256=<hex HMAC of the raw body with the app secret>`. */
export function validWebhookSignature(
  raw: string,
  header: string | null,
  appSecret: string,
): boolean {
  if (!header || !appSecret) return false;
  const m = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
  if (!m) return false;
  const given = Buffer.from(m[1].toLowerCase(), "hex");
  const expected = createHmac("sha256", appSecret).update(raw, "utf8").digest();
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const ID_RE = /^[0-9]{1,40}$/;

/** The Page ids (`object: page`) and Instagram account ids (`object: instagram`) a delivery is about. */
export function webhookAccounts(body: unknown): { pageIds: string[]; igIds: string[] } {
  const pageIds = new Set<string>();
  const igIds = new Set<string>();
  if (body && typeof body === "object") {
    const { object, entry } = body as { object?: unknown; entry?: unknown };
    if (Array.isArray(entry))
      for (const e of entry.slice(0, 200)) {
        const id = e && typeof e === "object" ? (e as { id?: unknown }).id : null;
        const value = typeof id === "number" ? String(id) : id;
        if (typeof value !== "string" || !ID_RE.test(value)) continue;
        if (object === "page") pageIds.add(value);
        else if (object === "instagram") igIds.add(value);
      }
  }
  return { pageIds: [...pageIds], igIds: [...igIds] };
}
