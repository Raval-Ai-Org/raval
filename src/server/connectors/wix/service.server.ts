import "server-only";
// service.server.ts — connect a Wix site to a workspace, and hand the rest of
// Mellox a token for it.
//
//   connect   "Connect Wix" opens Wix's app installer in the sign-in window
//             with a one-time state in the return address. The site owner
//             picks the site and allows Mellox's app; Wix returns with the
//             app's instance id and a signature over it (signed-instance).
//   complete  the signature is checked with the app secret before the
//             instance id is trusted; Mellox then reads the site through
//             Wix's API with that instance and stores it. One Wix site per
//             workspace: connecting another one replaces it.
//   tokens    4-hour access tokens are created from the instance id when
//             needed and cached encrypted. No refresh token exists.
//   remove    Mellox forgets the instance id. Wix has no API for an app to
//             remove itself; the person removes the app in Wix (the card says so).
import { createHash, randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { decryptWithKeys, encryptWithKey } from "@/server/crypto/secret-box.server";
import { safeReturnPath } from "@/server/connectors/return-url";
import { HttpError } from "@/server/http-error";
import { recordAudit } from "@/server/audit.server";
import { hostOf } from "@/lib/sites/fingerprint";
import { allowedWixReturnOrigin, requireWixConfig, wixKeys } from "./config.server";
import { createAccessToken, getAppInstance, type WixAppInstance } from "./api.server";
import { verifySignedInstance } from "./signed-instance.server";

const PROVIDER = "wix";
const STATE_TTL = 20 * 60_000;
const stateFormat = /^[A-Za-z0-9_-]{32,128}$/;
const hashState = (state: string) => createHash("sha256").update(state).digest("hex");
const db = supabaseAdmin as unknown as { from: (table: string) => any };

type State = {
  id: string;
  workspaceId: string;
  userId: string;
  consumedAt: string | null;
  returnPath: string | null;
};

export type WixSiteView = {
  id: string;
  name: string;
  url: string | null;
  domains: string[];
  /** The Wix Blog app is on the site (articles can be published). */
  hasBlog: boolean;
};

export type WixConnectionView = {
  connectionId: string;
  /** The site owner's email when Wix shares it, else the site's name. */
  accountLabel: string;
  status: string;
  site: WixSiteView | null;
  lastError: string | null;
};

/** Wix reports its own apps by name; the blog's is "blog" / "Wix Blog". */
export const hasWixBlog = (apps: readonly string[] | null | undefined) =>
  (apps ?? []).some((a) => /\bblog\b/i.test(a));

/** Hosts a Wix site is served on, from the address Wix reports for it. */
export function wixSiteDomains(siteUrl: string | null | undefined): string[] {
  const host = hostOf(siteUrl ?? null);
  return host ? [host] : [];
}

export async function createInstallUrl(args: {
  workspaceId: string;
  userId: string;
  returnOrigin?: string | null;
  returnPath?: string | null;
}) {
  const config = requireWixConfig();
  wixKeys();
  const origin = allowedWixReturnOrigin(args.returnOrigin);
  if (args.returnOrigin && !origin) throw new HttpError(400, "Wix cannot return to this address.");
  const state = randomBytes(32).toString("base64url");
  const { error } = await supabaseAdmin.from("connector_install_states").insert({
    state_hash: hashState(state),
    workspace_id: args.workspaceId,
    user_id: args.userId,
    provider: PROVIDER,
    expires_at: new Date(Date.now() + STATE_TTL).toISOString(),
    return_origin: origin,
    return_path: safeReturnPath(args.returnPath),
  });
  if (error) throw new Error(`Couldn't start the Wix connection: ${error.message}`);
  // Wix keeps any query on the post-install address and adds its own.
  const callback = new URL(config.redirectUri);
  callback.searchParams.set("state", state);
  const url = new URL("https://www.wix.com/app-installer");
  url.searchParams.set("appId", config.appId);
  if (config.shareUrlId) url.searchParams.set("shareUrlId", config.shareUrlId);
  url.searchParams.set("postInstallationUrl", callback.toString());
  return { url: url.toString(), expiresInSeconds: STATE_TTL / 1000 };
}

export async function returnOrigin(state: string) {
  if (!stateFormat.test(state)) return null;
  const { data } = await supabaseAdmin
    .from("connector_install_states")
    .select("return_origin")
    .eq("state_hash", hashState(state))
    .eq("provider", PROVIDER)
    .maybeSingle();
  return allowedWixReturnOrigin(data?.return_origin ?? null);
}

export async function readState(value: string, userId: string): Promise<State> {
  if (!stateFormat.test(value)) throw new HttpError(400, "This Wix connection link is invalid.");
  const { data, error } = await supabaseAdmin
    .from("connector_install_states")
    .select("id, workspace_id, user_id, expires_at, consumed_at, return_path")
    .eq("state_hash", hashState(value))
    .eq("provider", PROVIDER)
    .maybeSingle();
  if (error || !data || data.user_id !== userId || Date.parse(data.expires_at) < Date.now())
    throw new HttpError(400, "This Wix connection link has expired. Start again from Mellox.");
  return {
    id: data.id,
    workspaceId: data.workspace_id,
    userId: data.user_id,
    consumedAt: data.consumed_at,
    returnPath: safeReturnPath(data.return_path),
  };
}

async function markError(connectionId: string, workspaceId: string, message: string) {
  await supabaseAdmin
    .from("workspace_connections")
    .update({ status: "error", last_error: message.slice(0, 500) })
    .eq("id", connectionId)
    .eq("workspace_id", workspaceId);
}

async function tokenFor(connectionId: string, workspaceId: string): Promise<string> {
  const { data, error } = await db
    .from("wix_oauth_credentials")
    .select("workspace_id, instance_id_enc, access_token_enc, access_token_expires_at")
    .eq("connection_id", connectionId)
    .maybeSingle();
  if (error || !data || data.workspace_id !== workspaceId)
    throw new HttpError(409, "Wix is not connected for this workspace.");
  const { key, readKeys } = wixKeys();
  if (
    data.access_token_enc &&
    data.access_token_expires_at &&
    Date.parse(data.access_token_expires_at) - 2 * 60_000 > Date.now()
  ) {
    try {
      return decryptWithKeys(data.access_token_enc, readKeys);
    } catch {
      // Unreadable cache: make a new token below.
    }
  }
  try {
    const instanceId = decryptWithKeys(data.instance_id_enc, readKeys);
    const fresh = await createAccessToken(instanceId);
    await db
      .from("wix_oauth_credentials")
      .update({
        access_token_enc: encryptWithKey(fresh.accessToken, key),
        access_token_expires_at: fresh.expiresAt.toISOString(),
      })
      .eq("connection_id", connectionId);
    return fresh.accessToken;
  } catch {
    const message = "Mellox can't reach your Wix site any more. Connect Wix again.";
    await markError(connectionId, workspaceId, message);
    throw new HttpError(409, message);
  }
}

function siteRow(workspaceId: string, connectionId: string, info: WixAppInstance) {
  const site = info.site ?? {};
  const siteId = site.siteId ?? info.instance?.instanceId;
  if (!siteId) throw new HttpError(502, "Wix didn't say which site Mellox was added to.");
  return {
    workspace_id: workspaceId,
    connection_id: connectionId,
    site_id: siteId,
    site_name: (site.siteDisplayName || hostOf(site.url ?? null) || "Wix site").slice(0, 200),
    site_url: site.url ?? null,
    domains: wixSiteDomains(site.url),
    installed_apps: (site.installedWixApps ?? []).slice(0, 100),
    selected: true,
    status: "active",
    last_synced_at: new Date().toISOString(),
    last_error: null,
  };
}

export async function completeConnect(
  state: State,
  install: { instanceId: string; signedInstance: string },
  userId: string,
) {
  if (state.consumedAt) {
    const view = await getConnectionView(supabaseAdmin, state.workspaceId);
    if (!view) throw new HttpError(409, "This Wix connection link was already used.");
    return { workspaceId: state.workspaceId, returnPath: state.returnPath, connection: view };
  }
  const config = requireWixConfig();
  const claims = verifySignedInstance(install.signedInstance, config.appSecret, install.instanceId);
  if (!claims)
    throw new HttpError(400, "Wix didn't confirm this connection. Start again from Mellox.");
  const { key } = wixKeys();
  const token = await createAccessToken(claims.instanceId);
  const info = await getAppInstance(token.accessToken);
  if (info.instance?.instanceId && info.instance.instanceId !== claims.instanceId)
    throw new HttpError(400, "Wix answered for a different site. Start again from Mellox.");
  const accountLabel =
    info.site?.ownerInfo?.email ?? info.site?.siteDisplayName ?? hostOf(info.site?.url ?? null);

  // One Wix site per workspace: another site replaces the one connected before.
  await supabaseAdmin
    .from("workspace_connections")
    .update({
      status: "revoked",
      revoked_at: new Date().toISOString(),
      revoked_reason: "replaced",
    })
    .eq("workspace_id", state.workspaceId)
    .eq("provider", PROVIDER)
    .neq("external_account_id", claims.instanceId)
    .neq("status", "revoked");

  const connection = await supabaseAdmin
    .from("workspace_connections")
    .upsert(
      {
        workspace_id: state.workspaceId,
        provider: PROVIDER,
        status: "active",
        external_account_id: claims.instanceId,
        account_login: (accountLabel ?? "Wix site").slice(0, 200),
        account_type: "site",
        permissions: Object.fromEntries(
          (info.instance?.permissions ?? []).slice(0, 50).map((p) => [p, "granted"]),
        ),
        verification: "install_window",
        connected_by: userId,
        last_verified_at: new Date().toISOString(),
        last_error: null,
        revoked_at: null,
        revoked_reason: null,
      },
      { onConflict: "workspace_id,provider,external_account_id" },
    )
    .select("id")
    .single();
  if (connection.error || !connection.data)
    throw new Error("Wix connected but Mellox could not save the connection.");
  const connectionId = connection.data.id;
  const saved = await db.from("wix_oauth_credentials").upsert(
    {
      connection_id: connectionId,
      workspace_id: state.workspaceId,
      instance_id_enc: encryptWithKey(claims.instanceId, key),
      access_token_enc: encryptWithKey(token.accessToken, key),
      access_token_expires_at: token.expiresAt.toISOString(),
      permissions: (info.instance?.permissions ?? []).slice(0, 50),
    },
    { onConflict: "connection_id" },
  );
  if (saved.error) throw new Error("Wix connected but Mellox could not save the connection.");
  const row = siteRow(state.workspaceId, connectionId, info);
  await db
    .from("wix_sites")
    .delete()
    .eq("workspace_id", state.workspaceId)
    .neq("site_id", row.site_id);
  await db.from("wix_sites").upsert(row, { onConflict: "workspace_id,site_id" });
  await supabaseAdmin
    .from("connector_install_states")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", state.id)
    .is("consumed_at", null);
  await recordAudit({
    workspaceId: state.workspaceId,
    userId,
    action: "connector.wix.connected",
    entity: "connector",
    payload: { siteId: row.site_id },
  });
  const view = await getConnectionView(supabaseAdmin, state.workspaceId);
  if (!view) throw new Error("Wix connected but Mellox could not read the connection back.");
  return { workspaceId: state.workspaceId, returnPath: state.returnPath, connection: view };
}

export async function getConnectionView(
  client: any,
  workspaceId: string,
): Promise<WixConnectionView | null> {
  const { data: connection, error } = await client
    .from("workspace_connections")
    .select("id, status, account_login, last_error")
    .eq("workspace_id", workspaceId)
    .eq("provider", PROVIDER)
    .neq("status", "revoked")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!connection) return null;
  const { data: site, error: siteError } = await client
    .from("wix_sites")
    .select("site_id, site_name, site_url, domains, installed_apps")
    .eq("workspace_id", workspaceId)
    .eq("connection_id", connection.id)
    .eq("selected", true)
    .maybeSingle();
  if (siteError) throw new Error(siteError.message);
  return {
    connectionId: connection.id,
    accountLabel: connection.account_login,
    status: connection.status,
    lastError: connection.last_error ?? null,
    site: site
      ? {
          id: site.site_id,
          name: site.site_name,
          url: site.site_url ?? null,
          domains: site.domains ?? [],
          hasBlog: hasWixBlog(site.installed_apps),
        }
      : null,
  };
}

