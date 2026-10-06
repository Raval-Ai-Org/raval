import "server-only";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { encryptWithKey } from "@/server/crypto/secret-box.server";
import { roleAtLeast } from "@/server/api-auth";
import { recordAudit } from "@/server/audit.server";
import {
  SLACK_CALLBACK,
  SLACK_SCOPES,
  safeEqualHex,
  sha256,
  slackConfig,
  slackOrigins,
} from "./security.server";

export const SLACK_STATE_COOKIE = "mellox_slack_state";

export async function startSlackOAuth(userId: string, workspaceId: string) {
  const { clientId } = slackConfig();
  const { redirectUri } = slackOrigins();
  const state = randomBytes(48).toString("base64url");
  const { error } = await supabaseAdmin.from("connector_install_states").insert({
    provider: "slack",
    state_hash: sha256(state),
    user_id: userId,
    workspace_id: workspaceId,
    expires_at: new Date(Date.now() + 600_000).toISOString(),
  });
  if (error) throw new Error("Could not start Slack connection");
  (await cookies()).set(SLACK_STATE_COOKIE, sha256(state), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: SLACK_CALLBACK,
    maxAge: 600,
  });
  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("scope", SLACK_SCOPES);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

export function matchesSlackState(state: string, cookie: string | undefined) {
  return /^[A-Za-z0-9_-]{64}$/.test(state) && !!cookie && safeEqualHex(sha256(state), cookie);
}

export async function completeSlackOAuth(state: string, code: string) {
  if (!/^[A-Za-z0-9_-]{64}$/.test(state) || !code || code.length > 2048)
    throw new Error("Invalid Slack response");
  const hash = sha256(state);
  const { data: row } = await supabaseAdmin
    .from("connector_install_states")
    .select("id,user_id,workspace_id,expires_at,consumed_at")
    .eq("provider", "slack")
    .eq("state_hash", hash)
    .maybeSingle();
  if (!row || row.consumed_at || Date.parse(row.expires_at) <= Date.now())
    throw new Error("Slack connection expired");
  const { data: claimed } = await supabaseAdmin
    .from("connector_install_states")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("consumed_at", null)
    .select("id");
  if (!claimed?.length) throw new Error("Slack connection already used");
  const { data: member } = await supabaseAdmin
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", row.workspace_id)
    .eq("user_id", row.user_id)
    .maybeSingle();
  if (!roleAtLeast(member?.role, "admin")) throw new Error("Workspace access changed");
  const config = slackConfig();
  const response = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: slackOrigins().redirectUri,
    }),
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  });
  const grant = (await response.json()) as {
    ok?: boolean;
    access_token?: string;
    team?: { id?: string; name?: string };
    bot_user_id?: string;
  };
  if (!response.ok || !grant.ok || !grant.access_token || !grant.team?.id || !grant.bot_user_id)
    throw new Error("Slack authorization failed");
  // One active Slack team per Mellox workspace. A switch leaves other client
  // workspaces installed in the old Slack team untouched.
  await supabaseAdmin
    .from("slack_installations" as never)
    .update({
      status: "disconnected",
      bot_token_enc: "",
      updated_at: new Date().toISOString(),
    } as never)
    .eq("workspace_id", row.workspace_id)
    .neq("team_id", grant.team.id)
    .neq("status", "disconnected");
  const { error } = await supabaseAdmin.from("slack_installations" as never).upsert(
    {
      workspace_id: row.workspace_id,
      team_id: grant.team.id,
      team_name: grant.team.name || "Slack workspace",
      bot_user_id: grant.bot_user_id,
      bot_token_enc: encryptWithKey(grant.access_token, config.key),
      connected_by: row.user_id,
      status: "active",
      last_error: null,
      updated_at: new Date().toISOString(),
    } as never,
    { onConflict: "workspace_id,team_id" },
  );
  if (error) throw new Error("Could not save Slack connection");
  await recordAudit({
    workspaceId: row.workspace_id,
    userId: row.user_id,
    action: "slack.connected",
    entity: grant.team.id,
  });
  return row.workspace_id;
}
