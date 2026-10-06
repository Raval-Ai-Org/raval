import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { readEncryptionKey } from "@/server/crypto/secret-box.server";

export const SLACK_REDIRECT = "https://mellox.ai/api/integrations/slack/oauth/callback";
export const SLACK_SCOPES =
  "app_mentions:read,assistant:write,chat:write,channels:read,commands,im:history";

export function slackConfig() {
  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  if (!clientId || !clientSecret || !signingSecret) throw new Error("Slack is not configured");
  return {
    clientId,
    clientSecret,
    signingSecret,
    key: readEncryptionKey("SLACK_TOKEN_ENCRYPTION_KEY"),
  };
}

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function safeEqualHex(a: string, b: string): boolean {
  if (!/^[a-f0-9]{64}$/i.test(a) || !/^[a-f0-9]{64}$/i.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

export function verifySlackSignature(
  raw: string,
  headers: Headers,
  secret: string,
  now = Date.now(),
) {
  const timestamp = headers.get("x-slack-request-timestamp") ?? "";
  const signature = headers.get("x-slack-signature") ?? "";
  if (!/^\d{10}$/.test(timestamp) || !/^v0=[a-f0-9]{64}$/i.test(signature)) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > 300) return false;
  const expected = createHmac("sha256", secret).update(`v0:${timestamp}:${raw}`).digest("hex");
  return safeEqualHex(signature.slice(3), expected);
}

export function slackText(value: string, max = 2900) {
  return value.slice(0, max).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
