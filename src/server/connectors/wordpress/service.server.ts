import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  decryptWithKey,
  encryptWithKey,
  readEncryptionKey,
} from "@/server/crypto/secret-box.server";
import { HttpError } from "@/server/http-error";
import { recordAudit } from "@/server/audit.server";
import {
  createPage,
  createPost,
  discover,
  getCurrentUser,
  listCategories,
  listMedia,
  listPages,
  listPosts,
  listTags,
  normalizeWordPressUrl,
  updatePage,
  updatePost,
  uploadMedia,
  type WordPressSite,
  exchangeWordPressCode,
  getWordPressComUser,
  listWordPressComMedia,
  listWordPressComPages,
  listWordPressComPosts,
  listWordPressComSites,
  refreshWordPressToken,
} from "./api.server";
import {
  requireWordPressOAuthConfig,
  wordpressTokenKey,
  WORDPRESS_AUTH_ENDPOINT,
} from "./config.server";
import { safeReturnPath } from "@/server/connectors/return-url";
import { allowedReturnOriginFrom } from "@/server/connectors/return-url";

const PROVIDER = "wordpress";
const db = supabaseAdmin as unknown as { from: (table: string) => any };
const key = () => readEncryptionKey("WORDPRESS_TOKEN_ENCRYPTION_KEY");
const STATE_TTL_MS = 20 * 60_000;
const STATE_FORMAT = /^[A-Za-z0-9_-]{32,128}$/;
const hashState = (state: string) => createHash("sha256").update(state).digest("hex");

export type WordPressConnectionView = {
  connectionId: string;
  siteUrl: string;
  siteName: string;
  username: string;
  accountName: string;
  status: string;
  lastVerifiedAt: string | null;
  lastError: string | null;
  authType: "application_password" | "wordpress_com_oauth";
  sites: WordPressSiteView[];
  selectedSite: WordPressSiteView | null;
};

export type WordPressSiteView = {
  id: string;
  siteId: string | null;
  url: string;
  name: string;
  selected: boolean;
  status: string;
};

export function buildWordPressOAuthUrl(args: {
  state: string;
  clientId: string;
  redirectUri: string;
}) {
  const url = new URL(WORDPRESS_AUTH_ENDPOINT);
  url.searchParams.set("client_id", args.clientId);
  url.searchParams.set("redirect_uri", args.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "global");
  url.searchParams.set("state", args.state);
  return url.toString();
}

export async function createOAuthUrl(args: {
  workspaceId: string;
  userId: string;
  returnOrigin?: string | null;
  returnPath?: string | null;
}) {
  const config = requireWordPressOAuthConfig();
  const origin = allowedReturnOriginFrom(args.returnOrigin, process.env, {
    allowLocal: process.env.NODE_ENV !== "production",
  });
  if (args.returnOrigin && !origin)
    throw new HttpError(400, "WordPress.com cannot return to this address.");
  const state = randomBytes(32).toString("base64url");
  const { error } = await supabaseAdmin.from("connector_install_states").insert({
    state_hash: hashState(state),
    workspace_id: args.workspaceId,
    user_id: args.userId,
    provider: "wordpress",
    expires_at: new Date(Date.now() + STATE_TTL_MS).toISOString(),
    return_origin: origin,
    return_path: safeReturnPath(args.returnPath),
  });
  if (error) throw new Error(`Couldn't start WordPress.com connection: ${error.message}`);
  return {
    url: buildWordPressOAuthUrl({
      state,
      clientId: config.clientId,
      redirectUri: config.redirectUri,
    }),
    expiresInSeconds: STATE_TTL_MS / 1000,
  };
}

export async function returnOrigin(state: string) {
  if (!STATE_FORMAT.test(state)) return null;
  const { data } = await supabaseAdmin
    .from("connector_install_states")
    .select("return_origin")
    .eq("state_hash", hashState(state))
    .eq("provider", "wordpress")
    .maybeSingle();
  return allowedReturnOriginFrom(data?.return_origin ?? null, process.env, { allowLocal: true });
}

