import { resolveSlackTarget, enqueueSlackInbound } from "@/server/slack/inbound.server";
import { slackConfig, verifySlackSignature } from "@/server/slack/security.server";
import { hintUnlinkedSlackUser, kickSlackQueue } from "@/server/slack/kick.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const raw = await request.text();
  if (raw.length > 1_000_000) return new Response("Too large", { status: 413 });
  let secret: string;
  try {
    secret = slackConfig().signingSecret;
  } catch {
    return new Response("Unavailable", { status: 503 });
  }
  if (!verifySlackSignature(raw, request.headers, secret))
    return new Response("Unauthorized", { status: 401 });
  let body: Record<string, any>;
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("Invalid payload", { status: 400 });
  }
  if (body.type === "url_verification" && typeof body.challenge === "string")
    return Response.json({ challenge: body.challenge });
  if (
    body.type !== "event_callback" ||
    typeof body.event_id !== "string" ||
    typeof body.team_id !== "string"
  )
    return new Response("Invalid payload", { status: 400 });
  const event = body.event as Record<string, any> | undefined;
  if (event?.type === "app_uninstalled") {
    await supabaseAdmin
      .from("slack_installations" as never)
      .update({
        status: "reconnect_needed",
        bot_token_enc: "",
        last_error: "app_uninstalled",
        updated_at: new Date().toISOString(),
      } as never)
      .eq("team_id", body.team_id);
    return new Response("ok");
  }
  if (!event || !["app_mention", "message", "app_home_opened"].includes(event.type))
    return new Response("ok");
  if (event.type === "message" && (event.channel_type !== "im" || event.bot_id || event.subtype))
    return new Response("ok");
  if (event.type === "app_mention" && (event.bot_id || typeof event.channel !== "string"))
    return new Response("ok");
  const text = typeof event.text === "string" ? event.text.slice(0, 16000) : "";
  const link = /^\s*link\s+([A-Z0-9_-]{12})\s*$/i.exec(text);
  const target = await resolveSlackTarget({
    teamId: body.team_id,
    channelId: event.type === "app_mention" ? event.channel : undefined,
    slackUserId: event.user,
    code: link?.[1],
  });
  if (!target) {
    if (event.type === "message") hintUnlinkedSlackUser(body.team_id, event.channel);
    return new Response("ok");
  }
  await enqueueSlackInbound(target, `event:${body.event_id}`, "event", {
    type: event.type,
    channel: event.channel,
    user: event.user,
    text,
    ts: event.ts,
    thread_ts: event.thread_ts,
    linked: !!link,
  });
  kickSlackQueue();
  return new Response("ok");
}
