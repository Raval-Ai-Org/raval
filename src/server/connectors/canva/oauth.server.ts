import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { encryptWithKey, decryptWithKey } from "@/server/crypto/secret-box.server";
import { safeReturnPath } from "@/server/connectors/return-url";
import { HttpError } from "@/server/http-error";
import { CANVA_SCOPES, canvaConfig } from "./config.server";

const STATE_RE = /^[A-Za-z0-9_-]{32,128}$/;
export function validCanvaStateRow(
  state: string,
  row: {
    user_id: string;
    consumed_at: string | null;
    pkce_verifier_enc: string | null;
    expires_at: string;
  } | null,
  userId: string,
  now = Date.now(),
) {
  return (
    STATE_RE.test(state) &&
    !!row &&
    row.user_id === userId &&
    !row.consumed_at &&
    !!row.pkce_verifier_enc &&
    Date.parse(row.expires_at) > now
  );
}
export const hashState = (state: string) => createHash("sha256").update(state).digest("hex");
export const challengeFor = (verifier: string) =>
  createHash("sha256").update(verifier).digest("base64url");

export function buildCanvaAuthorizeUrl(
  config: { clientId: string; redirectUri: string },
  state: string,
  verifier: string,
) {
  const url = new URL("https://www.canva.com/api/oauth/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", CANVA_SCOPES.join(" "));
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("code_challenge", challengeFor(verifier));
  url.searchParams.set("state", state);
  return url.toString();
}

export async function startCanvaOAuth(args: {
  userId: string;
  workspaceId: string;
  returnPath?: string | null;
}) {
  const config = canvaConfig();
  const state = randomBytes(48).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const { error } = await supabaseAdmin.from("connector_install_states").insert({
    provider: "canva",
    state_hash: hashState(state),
    user_id: args.userId,
    workspace_id: args.workspaceId,
    return_path: safeReturnPath(args.returnPath),
    pkce_verifier_enc: encryptWithKey(verifier, config.key),
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  });
  if (error) throw new HttpError(500, "Could not start Canva connection.");
  return buildCanvaAuthorizeUrl(config, state, verifier);
}

export async function consumeCanvaState(state: string, userId: string) {
  if (!STATE_RE.test(state)) throw new HttpError(400, "Invalid Canva connection state.");
  const { data: row } = await supabaseAdmin
    .from("connector_install_states")
    .select("id, user_id, workspace_id, return_path, expires_at, consumed_at, pkce_verifier_enc")
    .eq("provider", "canva")
    .eq("state_hash", hashState(state))
    .maybeSingle();
  if (!row?.pkce_verifier_enc || !validCanvaStateRow(state, row, userId))
    throw new HttpError(400, "Canva connection expired. Start again.");
  const verifier = decryptWithKey(row.pkce_verifier_enc, canvaConfig().key);
  const { data: consumed, error } = await supabaseAdmin
    .from("connector_install_states")
    .update({ consumed_at: new Date().toISOString(), pkce_verifier_enc: null })
    .eq("id", row.id)
    .is("consumed_at", null)
    .select("id");
  if (error || !consumed?.length) throw new HttpError(400, "Canva connection already used.");
  return { workspaceId: row.workspace_id, verifier, returnPath: safeReturnPath(row.return_path) };
}