async function readOAuthState(state: string, userId: string) {
  if (!STATE_FORMAT.test(state))
    throw new HttpError(400, "This WordPress.com connection link is invalid.");
  const { data, error } = await supabaseAdmin
    .from("connector_install_states")
    .select("id, workspace_id, user_id, expires_at, consumed_at, return_path")
    .eq("state_hash", hashState(state))
    .eq("provider", "wordpress")
    .maybeSingle();
  if (
    error ||
    !data ||
    data.user_id !== userId ||
    data.consumed_at ||
    Date.parse(data.expires_at) < Date.now()
  )
    throw new HttpError(400, "This WordPress.com connection link has expired.");
  return data;
}

function validateCredentials(username: string, applicationPassword: string) {
  const cleanUser = username.trim();
  const cleanPassword = applicationPassword.trim();
  if (!cleanUser || cleanUser.length > 200)
    throw new HttpError(400, "Enter a valid WordPress username.");
  if (!cleanPassword || cleanPassword.length > 300)
    throw new HttpError(400, "Enter a valid WordPress Application Password.");
  return { username: cleanUser, applicationPassword: cleanPassword };
}

async function credentialsFor(connectionId: string, workspaceId: string) {
  const { data, error } = await db
    .from("wordpress_credentials")
    .select("*")
    .eq("connection_id", connectionId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error || !data) throw new HttpError(409, "WordPress is not connected for this workspace.");
  try {
    return {
      siteUrl: data.site_url,
      username: data.username,
      applicationPassword: decryptWithKey(data.application_password_enc, key()),
    };
  } catch {
    throw new HttpError(500, "WordPress credentials could not be read securely.");
  }
}

async function saveSite(
  workspaceId: string,
  connectionId: string,
  siteUrl: string,
  site: WordPressSite,
) {
  await db.from("wordpress_sites").upsert(
    {
      workspace_id: workspaceId,
      connection_id: connectionId,
      site_url: siteUrl,
      site_name: site.name?.trim() || siteUrl,
      selected: true,
      status: "active",
      last_synced_at: new Date().toISOString(),
      last_error: null,
    },
    { onConflict: "workspace_id,site_url" },
  );
}

function view(row: any): WordPressConnectionView {
  return {
    connectionId: row.id,
    siteUrl: row.site_url,
    siteName: row.site_name || row.site_url,
    username: row.username,
    accountName: row.account_name || row.username,
    status: row.status,
    lastVerifiedAt: row.last_verified_at,
    lastError: row.last_error,
    authType:
      row.auth_type === "wordpress_com_oauth" ? "wordpress_com_oauth" : "application_password",
    sites: row.sites ?? [],
    selectedSite: (row.sites ?? []).find((site: WordPressSiteView) => site.selected) ?? null,
  };
}

function siteView(row: any): WordPressSiteView {
  return {
    id: row.id,
    siteId: row.wordpress_site_id ?? null,
    url: row.site_url,
    name: row.site_name,
    selected: row.selected === true,
    status: row.status,
  };
}

export async function getConnectionView(
  client: any,
  workspaceId: string,
): Promise<WordPressConnectionView | null> {
  const { data: connection, error } = await client
    .from("workspace_connections")
    .select("id, status, last_verified_at, last_error")
    .eq("workspace_id", workspaceId)
    .eq("provider", PROVIDER)
    .neq("status", "revoked")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!connection) return null;
  const { data: credential, error: credentialError } = await db
    .from("wordpress_credentials")
    .select("site_url, username, site_name")
    .eq("connection_id", connection.id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  const { data: oauth } = await db
    .from("wordpress_oauth_credentials")
    .select("wordpress_user_login")
    .eq("connection_id", connection.id)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (credentialError || (!credential && !oauth)) return null;
  const { data: sites } = await db
    .from("wordpress_sites")
    .select("id, wordpress_site_id, site_url, site_name, selected, status")
    .eq("workspace_id", workspaceId)
    .eq("connection_id", connection.id)
    .order("site_name");
  return view({
    ...connection,
    ...(credential ?? {}),
    account_name: oauth?.wordpress_user_login ?? credential?.username,
    auth_type: oauth ? "wordpress_com_oauth" : "application_password",
    sites: (sites ?? []).map(siteView),
  });
}

