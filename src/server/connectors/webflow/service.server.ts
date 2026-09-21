import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { decryptWithKey, encryptWithKey } from "@/server/crypto/secret-box.server";
import { safeReturnPath } from "@/server/connectors/return-url";
import { HttpError } from "@/server/http-error";
import { recordAudit } from "@/server/audit.server";
import {
  allowedWebflowReturnOrigin,
  requireWebflowConfig,
  webflowTokenKey,
  WEBFLOW_SCOPES,
} from "./config.server";
import {
  exchangeCode,
  getTokenUser,
  listCollections,
  listItems,
  listPages,
  listSites,
  refreshAccess,
  revokeAccess,
  type WebflowSite,
} from "./api.server";

const PROVIDER = "webflow";
const STATE_TTL = 20 * 60_000;
const stateFormat = /^[A-Za-z0-9_-]{32,128}$/;
const hashState = (state: string) => createHash("sha256").update(state).digest("hex");
const db = supabaseAdmin as unknown as { from: (table: string) => any };

type State = {
  id: string;
  workspaceId: string;
  userId: string;
  createdAt: string;
  consumedAt: string | null;
  returnPath: string | null;
};

export type WebflowSiteView = {
  id: string;
  name: string;
  domain: string | null;
  previewUrl: string | null;
  selected: boolean;
  status: string;
};
export type WebflowConnectionView = {
  connectionId: string;
  accountEmail: string;
  status: string;
  selectedSite: WebflowSiteView | null;
  sites: WebflowSiteView[];
};

export function createAuthUrl(args: {
  workspaceId: string;
  userId: string;
  returnOrigin?: string | null;
  returnPath?: string | null;
}) {
  const config = requireWebflowConfig();
  const origin = allowedWebflowReturnOrigin(args.returnOrigin);
  if (args.returnOrigin && !origin)
    throw new HttpError(400, "Webflow cannot return to this address.");
  const state = randomBytes(32).toString("base64url");
  return supabaseAdmin
    .from("connector_install_states")
    .insert({
      state_hash: hashState(state),
      workspace_id: args.workspaceId,
      user_id: args.userId,
      provider: PROVIDER,
      expires_at: new Date(Date.now() + STATE_TTL).toISOString(),
      return_origin: origin,
      return_path: safeReturnPath(args.returnPath),
    })
    .then(({ error }) => {
      if (error) throw new Error(`Couldn't start Webflow connection: ${error.message}`);
      const url = new URL("https://webflow.com/oauth/authorize");
      url.searchParams.set("client_id", config.clientId);
      url.searchParams.set("response_type", "code");
      url.searchParams.set("scope", WEBFLOW_SCOPES.join(" "));
      url.searchParams.set("state", state);
      url.searchParams.set("redirect_uri", config.redirectUri);
      return { url: url.toString(), expiresInSeconds: STATE_TTL / 1000 };
    });
}

export async function returnOrigin(state: string) {
  if (!stateFormat.test(state)) return null;
  const { data } = await supabaseAdmin
    .from("connector_install_states")
    .select("return_origin")
    .eq("state_hash", hashState(state))
    .eq("provider", PROVIDER)
    .maybeSingle();
  return allowedWebflowReturnOrigin(data?.return_origin ?? null);
}

export async function readState(value: string, userId: string): Promise<State> {
  if (!stateFormat.test(value))
    throw new HttpError(400, "This Webflow connection link is invalid.");
  const { data, error } = await supabaseAdmin
    .from("connector_install_states")
    .select("id, workspace_id, user_id, expires_at, consumed_at, created_at, return_path")
    .eq("state_hash", hashState(value))
    .eq("provider", PROVIDER)
    .maybeSingle();
  if (error || !data || data.user_id !== userId || Date.parse(data.expires_at) < Date.now())
    throw new HttpError(400, "This Webflow connection link has expired. Start again from Mellox.");
  return {
    id: data.id,
    workspaceId: data.workspace_id,
    userId: data.user_id,
    createdAt: data.created_at,
    consumedAt: data.consumed_at,
    returnPath: safeReturnPath(data.return_path),
  };
}

