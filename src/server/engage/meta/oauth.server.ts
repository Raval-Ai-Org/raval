// oauth.server.ts — the Facebook Login for Business round trip. The state is
// single-use and hashed in connector_install_states, and the browser that
// started it must present the matching httpOnly cookie on the way back.
import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { HttpError } from "@/server/http-error";
import { META_CALLBACK_PATH, META_SCOPES, metaConfig } from "./config.server";

const STATE_RE = /^[A-Za-z0-9_-]{40,128}$/;
const stateHash = (value: string) => createHash("sha256").update(value).digest("hex");
export const META_STATE_COOKIE = "meta_oauth_state";

export function matchesMetaBrowserState(state: string, cookieValue: string | undefined): boolean {
  if (!STATE_RE.test(state) || !cookieValue || !/^[a-f0-9]{64}$/.test(cookieValue)) return false;
  return timingSafeEqual(Buffer.from(stateHash(state), "hex"), Buffer.from(cookieValue, "hex"));
}

export async function startMetaOAuth(userId: string, workspaceId: string): Promise<string> {
  const config = metaConfig();
  const state = randomBytes(48).toString("base64url");
  const { error } = await supabaseAdmin.from("connector_install_states").insert({
    provider: "meta",
    state_hash: stateHash(state),
    user_id: userId,
    workspace_id: workspaceId,
    return_path: `/w/${workspaceId}/app/inbox`,
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  });
  if (error) throw new HttpError(500, "Could not start the Meta connection.");
  (await cookies()).set(META_STATE_COOKIE, stateHash(state), {
    httpOnly: true,
    secure: new URL(config.redirectUri).protocol === "https:",
    sameSite: "lax",
    path: META_CALLBACK_PATH,
    maxAge: 10 * 60,
  });
  const u = new URL(`https://www.facebook.com/${config.version}/dialog/oauth`);
  u.searchParams.set("client_id", config.appId);
  u.searchParams.set("redirect_uri", config.redirectUri);
  u.searchParams.set("state", state);
  u.searchParams.set("response_type", "code");
  if (config.loginConfigId) {
    // Facebook Login for Business: the configuration names the permissions.
    u.searchParams.set("config_id", config.loginConfigId);
    u.searchParams.set("override_default_response_type", "true");
  } else {
    u.searchParams.set("scope", META_SCOPES.join(","));
  }
  return u.toString();
}

export async function consumeMetaState(
  state: string,
): Promise<{ userId: string; workspaceId: string }> {
  if (!STATE_RE.test(state)) throw new HttpError(400, "Invalid Meta connection state.");
  const { data: row } = await supabaseAdmin
    .from("connector_install_states")
    .select("id,user_id,workspace_id,expires_at,consumed_at")
    .eq("provider", "meta")
    .eq("state_hash", stateHash(state))
    .maybeSingle();
  if (!row || row.consumed_at || Date.parse(row.expires_at) <= Date.now())
    throw new HttpError(400, "The Meta connection expired. Start again.");
  const { data, error } = await supabaseAdmin
    .from("connector_install_states")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", row.id)
    .is("consumed_at", null)
    .select("id");
  if (error || !data?.length) throw new HttpError(400, "The Meta connection was already used.");
  return { userId: row.user_id, workspaceId: row.workspace_id };
}

/** The workspace a still-valid state belongs to, without using it (for the error page). */
export async function peekMetaStateWorkspace(state: string): Promise<string | null> {
  if (!STATE_RE.test(state)) return null;
  const { data } = await supabaseAdmin
    .from("connector_install_states")
    .select("workspace_id")
    .eq("provider", "meta")
    .eq("state_hash", stateHash(state))
    .maybeSingle();
  return data?.workspace_id ?? null;
}