/** A token and the connected site, for changing this workspace's Wix site. */
export async function wixAccess(workspaceId: string): Promise<{
  token: string;
  connectionId: string;
  site: WixSiteView;
  ownerEmail: string | null;
}> {
  const view = await getConnectionView(supabaseAdmin, workspaceId);
  if (!view) throw new HttpError(409, "Connect Wix first.");
  if (!view.site) throw new HttpError(409, "Connect Wix again so Mellox can see your site.");
  const token = await tokenFor(view.connectionId, workspaceId);
  return {
    token,
    connectionId: view.connectionId,
    site: view.site,
    ownerEmail: view.accountLabel.includes("@") ? view.accountLabel : null,
  };
}

/** Read the site from Wix again (name, address, installed Wix apps). */
export async function refreshSite(workspaceId: string) {
  const view = await getConnectionView(supabaseAdmin, workspaceId);
  if (!view) throw new HttpError(409, "Connect Wix first.");
  const token = await tokenFor(view.connectionId, workspaceId);
  try {
    const info = await getAppInstance(token);
    const row = siteRow(workspaceId, view.connectionId, info);
    await db.from("wix_sites").upsert(row, { onConflict: "workspace_id,site_id" });
    await supabaseAdmin
      .from("workspace_connections")
      .update({ status: "active", last_error: null, last_verified_at: new Date().toISOString() })
      .eq("id", view.connectionId);
  } catch (error) {
    if (error instanceof Error) await markError(view.connectionId, workspaceId, error.message);
    throw error;
  }
  return getConnectionView(supabaseAdmin, workspaceId);
}

export async function disconnect(args: {
  workspaceId: string;
  connectionId: string;
  userId: string;
}) {
  const { data } = await supabaseAdmin
    .from("workspace_connections")
    .select("id")
    .eq("id", args.connectionId)
    .eq("workspace_id", args.workspaceId)
    .eq("provider", PROVIDER)
    .maybeSingle();
  if (!data) throw new HttpError(404, "Wix connection not found.");
  // The instance id is the credential: forgetting it is what disconnects.
  await db.from("wix_oauth_credentials").delete().eq("connection_id", args.connectionId);
  await db
    .from("wix_sites")
    .update({ selected: false, status: "unavailable" })
    .eq("connection_id", args.connectionId);
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
    action: "connector.wix.disconnected",
    entity: "connector",
  });
  return { removed: true };
}
