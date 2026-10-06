import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { createServerFn } from "@/server/server-fn";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireWorkspaceRole } from "@/server/workspace-access.server";
import { rateLimitFor } from "@/server/rate-limit";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { recordAudit } from "@/server/audit.server";
import { isSlackEnabled } from "@/lib/feature-flags";
import {
  slackApi,
  slackToken,
  markSlackError,
  slackErrorMessage,
} from "@/server/slack/client.server";
import { sha256, slackConnectIssue } from "@/server/slack/security.server";
import { startSlackOAuth } from "@/server/slack/oauth.server";
import { HttpError } from "@/server/http-error";

const workspace = z.object({ workspaceId: z.string().uuid() });
const table = (name: string) => supabaseAdmin.from(name as never);
async function installation(workspaceId: string) {
  const { data, error } = await table("slack_installations")
    .select("*")
    .eq("workspace_id", workspaceId)
    .neq("status", "disconnected")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new HttpError(503, "Slack connection unavailable");
  return data as null | {
    id: string;
    workspace_id: string;
    team_id: string;
    team_name: string;
    status: string;
    connected_by: string | null;
    last_event_at: string | null;
    last_outbound_at: string | null;
    last_error: string | null;
  };
}
function enabled(workspaceId: string) {
  if (!isSlackEnabled(workspaceId))
    throw new HttpError(404, "Slack is not enabled for this workspace");
}

export const getSlackConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((v) => workspace.parse(v))
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "viewer");
    const featureEnabled = isSlackEnabled(data.workspaceId);
    const conn = featureEnabled ? await installation(data.workspaceId) : null;
    const [mapping, prefs, profile, link] = conn
      ? await Promise.all([
          table("slack_channel_mappings")
            .select("purpose,channel_id,channel_name")
            .eq("installation_id", conn.id),
          table("slack_preferences").select("*").eq("workspace_id", data.workspaceId).maybeSingle(),
          conn.connected_by
            ? supabaseAdmin
                .from("profiles")
                .select("name")
                .eq("id", conn.connected_by)
                .maybeSingle()
            : Promise.resolve({ data: null }),
          table("slack_user_links")
            .select("id")
            .eq("installation_id", conn.id)
            .eq("mellox_user_id", context.userId)
            .maybeSingle(),
        ])
      : [{ data: [] }, { data: null }, { data: null }, { data: null }];
    const issue = slackConnectIssue();
    return {
      enabled: featureEnabled,
      configured: !issue,
      configurationMessage: issue,
      connection: conn && {
        id: conn.id,
        teamName: conn.team_name,
        status: conn.status,
        connectedBy: (profile.data as { name?: string } | null)?.name ?? null,
        linked: Boolean(link.data),
        lastEventAt: conn.last_event_at,
        lastOutboundAt: conn.last_outbound_at,
        lastError: conn.last_error,
      },
      channels: (mapping.data ?? []) as Array<{
        purpose: string;
        channel_id: string;
        channel_name: string;
      }>,
      preferences: prefs.data ?? null,
    };
  });

export const startSlackConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-connect")])
  .inputValidator((v) => workspace.parse(v))
  .handler(async ({ data, context }) => {
    enabled(data.workspaceId);
    await requireWorkspaceRole(context, data.workspaceId, "admin");
    return { url: await startSlackOAuth(context.userId, data.workspaceId) };
  });

export const listSlackChannels = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector")])
  .inputValidator((v) => workspace.parse(v))
  .handler(async ({ data, context }) => {
    enabled(data.workspaceId);
    await requireWorkspaceRole(context, data.workspaceId, "admin");
    const conn = await installation(data.workspaceId);
    if (!conn) throw new HttpError(409, "Connect Slack first");
    try {
      const token = await slackToken(conn.id, data.workspaceId);
      const all: { id: string; name: string }[] = [];
      let cursor = "";
      for (let page = 0; page < 5; page++) {
        const result = await slackApi<{
          channels?: Array<{ id: string; name: string; is_archived?: boolean }>;
          response_metadata?: { next_cursor?: string };
        }>(token, "conversations.list", { types: "public_channel", limit: 200, cursor });
        all.push(
          ...(result.channels ?? [])
            .filter((c) => !c.is_archived)
            .map((c) => ({ id: c.id, name: c.name })),
        );
        cursor = result.response_metadata?.next_cursor ?? "";
        if (!cursor) break;
      }
      return all;
    } catch (error) {
      await markSlackError(conn.id, data.workspaceId, error);
      throw new HttpError(503, slackErrorMessage(error));
    }
  });

