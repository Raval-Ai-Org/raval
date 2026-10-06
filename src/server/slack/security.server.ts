import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { connectorEncryptionKeys } from "@/server/crypto/secret-box.server";

export const SLACK_CALLBACK = "/api/integrations/slack/oauth/callback";
export const SLACK_SCOPES =
  "app_mentions:read,assistant:write,chat:write,channels:read,commands,im:history";

export function slackConfig() {
  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  const missing = [
    !clientId && "SLACK_CLIENT_ID",
    !clientSecret && "SLACK_CLIENT_SECRET",
    !signingSecret && "SLACK_SIGNING_SECRET",
  ].filter(Boolean);
  if (!clientId || !clientSecret || !signingSecret)
    throw new Error(`Slack is not set up on this server yet (missing ${missing.join(", ")}).`);
  // Same rule as Canva and Notion: a dedicated key is optional, never required.
  return {
    clientId,
    clientSecret,
    signingSecret,
    ...connectorEncryptionKeys("SLACK_TOKEN_ENCRYPTION_KEY"),
  };
}

/**
 * Where Slack sends a person back to. Slack only accepts HTTPS callbacks, and
 * the state cookie lives on the origin that started the flow, so connecting
 * works only when this server is the one Slack calls back.
 */
/** This deployment's own origin, from configuration and never from a request header. */
export function slackAppOrigin(env: Record<string, string | undefined> = process.env) {
  try {
    return new URL(env.APP_URL?.trim() || "").origin;
  } catch {
    throw new Error("Slack is not set up on this server yet.");
  }
}

export function slackOrigins(env: Record<string, string | undefined> = process.env) {
  const app = new URL(slackAppOrigin(env));
  let redirect: URL;
  try {
    redirect = new URL(env.SLACK_REDIRECT_URI?.trim() || SLACK_CALLBACK, app.origin);
  } catch {
    throw new Error("Slack is not set up on this server yet.");
  }
  if (redirect.pathname !== SLACK_CALLBACK || redirect.search || redirect.hash)
    throw new Error("Slack is not set up on this server yet.");
  if (redirect.protocol !== "https:" || redirect.origin !== app.origin)
    throw new Error(
      `Slack can only be connected on ${redirect.protocol === "https:" ? redirect.host : "the live site"}. Open Mellox there to connect.`,
    );
  return { appOrigin: app.origin, redirectUri: redirect.toString() };
}

/** Why Slack can't connect here, in words a person can act on; null when ready. */
export function slackConnectIssue(): string | null {
  try {
    slackConfig();
  } catch (error) {
    return error instanceof Error && error.message.startsWith("Slack is not set up")
      ? error.message
      : "Slack is not set up on this server yet.";
  }
  try {
    slackOrigins();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Slack is not set up on this server yet.";
  }
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