export async function completeOAuth(args: { state: string; code: string; userId: string }) {
  const state = await readOAuthState(args.state, args.userId);
  const config = requireWordPressOAuthConfig();
  const tokens = await exchangeWordPressCode({
    code: args.code,
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    redirectUri: config.redirectUri,
  });
  const user = await getWordPressComUser(tokens.accessToken);
  const sites = (await listWordPressComSites(tokens.accessToken)).sites ?? [];
  const externalId = `wordpress.com:${user.ID ?? user.username ?? "user"}`;
  const { data: connection, error } = await supabaseAdmin
    .from("workspace_connections")
    .upsert(
      {
        workspace_id: state.workspace_id,
        provider: PROVIDER,
        status: "active",
        external_account_id: externalId,
        account_login: user.username ?? user.display_name ?? "WordPress.com account",
        account_type: "wordpress_com_user",
        permissions: { posts: "read_write", pages: "read_write", media: "read_write" },
        verification: "oauth",
        connected_by: args.userId,
        last_verified_at: new Date().toISOString(),
        last_error: null,
        revoked_at: null,
        revoked_reason: null,
      },
      { onConflict: "workspace_id,provider,external_account_id" },
    )
    .select("id")
    .single();
  if (error || !connection)
    throw new Error("WordPress.com was verified but Mellox could not save the connection.");
  await db.from("wordpress_oauth_credentials").upsert(
    {
      connection_id: connection.id,
      workspace_id: state.workspace_id,
      access_token_enc: encryptWithKey(tokens.accessToken, wordpressTokenKey()),
      refresh_token_enc: tokens.refreshToken
        ? encryptWithKey(tokens.refreshToken, wordpressTokenKey())
        : null,
      access_token_expires_at: tokens.expiresAt?.toISOString() ?? null,
      scopes: tokens.scopes,
      wordpress_user_id: user.ID ? String(user.ID) : null,
      wordpress_user_login: user.username ?? null,
    },
    { onConflict: "connection_id" },
  );
  await db
    .from("wordpress_sites")
    .update({ selected: false })
    .eq("workspace_id", state.workspace_id)
    .eq("connection_id", connection.id);
  await db.from("wordpress_sites").upsert(
    sites.map((site) => ({
      workspace_id: state.workspace_id,
      connection_id: connection.id,
      wordpress_site_id: String(site.ID),
      site_url: site.URL ?? `https://wordpress.com/site/${site.ID}`,
      site_name: site.name ?? String(site.ID),
      selected: false,
      status: "active",
    })),
    { onConflict: "workspace_id,wordpress_site_id" },
  );
  await supabaseAdmin
    .from("connector_install_states")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", state.id)
    .is("consumed_at", null);
  await recordAudit({
    workspaceId: state.workspace_id,
    userId: args.userId,
    action: "connector.wordpress.com.connected",
    entity: "connector",
  });
  return {
    workspaceId: state.workspace_id,
    returnPath: safeReturnPath(state.return_path),
    connection: await getConnectionView(supabaseAdmin, state.workspace_id),
  };
}