async function tokenFor(connectionId: string, workspaceId: string) {
  const { data, error } = await db
    .from("webflow_oauth_credentials")
    .select("workspace_id, access_token_enc, refresh_token_enc, access_token_expires_at")
    .eq("connection_id", connectionId)
    .maybeSingle();
  if (error || !data || data.workspace_id !== workspaceId)
    throw new HttpError(409, "Webflow is not connected for this workspace.");
  const key = webflowTokenKey();
  try {
    if (
      !data.access_token_expires_at ||
      Date.parse(data.access_token_expires_at) - 60_000 > Date.now()
    )
      return decryptWithKey(data.access_token_enc, key);
    if (!data.refresh_token_enc) throw new Error("No Webflow refresh token");
    const fresh = await refreshAccess(decryptWithKey(data.refresh_token_enc, key));
    await db
      .from("webflow_oauth_credentials")
      .update({
        access_token_enc: encryptWithKey(fresh.accessToken, key),
        refresh_token_enc: fresh.refreshToken
          ? encryptWithKey(fresh.refreshToken, key)
          : data.refresh_token_enc,
        access_token_expires_at: fresh.expiresAt?.toISOString() ?? null,
      })
      .eq("connection_id", connectionId);
    return fresh.accessToken;
  } catch {
    await supabaseAdmin
      .from("workspace_connections")
      .update({ status: "error", last_error: "Webflow authorization needs to be renewed." })
      .eq("id", connectionId)
      .eq("workspace_id", workspaceId);
    throw new HttpError(409, "Webflow authorization needs to be renewed.");
  }
}

function siteView(row: any): WebflowSiteView {
  return {
    id: row.site_id,
    name: row.site_name,
    domain: row.domain ?? null,
    previewUrl: row.preview_url ?? null,
    selected: row.selected === true,
    status: row.status,
  };
}

export async function completeConnect(state: State, code: string, userId: string) {
  if (state.consumedAt) {
    const view = await getConnectionView(supabaseAdmin, state.workspaceId);
    if (!view) throw new HttpError(409, "This Webflow connection link was already used.");
    return {
      workspaceId: state.workspaceId,
      connectionId: view.connectionId,
      returnPath: state.returnPath,
      accountEmail: view.accountEmail,
      sites: view.sites,
    };
  }
  const tokens = await exchangeCode(code);
  const identity = await getTokenUser(tokens.accessToken);
  const sites = (await listSites(tokens.accessToken)).sites ?? [];
  const connection = await supabaseAdmin
    .from("workspace_connections")
    .upsert(
      {
        workspace_id: state.workspaceId,
        provider: PROVIDER,
        status: "active",
        external_account_id: identity.id ?? identity.email ?? "webflow-user",
        account_login: identity.email ?? identity.id ?? "Webflow account",
        account_type: "user",
        permissions: Object.fromEntries(tokens.scopes.map((scope) => [scope, "read"])),
        verification: "oauth",
        connected_by: userId,
        last_verified_at: new Date().toISOString(),
        last_error: null,
      },
      { onConflict: "workspace_id,provider,external_account_id" },
    )
    .select("id")
    .single();
  if (connection.error || !connection.data)
    throw new Error("Webflow connected but Mellox could not save the connection.");
  const connectionId = connection.data.id;
  await db.from("webflow_oauth_credentials").upsert(
    {
      connection_id: connectionId,
      workspace_id: state.workspaceId,
      access_token_enc: encryptWithKey(tokens.accessToken, webflowTokenKey()),
      refresh_token_enc: tokens.refreshToken
        ? encryptWithKey(tokens.refreshToken, webflowTokenKey())
        : null,
      access_token_expires_at: tokens.expiresAt?.toISOString() ?? null,
      scopes: tokens.scopes,
      webflow_user_id: identity.id ?? null,
      webflow_user_email: identity.email ?? null,
    },
    { onConflict: "connection_id" },
  );
  await saveSites(state.workspaceId, connectionId, sites);
  await supabaseAdmin
    .from("connector_install_states")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", state.id)
    .is("consumed_at", null);
  await recordAudit({
    workspaceId: state.workspaceId,
    userId,
    action: "connector.webflow.connected",
    entity: "connector",
  });
  return {
    workspaceId: state.workspaceId,
    connectionId,
    returnPath: state.returnPath,
    accountEmail: identity.email ?? "Webflow account",
    sites: sites.map((site) => viewForApi(site, false)),
  };
}

function viewForApi(site: WebflowSite, selected: boolean): WebflowSiteView {
  return {
    id: site.id,
    name: site.displayName ?? site.id,
    domain: site.customDomains?.[0]?.url ?? null,
    previewUrl: site.previewUrl ?? null,
    selected,
    status: "active",
  };
}

async function saveSites(workspaceId: string, connectionId: string, sites: WebflowSite[]) {
  if (!sites.length) return;
  await db.from("webflow_sites").upsert(
    sites.map((site) => ({
      workspace_id: workspaceId,
      connection_id: connectionId,
      site_id: site.id,
      site_name: site.displayName ?? site.id,
      domain: site.customDomains?.[0]?.url ?? null,
      preview_url: site.previewUrl ?? null,
      status: "active",
    })),
    { onConflict: "workspace_id,site_id" },
  );
}