export const setSlackChannel = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector")])
  .inputValidator((v) =>
    workspace
      .extend({
        purpose: z.enum(["approvals", "marketing", "intelligence"]),
        channelId: z
          .string()
          .regex(/^C[A-Z0-9]+$/)
          .nullable(),
      })
      .parse(v),
  )
  .handler(async ({ data, context }) => {
    enabled(data.workspaceId);
    await requireWorkspaceRole(context, data.workspaceId, "admin");
    const conn = await installation(data.workspaceId);
    if (!conn) throw new HttpError(409, "Connect Slack first");
    if (!data.channelId) {
      await table("slack_channel_mappings")
        .delete()
        .eq("workspace_id", data.workspaceId)
        .eq("purpose", data.purpose);
      return { ok: true, needsInvite: false, name: null };
    }
    let info: { channel?: { id: string; name: string; is_member?: boolean } };
    try {
      info = await slackApi(await slackToken(conn.id, data.workspaceId), "conversations.info", {
        channel: data.channelId,
      });
    } catch (error) {
      await markSlackError(conn.id, data.workspaceId, error);
      throw new HttpError(503, slackErrorMessage(error));
    }
    if (info.channel?.id !== data.channelId) throw new HttpError(400, "Channel is unavailable");
    const { error } = await table("slack_channel_mappings").upsert(
      {
        workspace_id: data.workspaceId,
        installation_id: conn.id,
        team_id: conn.team_id,
        purpose: data.purpose,
        channel_id: data.channelId,
        channel_name: info.channel.name,
      } as never,
      { onConflict: "workspace_id,purpose" },
    );
    if (error) throw new HttpError(409, "This channel is already mapped to a client workspace");
    await recordAudit({
      workspaceId: data.workspaceId,
      userId: context.userId,
      action: "slack.channel_mapped",
      entity: data.purpose,
      payload: { channelId: data.channelId },
    });
    // Mellox can only post where it has been invited.
    return { ok: true, needsInvite: info.channel.is_member === false, name: info.channel.name };
  });

const prefsSchema = workspace.extend({
  preferences: z.object({
    approvals: z.boolean(),
    publishing_failures: z.boolean(),
    competitor_alerts: z.boolean(),
    market_alerts: z.boolean(),
    geo_alerts: z.boolean(),
    performance_alerts: z.boolean(),
    daily_brief: z.boolean(),
    brief_hour: z.number().int().min(0).max(23),
    brief_timezone: z.string().min(1).max(64),
  }),
});
export const setSlackPreferences = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector")])
  .inputValidator((v) => prefsSchema.parse(v))
  .handler(async ({ data, context }) => {
    enabled(data.workspaceId);
    await requireWorkspaceRole(context, data.workspaceId, "admin");
    try {
      new Intl.DateTimeFormat("en", { timeZone: data.preferences.brief_timezone });
    } catch {
      throw new HttpError(400, "Choose a valid time zone");
    }
    const { error } = await table("slack_preferences").upsert(
      {
        workspace_id: data.workspaceId,
        ...data.preferences,
        updated_at: new Date().toISOString(),
      } as never,
      { onConflict: "workspace_id" },
    );
    if (error) throw new HttpError(503, "Could not save Slack settings");
    return { ok: true };
  });

export const createSlackLinkCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-connect")])
  .inputValidator((v) => workspace.parse(v))
  .handler(async ({ data, context }) => {
    enabled(data.workspaceId);
    await requireWorkspaceRole(context, data.workspaceId, "viewer");
    const conn = await installation(data.workspaceId);
    if (!conn) throw new HttpError(409, "Connect Slack first");
    const code = randomBytes(9).toString("base64url").toUpperCase();
    const { error } = await table("slack_link_codes").insert({
      workspace_id: data.workspaceId,
      installation_id: conn.id,
      mellox_user_id: context.userId,
      code_hash: sha256(code),
      expires_at: new Date(Date.now() + 600_000).toISOString(),
    } as never);
    if (error) throw new HttpError(503, "Could not create link code");
    return { code, expiresInSeconds: 600 };
  });

export const sendSlackTest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector")])
  .inputValidator((v) =>
    workspace.extend({ purpose: z.enum(["approvals", "marketing", "intelligence"]) }).parse(v),
  )
  .handler(async ({ data, context }) => {
    enabled(data.workspaceId);
    await requireWorkspaceRole(context, data.workspaceId, "admin");
    const conn = await installation(data.workspaceId);
    if (!conn) throw new HttpError(409, "Connect Slack first");
    const { data: channel } = await table("slack_channel_mappings")
      .select("channel_id")
      .eq("workspace_id", data.workspaceId)
      .eq("purpose", data.purpose)
      .maybeSingle();
    if (!channel) throw new HttpError(409, "Choose a channel first");
    try {
      await slackApi(await slackToken(conn.id, data.workspaceId), "chat.postMessage", {
        channel: (channel as { channel_id: string }).channel_id,
        text: "Mellox is connected. Updates for this brand will show up here.",
      });
      await table("slack_installations")
        .update({ last_outbound_at: new Date().toISOString(), last_error: null } as never)
        .eq("id", conn.id);
      return { ok: true };
    } catch (error) {
      await markSlackError(conn.id, data.workspaceId, error);
      throw new HttpError(503, slackErrorMessage(error));
    }
  });

export const disconnectSlack = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth, rateLimitFor("connector-write")])
  .inputValidator((v) => workspace.parse(v))
  .handler(async ({ data, context }) => {
    await requireWorkspaceRole(context, data.workspaceId, "admin");
    const conn = await installation(data.workspaceId);
    if (!conn) return { ok: true };
    const { data: other } = await table("slack_installations")
      .select("id")
      .eq("team_id", conn.team_id)
      .eq("status", "active")
      .neq("id", conn.id)
      .limit(1);
    const token = !other?.length
      ? await slackToken(conn.id, data.workspaceId).catch(() => null)
      : null;
    if (token) await slackApi(token, "auth.revoke").catch(() => null);
    await table("slack_installations")
      .update({
        status: "disconnected",
        bot_token_enc: "",
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id", conn.id)
      .eq("workspace_id", data.workspaceId);
    await recordAudit({
      workspaceId: data.workspaceId,
      userId: context.userId,
      action: "slack.disconnected",
      entity: conn.team_id,
    });
    return { ok: true };
  });
