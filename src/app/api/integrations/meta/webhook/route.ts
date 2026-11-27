// Meta's webhook for the Page (feed, messages) and Instagram (comments,
// messages) fields. GET is Meta's one-time check of the verify token; POST is
// a delivery, refused unless X-Hub-Signature-256 matches the app secret. A
// delivery only wakes the brand's sweep (webhook.server.ts); Mellox answers
// 200 at once, as Meta expects, and does the work after the response.
import { after } from "next/server";
import { metaConfig, metaWebhookToken } from "@/server/engage/meta/config.server";
import { wakeForMetaEvent } from "@/server/engage/meta/webhook.server";
import { validWebhookSignature, webhookAccounts } from "@/lib/engage/webhook";

export const dynamic = "force-dynamic";

const MAX_BODY = 1_000_000;

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  let token: string;
  try {
    token = metaWebhookToken();
  } catch {
    return new Response("not configured", { status: 503 });
  }
  const challenge = q.get("hub.challenge") ?? "";
  if (
    q.get("hub.mode") === "subscribe" &&
    q.get("hub.verify_token") === token &&
    /^[A-Za-z0-9_-]{1,200}$/.test(challenge)
  )
    return new Response(challenge, { headers: { "Content-Type": "text/plain" } });
  return new Response("forbidden", { status: 403 });
}

export async function POST(request: Request) {
  let appSecret: string;
  try {
    appSecret = metaConfig().appSecret;
  } catch {
    return new Response("not configured", { status: 503 });
  }
  const raw = await request.text();
  if (raw.length > MAX_BODY) return new Response("too large", { status: 413 });
  if (!validWebhookSignature(raw, request.headers.get("x-hub-signature-256"), appSecret))
    return new Response("bad signature", { status: 401 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("ok");
  }
  const ids = webhookAccounts(body);
  if (ids.pageIds.length || ids.igIds.length)
    after(async () => {
      try {
        if (!(await wakeForMetaEvent(ids))) return;
        const { runDueEngage } = await import("@/server/engage/automations.server");
        await runDueEngage({ max: 10, budgetMs: 40_000 });
      } catch (error) {
        console.error("[engage] webhook wake failed", error);
      }
    });
  return new Response("ok");
}