export async function getConnectionView(
  client: any,
  workspaceId: string,
): Promise<WebflowConnectionView | null> {
  const { data: connection, error } = await client
    .from("workspace_connections")
    .select("id, status, account_login")
    .eq("workspace_id", workspaceId)
    .eq("provider", PROVIDER)
    .neq("status", "revoked")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!connection) return null;
  const { data: sites, error: sitesError } = await client
    .from("webflow_sites")
    .select("site_id, site_name, domain, preview_url, selected, status")
    .eq("workspace_id", workspaceId)
    .eq("connection_id", connection.id)
    .order("site_name");
  if (sitesError) throw new Error(sitesError.message);
  return {
    connectionId: connection.id,
    accountEmail: connection.account_login,
    status: connection.status,
    sites: (sites ?? []).map(siteView),
    selectedSite: (sites ?? []).find((site: any) => site.selected)
      ? siteView((sites ?? []).find((site: any) => site.selected))
      : null,
  };
}

export async function listAvailableSites(workspaceId: string) {
  const view = await getConnectionView(supabaseAdmin, workspaceId);
  if (!view) throw new HttpError(409, "Connect Webflow first.");
  const token = await tokenFor(view.connectionId, workspaceId);
  try {
    const result = await listSites(token);
    await saveSites(workspaceId, view.connectionId, result.sites ?? []);
  } catch (error) {
    if (error instanceof Error)
      await supabaseAdmin
        .from("workspace_connections")
        .update({ status: "error", last_error: error.message.slice(0, 500) })
        .eq("id", view.connectionId);
    throw error;
  }
  return getConnectionView(supabaseAdmin, workspaceId);
}

export async function selectSite(args: {
  workspaceId: string;
  connectionId: string;
  siteId: string;
  userId: string;
}) {
  const token = await tokenFor(args.connectionId, args.workspaceId);
  const site = await getSiteChecked(token, args.siteId);
  const { data: owned } = await db
    .from("webflow_sites")
    .select("site_id")
    .eq("workspace_id", args.workspaceId)
    .eq("connection_id", args.connectionId)
    .eq("site_id", args.siteId)
    .maybeSingle();
  if (!owned) throw new HttpError(404, "That Webflow site is not available to this workspace.");
  await db
    .from("webflow_sites")
    .update({ selected: false })
    .eq("workspace_id", args.workspaceId)
    .eq("connection_id", args.connectionId);
  await db
    .from("webflow_sites")
    .update({
      selected: true,
      site_name: site.displayName ?? args.siteId,
      domain: site.customDomains?.[0]?.url ?? null,
      preview_url: site.previewUrl ?? null,
      last_synced_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("workspace_id", args.workspaceId)
    .eq("connection_id", args.connectionId)
    .eq("site_id", args.siteId);
  await recordAudit({
    workspaceId: args.workspaceId,
    userId: args.userId,
    action: "connector.webflow.site_selected",
    entity: "connector",
    payload: { siteId: args.siteId },
  });
  return getConnectionView(supabaseAdmin, args.workspaceId);
}

async function getSiteChecked(token: string, siteId: string) {
  return (await import("./api.server")).getSite(token, siteId);
}

export async function webflowData(
  workspaceId: string,
  kind: "pages" | "collections" | "items",
  id?: string,
) {
  const view = await getConnectionView(supabaseAdmin, workspaceId);
  const site = view?.selectedSite;
  if (!view || !site) throw new HttpError(409, "Select a Webflow site first.");
  const token = await tokenFor(view.connectionId, workspaceId);
  if (kind === "pages") return listPages(token, site.id);
  if (kind === "collections") return listCollections(token, site.id);
  if (!id) throw new HttpError(400, "A collection id is required.");
  return listItems(token, id);
}

export async function disconnect(args: {
  workspaceId: string;
  connectionId: string;
  userId: string;
}) {
  const { data } = await supabaseAdmin
    .from("workspace_connections")
    .select("id, workspace_id")
    .eq("id", args.connectionId)
    .eq("workspace_id", args.workspaceId)
    .eq("provider", PROVIDER)
    .maybeSingle();
  if (!data) throw new HttpError(404, "Webflow connection not found.");
  try {
    await revokeAccess(await tokenFor(args.connectionId, args.workspaceId));
  } catch {
    // The provider grant may already be revoked; local disconnect still completes.
  }
  await supabaseAdmin
    .from("workspace_connections")
    .update({
      status: "revoked",
      revoked_at: new Date().toISOString(),
      revoked_reason: "disconnected",
    })
    .eq("id", args.connectionId);
  await recordAudit({
    workspaceId: args.workspaceId,
    userId: args.userId,
    action: "connector.webflow.disconnected",
    entity: "connector",
  });
  return { removed: true };
}
