import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { safeReturnPath } from "@/server/connectors/return-url";
import { HttpError } from "@/server/http-error";
import { notionConfig } from "./config.server";

const stateHash = (value: string) => createHash("sha256").update(value).digest("hex");
export const NOTION_STATE_COOKIE = "notion_oauth_state";
export function matchesNotionBrowserState(state: string, cookieValue: string | undefined) {
  if (!/^[A-Za-z0-9_-]{40,128}$/.test(state) || !cookieValue || !/^[a-f0-9]{64}$/.test(cookieValue))
    return false;
  return timingSafeEqual(Buffer.from(stateHash(state), "hex"), Buffer.from(cookieValue, "hex"));
}
export function validNotionState(
  state: string,
  row: { user_id: string; expires_at: string; consumed_at: string | null } | null,
  userId: string,
  now = Date.now(),
) {
  return (
    /^[A-Za-z0-9_-]{40,128}$/.test(state) &&
    !!row &&
    row.user_id === userId &&
    !row.consumed_at &&
    Date.parse(row.expires_at) > now
  );
}
export async function startNotionOAuth(userId: string, workspaceId: string, returnPath?: string) {
  const config = notionConfig();
  const state = randomBytes(48).toString("base64url");
  const { error } = await supabaseAdmin.from("connector_install_states").insert({
    provider: "notion",
    state_hash: stateHash(state),
    user_id: userId,
    workspace_id: workspaceId,
    return_path: safeReturnPath(returnPath) ?? `/w/${workspaceId}/app?settings=accounts`,
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  });
  if (error) throw new HttpError(500, "Could not start Notion connection.");
  (await cookies()).set(NOTION_STATE_COOKIE, stateHash(state), {
    httpOnly: true,
    secure: new URL(config.redirectUri).protocol === "https:",
    sameSite: "lax",
    path: "/api/integrations/notion/callback",
    maxAge: 10 * 60,
  });
  const url = new URL("https://api.notion.com/v1/oauth/authorize");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("owner", "user");
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}
export async function consumeNotionState(state: string) {
  if (!/^[A-Za-z0-9_-]{40,128}$/.test(state))
    throw new HttpError(400, "Invalid Notion connection state.");
  const { data: row } = await supabaseAdmin
    .from("connector_install_states")
    .select("id,user_id,workspace_id,return_path,expires_at,consumed_at")
    .eq("provider", "notion")
    .eq("state_hash", stateHash(state))
    .maybeSingle();
  if (!row || !validNotionState(state, row, row.user_id))
    throw new HttpError(400, "Notion connection expired. Start again.");
  const { data, error } = await supabaseAdmin
    .from("connector_install_states")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("consumed_at", null)
    .select("id");
  if (error || !data?.length) throw new HttpError(400, "Notion connection already used.");
  return {
    userId: row.user_id,
    workspaceId: row.workspace_id,
    returnPath: safeReturnPath(row.return_path) ?? `/w/${row.workspace_id}/app?settings=accounts`,
  };
}