export async function connect(args: {
  workspaceId: string;
  userId: string;
  siteUrl: string;
  username: string;
  applicationPassword: string;
}) {
  const siteUrl = normalizeWordPressUrl(args.siteUrl);
  const credentials = validateCredentials(args.username, args.applicationPassword);
  const site = await discover(siteUrl, credentials.username, credentials.applicationPassword);
  const user = await getCurrentUser(siteUrl, credentials.username, credentials.applicationPassword);
  const { data: connection, error } = await supabaseAdmin
    .from("workspace_connections")
    .upsert(
      {
        workspace_id: args.workspaceId,
        provider: PROVIDER,
        status: "active",
        external_account_id: siteUrl,
        account_login: user.slug || credentials.username,
        account_type: "wordpress_user",
        permissions: { posts: "read_write", pages: "read_write", media: "read_write" },
        verification: "application_password",
        connected_by: args.userId,
        last_verified_at: new Date().toISOString(),
        last_error: null,
        revoked_at: null,
        revoked_reason: null,
      },
      { onConflict: "workspace_id,provider,external_account_id" },
    )
    .select("id")
    .single();
  if (error || !connection)
    throw new Error("WordPress verified but Mellox could not save the connection.");
  await db.from("wordpress_credentials").upsert(
    {
      connection_id: connection.id,
      workspace_id: args.workspaceId,
      site_url: siteUrl,
      username: credentials.username,
      application_password_enc: encryptWithKey(credentials.applicationPassword, key()),
      site_name: site.name || siteUrl,
      site_description: site.description || null,
      site_home: site.home || null,
      api_namespaces: site.namespaces || [],
    },
    { onConflict: "connection_id" },
  );
  await saveSite(args.workspaceId, connection.id, siteUrl, site);
  await recordAudit({
    workspaceId: args.workspaceId,
    userId: args.userId,
    action: "connector.wordpress.connected",
    entity: "connector",
  });
  return getConnectionView(supabaseAdmin, args.workspaceId);
}

export async function refresh(args: { workspaceId: string; userId: string }) {
  const current = await getConnectionView(supabaseAdmin, args.workspaceId);
  if (!current) throw new HttpError(409, "Connect WordPress first.");
  const credentials = await credentialsFor(current.connectionId, args.workspaceId);
  try {
    const site = await discover(
      credentials.siteUrl,
      credentials.username,
      credentials.applicationPassword,
    );
    await getCurrentUser(
      credentials.siteUrl,
      credentials.username,
      credentials.applicationPassword,
    );
    await supabaseAdmin
      .from("workspace_connections")
      .update({ status: "active", last_verified_at: new Date().toISOString(), last_error: null })
      .eq("id", current.connectionId)
      .eq("workspace_id", args.workspaceId);
    await saveSite(args.workspaceId, current.connectionId, credentials.siteUrl, site);
  } catch (error) {
    const message =
      error instanceof Error ? error.message.slice(0, 500) : "WordPress verification failed.";
    await supabaseAdmin
      .from("workspace_connections")
      .update({ status: "error", last_error: message })
      .eq("id", current.connectionId)
      .eq("workspace_id", args.workspaceId);
    throw error;
  }
  return getConnectionView(supabaseAdmin, args.workspaceId);
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
  if (!data) throw new HttpError(404, "WordPress connection not found.");
  await supabaseAdmin
    .from("workspace_connections")
    .delete()
    .eq("id", args.connectionId)
    .eq("workspace_id", args.workspaceId);
  await recordAudit({
    workspaceId: args.workspaceId,
    userId: args.userId,
    action: "connector.wordpress.disconnected",
    entity: "connector",
  });
  return { removed: true };
}

async function access(workspaceId: string) {
  const current = await getConnectionView(supabaseAdmin, workspaceId);
  if (!current || current.status !== "active")
    throw new HttpError(409, "Connect and verify WordPress first.");
  return credentialsFor(current.connectionId, workspaceId);
}

async function oauthAccess(connectionId: string, workspaceId: string) {
  const { data, error } = await db
    .from("wordpress_oauth_credentials")
    .select("*")
    .eq("connection_id", connectionId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error || !data)
    throw new HttpError(409, "WordPress.com is not connected for this workspace.");
  if (
    data.access_token_expires_at &&
    Date.parse(data.access_token_expires_at) - 60_000 <= Date.now() &&
    data.refresh_token_enc
  ) {
    const config = requireWordPressOAuthConfig();
    const fresh = await refreshWordPressToken({
      refreshToken: decryptWithKey(data.refresh_token_enc, wordpressTokenKey()),
      clientId: config.clientId,
      clientSecret: config.clientSecret,
    });
    await db
      .from("wordpress_oauth_credentials")
      .update({
        access_token_enc: encryptWithKey(fresh.accessToken, wordpressTokenKey()),
        refresh_token_enc: fresh.refreshToken
          ? encryptWithKey(fresh.refreshToken, wordpressTokenKey())
          : data.refresh_token_enc,
        access_token_expires_at: fresh.expiresAt?.toISOString() ?? null,
      })
      .eq("connection_id", connectionId);
    return fresh.accessToken;
  }
  return decryptWithKey(data.access_token_enc, wordpressTokenKey());
}

