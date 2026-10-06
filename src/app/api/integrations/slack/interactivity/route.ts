import {
  enqueueSlackInbound,
  listSlackUserTargets,
  resolveActionTarget,
} from "@/server/slack/inbound.server";
import { slackApi, slackToken } from "@/server/slack/client.server";
import { slackConfig, verifySlackSignature } from "@/server/slack/security.server";
import { kickSlackQueue, slackEphemeral } from "@/server/slack/kick.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const dynamic = "force-dynamic";
const table = (name: string) => supabaseAdmin.from(name as never);
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
  let payload: Record<string, any>;
  try {
    payload = JSON.parse(new URLSearchParams(raw).get("payload") ?? "");
  } catch {
    return new Response("Invalid payload", { status: 400 });
  }
  const teamId = payload.team?.id;
  const userId = payload.user?.id;
  if (typeof teamId !== "string" || typeof userId !== "string")
    return new Response("Invalid payload", { status: 400 });
  if (payload.type === "message_action" && payload.callback_id === "mellox_create") {
    const targets = (await listSlackUserTargets(teamId, userId)).slice(0, 50);
    if (!targets.length) {
      await slackEphemeral(
        payload.response_url,
        "Link your Slack account first: in Mellox, open Settings → Slack → Get link code.",
      );
      return new Response("");
    }
    const text = String(payload.message?.text ?? "").slice(0, 8000);
    if (!text) {
      await slackEphemeral(payload.response_url, "This message has no text to create from.");
      return new Response("");
    }
    const refs: Array<{ id: string; name: string }> = [];
    for (const target of targets) {
      const { data: ref, error } = await table("slack_action_refs")
        .insert({
          workspace_id: target.workspaceId,
          installation_id: target.installation.id,
          action: "create",
          context: { text, source_ts: payload.message?.ts, source_channel: payload.channel?.id },
          expires_at: new Date(Date.now() + 600_000).toISOString(),
        } as never)
        .select("id")
        .single();
      if (error || !ref) return new Response("Could not open Mellox", { status: 503 });
      refs.push({ id: (ref as { id: string }).id, name: target.name });
    }
    const id = refs[0].id;
    const modal = {
      type: "modal",
      callback_id: "mellox_create_submit",
      private_metadata: id,
      title: { type: "plain_text", text: "Create with Mellox" },
      submit: { type: "plain_text", text: "Create draft" },
      close: { type: "plain_text", text: "Cancel" },
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: "Turn this message into a draft in Mellox.",
          },
        },
        ...(refs.length > 1
          ? [
              {
                type: "input",
                block_id: "workspace",
                label: { type: "plain_text", text: "Client workspace" },
                element: {
                  type: "static_select",
                  action_id: "target",
                  placeholder: { type: "plain_text", text: "Choose a client" },
                  options: refs.map((ref) => ({
                    text: { type: "plain_text", text: ref.name.slice(0, 75) },
                    value: ref.id,
                  })),
                },
              },
            ]
          : []),
        {
          type: "input",
          block_id: "format",
          label: { type: "plain_text", text: "Create" },
          element: {
            type: "static_select",
            action_id: "choice",
            placeholder: { type: "plain_text", text: "Choose an output" },
            options: [
              ["LinkedIn post", "linkedin_post"],
              ["Instagram post", "instagram_post"],
              ["X post", "x_post"],
              ["X thread", "x_thread"],
              ["Instagram carousel", "carousel"],
              ["Content idea", "idea"],
              ["Campaign idea", "campaign"],
              ["Customer insight", "insight"],
            ].map(([label, value]) => ({ text: { type: "plain_text", text: label }, value })),
          },
        },
      ],
    };
    try {
      await slackApi(
        await slackToken(targets[0].installation.id, targets[0].workspaceId),
        "views.open",
        {
          trigger_id: payload.trigger_id,
          view: modal,
        },
        2500,
      );
      return new Response("");
    } catch {
      await slackEphemeral(payload.response_url, "Could not open Mellox. Please try again.");
      return new Response("");
    }
  }
  const refId =
    payload.type === "view_submission"
      ? (payload.view?.state?.values?.workspace?.target?.selected_option?.value ??
        payload.view?.private_metadata)
      : payload.actions?.[0]?.value;
  if (typeof refId !== "string") return new Response("ok");
  const target = await resolveActionTarget(teamId, refId);
  if (!target) {
    await slackEphemeral(
      payload.response_url,
      "This action expired. Open Mellox for the latest version.",
    );
    return new Response("");
  }
  if (payload.type === "block_actions") {
    const { data: ref } = await table("slack_action_refs")
      .select("action")
      .eq("id", refId)
      .eq("workspace_id", target.workspaceId)
      .maybeSingle();
    if ((ref as { action?: string } | null)?.action === "changes") {
      try {
        await slackApi(
          await slackToken(target.installation.id, target.workspaceId),
          "views.open",
          {
            trigger_id: payload.trigger_id,
            view: {
              type: "modal",
              callback_id: "mellox_changes_submit",
              private_metadata: refId,
              title: { type: "plain_text", text: "Request changes" },
              submit: { type: "plain_text", text: "Send request" },
              close: { type: "plain_text", text: "Cancel" },
              blocks: [
                {
                  type: "input",
                  block_id: "reason",
                  label: { type: "plain_text", text: "What should change?" },
                  element: {
                    type: "plain_text_input",
                    action_id: "details",
                    multiline: true,
                    max_length: 1000,
                  },
                },
              ],
            },
          },
          2500,
        );
        return new Response("");
      } catch {
        await slackEphemeral(
          payload.response_url,
          "Could not open the changes form. Please try again.",
        );
        return new Response("");
      }
    }
  }
  const selected =
    payload.type === "view_submission"
      ? payload.view?.state?.values?.format?.choice?.selected_option?.value
      : undefined;
  const reason =
    payload.type === "view_submission"
      ? payload.view?.state?.values?.reason?.details?.value
      : undefined;
  await enqueueSlackInbound(target, `action:${refId}`, "action", {
    refId,
    user: userId,
    channel: payload.channel?.id,
    selected,
    reason: typeof reason === "string" ? reason.slice(0, 1000) : undefined,
    message_ts: payload.message?.ts,
  });
  kickSlackQueue();
  if (payload.type === "view_submission") return Response.json({ response_action: "clear" });
  await slackEphemeral(payload.response_url, "On it. I’ll reply here in a moment.");
  return new Response("");
}