async function selectedOAuthSite(workspaceId: string, connectionId: string) {
  const { data } = await db
    .from("wordpress_sites")
    .select("wordpress_site_id")
    .eq("workspace_id", workspaceId)
    .eq("connection_id", connectionId)
    .eq("selected", true)
    .eq("status", "active")
    .maybeSingle();
  if (!data?.wordpress_site_id) throw new HttpError(409, "Select a WordPress.com site first.");
  return Number(data.wordpress_site_id);
}

export async function selectSite(args: {
  workspaceId: string;
  connectionId: string;
  siteId: string;
  userId: string;
}) {
  const current = await getConnectionView(supabaseAdmin, args.workspaceId);
  if (
    !current ||
    current.connectionId !== args.connectionId ||
    current.authType !== "wordpress_com_oauth"
  )
    throw new HttpError(404, "WordPress.com connection not found.");
  const allowed = current.sites.some((site) => site.siteId === args.siteId);
  if (!allowed)
    throw new HttpError(404, "That WordPress.com site is not available to this workspace.");
  await db
    .from("wordpress_sites")
    .update({ selected: false })
    .eq("workspace_id", args.workspaceId)
    .eq("connection_id", args.connectionId);
  await db
    .from("wordpress_sites")
    .update({ selected: true })
    .eq("workspace_id", args.workspaceId)
    .eq("connection_id", args.connectionId)
    .eq("wordpress_site_id", args.siteId);
  await recordAudit({
    workspaceId: args.workspaceId,
    userId: args.userId,
    action: "connector.wordpress.site_selected",
    entity: "connector",
    payload: { siteId: args.siteId },
  });
  return getConnectionView(supabaseAdmin, args.workspaceId);
}

export async function data(
  workspaceId: string,
  kind: "posts" | "pages" | "media" | "categories" | "tags",
) {
  const current = await getConnectionView(supabaseAdmin, workspaceId);
  if (current?.authType === "wordpress_com_oauth") {
    const token = await oauthAccess(current.connectionId, workspaceId);
    const siteId = await selectedOAuthSite(workspaceId, current.connectionId);
    if (kind === "posts") return listWordPressComPosts(token, siteId);
    if (kind === "pages") return listWordPressComPages(token, siteId);
    if (kind === "media") return listWordPressComMedia(token, siteId);
    throw new HttpError(
      400,
      "Categories and tags are not available through the WordPress.com connector yet.",
    );
  }
  const c = await access(workspaceId);
  if (kind === "posts") return listPosts(c.siteUrl, c.username, c.applicationPassword);
  if (kind === "pages") return listPages(c.siteUrl, c.username, c.applicationPassword);
  if (kind === "media") return listMedia(c.siteUrl, c.username, c.applicationPassword);
  if (kind === "categories") return listCategories(c.siteUrl, c.username, c.applicationPassword);
  return listTags(c.siteUrl, c.username, c.applicationPassword);
}

export async function publish(
  workspaceId: string,
  kind: "post" | "page",
  operation: "create" | "update",
  id: number | undefined,
  body: unknown,
) {
  const c = await access(workspaceId);
  if (kind === "post")
    return operation === "create"
      ? createPost(c.siteUrl, c.username, c.applicationPassword, body)
      : updatePost(c.siteUrl, c.username, c.applicationPassword, id!, body);
  return operation === "create"
    ? createPage(c.siteUrl, c.username, c.applicationPassword, body)
    : updatePage(c.siteUrl, c.username, c.applicationPassword, id!, body);
}

export async function media(
  workspaceId: string,
  filename: string,
  contentType: string,
  bytes: Uint8Array,
) {
  const c = await access(workspaceId);
  return uploadMedia(c.siteUrl, c.username, c.applicationPassword, filename, contentType, bytes);
}
