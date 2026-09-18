// service.server.ts — the Google Analytics / Search Console connector:
// connect (OAuth), choose a GA4 property and a Search Console site,
// sync now, remove, disconnect.
//
// Callers (src/server/fns/google-analytics.ts) authenticate the user and check
// their workspace role first; reads go through the caller's RLS client, and
// this module writes with the service role. Every change is audited without
// tokens. One Google connection per workspace (one brand = one workspace).
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Database } from "@/integrations/supabase/types";
import type { GoogleConnectionView } from "@/lib/analytics/types";
import { recordAudit } from "@/server/audit.server";
import { HttpError } from "@/server/http-error";
import { enqueueSync, kickRun } from "../sync/service.server";
import type { SourceRow } from "../sync/store";
import {
  assertPropertyId,
  assertSiteUrl,
  siteHostOf,
  type Ga4PropertyOption,
  type GscSiteOption,
} from "./api.server";
import { isGoogleConfigured, requireGoogleConfig } from "./config.server";
import { GoogleApiError, userMessageFor } from "./errors";
import {
  consumeAuthState,
  exchangeCode,
  GoogleConnectError,
  identityFromIdToken,
  readAuthState,
  revokeToken,
  scopeFlags,
} from "./oauth.server";
import { GOOGLE_CONNECTION_COLS, presentConnectionView, RUN_COLS, SOURCE_COLS } from "./present";
import {
  deleteCredentials,
  googleApiFor,
  readRefreshToken,
  saveCredentials,
} from "./tokens.server";

type Db = SupabaseClient<Database>;

async function audit(
  workspaceId: string,
  userId: string | null,
  action: string,
  payload: Record<string, unknown> = {},
) {
  await recordAudit({
    workspaceId,
    userId,
    action: `connector.google.${action}`,
    entity: "connector",
    payload,
  });
}

/** Map Google failures to user-facing HTTP errors for interactive calls. */
function asHttp(e: unknown): never {
  if (e instanceof GoogleApiError) {
    const status =
      e.code === "token_expired"
        ? 409
        : e.code === "quota"
          ? 429
          : e.code === "config"
            ? 503
            : e.code === "permission_denied"
              ? 403
              : 502;
    throw new HttpError(status, e.code === "config" ? e.message : userMessageFor(e.code));
  }
  throw e;
}

// ── Read ────────────────────────────────────────────────────────────────────
export async function getConnectionView(
  db: Db,
  workspaceId: string,
): Promise<GoogleConnectionView> {
  const [{ data: connection, error }, { data: sources, error: srcError }] = await Promise.all([
    db
      .from("workspace_connections")
      .select(GOOGLE_CONNECTION_COLS)
      .eq("workspace_id", workspaceId)
      .eq("provider", "google")
      .neq("status", "revoked")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    db.from("analytics_sources").select(SOURCE_COLS).eq("workspace_id", workspaceId),
  ]);
  if (error) throw new Error(error.message);
  if (srcError) throw new Error(srcError.message);
  const sourceIds = (sources ?? []).map((s) => s.id);
  let runs: Array<Record<string, unknown>> = [];
  if (sourceIds.length) {
    const { data, error: runError } = await db
      .from("analytics_sync_runs")
      .select(RUN_COLS)
      .eq("workspace_id", workspaceId)
      .in("source_id", sourceIds)
      .order("created_at", { ascending: false })
      .limit(10);
    if (runError) throw new Error(runError.message);
    runs = data ?? [];
  }
  return presentConnectionView({
    configured: isGoogleConfigured(workspaceId),
    connection: connection ?? null,
    sources: sources ?? [],
    runs: runs as never,
  });
}

/** The workspace's active Google connection (service-role read, workspace-checked). */
async function activeConnection(
  workspaceId: string,
): Promise<{ id: string; permissions: Record<string, unknown> }> {
  const { data, error } = await supabaseAdmin
    .from("workspace_connections")
    .select("id, workspace_id, status, permissions")
    .eq("workspace_id", workspaceId)
    .eq("provider", "google")
    .neq("status", "revoked")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.workspace_id !== workspaceId) throw new HttpError(409, "Connect Google first.");
  if (data.status !== "active") throw new HttpError(409, userMessageFor("token_expired"));
  return { id: data.id, permissions: (data.permissions ?? {}) as Record<string, unknown> };
}

// ── Connect ─────────────────────────────────────────────────────────────────
export type CompleteResult = {
  workspaceId: string;
  returnPath: string | null;
  email: string;
  scopes: { analytics: boolean; searchConsole: boolean };
  alreadyConnected: boolean;
};

/** Step 1 of completion: which workspace this state belongs to (for the role check). */
export async function resolveAuthState(state: string, userId: string) {
  return readAuthState(state, userId);
}

export async function completeConnect(args: {
  state: Awaited<ReturnType<typeof readAuthState>>;
  code: string;
  userId: string;
}): Promise<CompleteResult> {
  const { state, userId } = args;
  const config = requireGoogleConfig(state.workspaceId);

  if (state.consumedAt) {
    // A reload or double submit of the callback: report the saved connection.
    const { data } = await supabaseAdmin
      .from("workspace_connections")
      .select("account_login, permissions")
      .eq("workspace_id", state.workspaceId)
      .eq("provider", "google")
      .eq("connected_by", userId)
      .eq("status", "active")
      .gte("last_verified_at", state.createdAt)
      .maybeSingle();
    if (!data)
      throw new GoogleConnectError(
        "This connection link was already used. Start the Google connection again.",
      );
    const perms = (data.permissions ?? {}) as { analytics?: boolean; searchConsole?: boolean };
    return {
      workspaceId: state.workspaceId,
      returnPath: state.returnPath,
      email: data.account_login,
      scopes: { analytics: perms.analytics === true, searchConsole: perms.searchConsole === true },
      alreadyConnected: true,
    };
  }

  let tokens;
  try {
    tokens = await exchangeCode(args.code, state.verifier, config);
  } catch (e) {
    if (e instanceof GoogleApiError && e.code === "token_expired")
      throw new GoogleConnectError(
        "Google didn't accept this sign-in (it may have expired). Try connecting again.",
      );
    asHttp(e);
  }
  if (!(await consumeAuthState(state))) {
    await revokeToken(tokens.refreshToken ?? tokens.accessToken);
    throw new GoogleConnectError(
      "This connection link was already used. Start the Google connection again.",
    );
  }
  const identity = identityFromIdToken(tokens.idToken);
  const scopes = scopeFlags(tokens.scopes);
  if (!identity || !tokens.refreshToken) {
    await revokeToken(tokens.accessToken);
    throw new GoogleConnectError(
      "Google didn't return lasting access. Remove Mellox from your Google account's third-party access, then connect again.",
    );
  }
  if (!scopes.analytics && !scopes.searchConsole) {
    await revokeToken(tokens.refreshToken);
    throw new GoogleConnectError(
      "Mellox needs permission to read Google Analytics or Search Console. Connect again and tick the boxes on Google's screen.",
    );
  }

  const now = new Date().toISOString();
  const { data: conn, error } = await supabaseAdmin
    .from("workspace_connections")
    .upsert(
      {
        workspace_id: state.workspaceId,
        provider: "google",
        external_account_id: identity.sub,
        account_login: identity.email || `Google account ${identity.sub.slice(-4)}`,
        account_type: "google",
        status: "active",
        verification: "oauth",
        connected_by: userId,
        last_verified_at: now,
        last_error: null,
        revoked_at: null,
        revoked_reason: null,
        permissions: scopes,
        metadata: {},
      },
      { onConflict: "workspace_id,provider,external_account_id" },
    )
    .select("id")
    .single();
  if (error || !conn)
    throw new Error(`Couldn't save the Google connection: ${error?.message ?? "unknown"}`);

  await saveCredentials({
    connectionId: conn.id,
    workspaceId: state.workspaceId,
    tokens,
    refreshToken: tokens.refreshToken,
    sub: identity.sub,
    email: identity.email || null,
  });

  // One Google connection per workspace: retire any other account and move
  // the chosen property/site to this one (the next sync re-checks access).
  const { data: others } = await supabaseAdmin
    .from("workspace_connections")
    .select("id")
    .eq("workspace_id", state.workspaceId)
    .eq("provider", "google")
    .neq("id", conn.id)
    .neq("status", "revoked");
  for (const other of others ?? []) {
    const oldToken = await readRefreshToken(other.id);
    if (oldToken) await revokeToken(oldToken);
    await supabaseAdmin
      .from("analytics_sources")
      .update({ connection_id: conn.id })
      .eq("connection_id", other.id)
      .eq("workspace_id", state.workspaceId);
    await deleteCredentials(other.id);
    await supabaseAdmin
      .from("workspace_connections")
      .update({ status: "revoked", revoked_at: now, revoked_reason: "replaced" })
      .eq("id", other.id);
  }

  // Reconnecting fixes expired access: resume every source with a fresh sync.
  const { data: sources } = await supabaseAdmin
    .from("analytics_sources")
    .select("*")
    .eq("workspace_id", state.workspaceId);
  for (const source of sources ?? []) {
    const allowed = source.kind === "ga4_property" ? scopes.analytics : scopes.searchConsole;
    await supabaseAdmin
      .from("analytics_sources")
      .update(
        allowed
          ? { status: "active", last_error: null }
          : { status: "access_lost", last_error: "Google access for this wasn't granted." },
      )
      .eq("id", source.id);
    if (allowed) {
      const { run, created } = await enqueueSync({ ...source, status: "active" }, "manual", {
        requestedBy: userId,
      });
      if (created) kickRun(run.id);
    }
  }

  await audit(state.workspaceId, userId, "connected", {
    account: identity.email || null,
    analytics: scopes.analytics,
    searchConsole: scopes.searchConsole,
    replaced: (others ?? []).length,
  });

  return {
    workspaceId: state.workspaceId,
    returnPath: state.returnPath,
    email: identity.email,
    scopes,
    alreadyConnected: false,
  };
}

// ── Choose property / site ──────────────────────────────────────────────────
export async function listGa4Properties(workspaceId: string): Promise<Ga4PropertyOption[]> {
  const conn = await activeConnection(workspaceId);
  if (conn.permissions.analytics !== true)
    throw new HttpError(
      409,
      "Google Analytics access wasn't granted. Reconnect Google and allow it.",
    );
  try {
    return await googleApiFor(conn.id, workspaceId).listGa4Properties();
  } catch (e) {
    asHttp(e);
  }
}

export async function listGscSites(workspaceId: string): Promise<GscSiteOption[]> {
  const conn = await activeConnection(workspaceId);
  if (conn.permissions.searchConsole !== true)
    throw new HttpError(
      409,
      "Search Console access wasn't granted. Reconnect Google and allow it.",
    );
  try {
    return await googleApiFor(conn.id, workspaceId).listGscSites();
  } catch (e) {
    asHttp(e);
  }
}

async function replaceSource(args: {
  workspaceId: string;
  userId: string;
  connectionId: string;
  kind: "ga4_property" | "gsc_site";
  externalId: string;
  displayName: string;
  accountName: string | null;
  siteHost: string | null;
  timeZone: string | null;
  currency: string | null;
}): Promise<SourceRow> {
  const { data: existing } = await supabaseAdmin
    .from("analytics_sources")
    .select("id, external_id")
    .eq("workspace_id", args.workspaceId)
    .eq("kind", args.kind)
    .maybeSingle();
  // Another property/site: drop the old one and its stored data (never mix them).
  if (existing && existing.external_id !== args.externalId) {
    const { error } = await supabaseAdmin.from("analytics_sources").delete().eq("id", existing.id);
    if (error) throw new Error(error.message);
    await supabaseAdmin.from("analytics_insights").delete().eq("workspace_id", args.workspaceId);
  }
  const row = {
    workspace_id: args.workspaceId,
    connection_id: args.connectionId,
    kind: args.kind,
    external_id: args.externalId,
    display_name: args.displayName.slice(0, 200),
    account_name: args.accountName?.slice(0, 200) ?? null,
    site_host: args.siteHost,
    time_zone: args.timeZone,
    currency: args.currency,
    status: "active",
    last_error: null,
    selected_by: args.userId,
  };
  const { data, error } = await supabaseAdmin
    .from("analytics_sources")
    .upsert(row, { onConflict: "workspace_id,kind" })
    .select("*")
    .single();
  if (error || !data) throw new Error(error?.message ?? "Couldn't save the selection.");
  return data;
}

export async function selectGa4Property(args: {
  workspaceId: string;
  userId: string;
  propertyId: string;
}) {
  const propertyId = assertPropertyId(args.propertyId);
  const conn = await activeConnection(args.workspaceId);
  const api = googleApiFor(conn.id, args.workspaceId);
  let details;
  let accountName: string | null = null;
  try {
    // Confirms this Google account can read the property right now.
    details = await api.getGa4Property(propertyId);
    const listed = (await api.listGa4Properties()).find((p) => p.propertyId === propertyId);
    accountName = listed?.accountName ?? null;
  } catch (e) {
    asHttp(e);
  }
  const source = await replaceSource({
    workspaceId: args.workspaceId,
    userId: args.userId,
    connectionId: conn.id,
    kind: "ga4_property",
    externalId: propertyId,
    displayName: details.displayName,
    accountName,
    siteHost: null,
    timeZone: details.timeZone,
    currency: details.currencyCode,
  });
  const { run, created } = await enqueueSync(source, "initial", { requestedBy: args.userId });
  if (created) kickRun(run.id);
  await audit(args.workspaceId, args.userId, "ga4_selected", { property: propertyId });
  return { sourceId: source.id, runId: run.id };
}

export async function selectGscSite(args: {
  workspaceId: string;
  userId: string;
  siteUrl: string;
}) {
  const siteUrl = assertSiteUrl(args.siteUrl);
  const conn = await activeConnection(args.workspaceId);
  let sites: GscSiteOption[];
  try {
    sites = await googleApiFor(conn.id, args.workspaceId).listGscSites();
  } catch (e) {
    asHttp(e);
  }
  const site = sites.find((s) => s.siteUrl === siteUrl);
  if (!site) throw new HttpError(403, "This Google account can't read that Search Console site.");
  const source = await replaceSource({
    workspaceId: args.workspaceId,
    userId: args.userId,
    connectionId: conn.id,
    kind: "gsc_site",
    externalId: siteUrl,
    displayName: siteUrl.replace(/^sc-domain:/, ""),
    accountName: null,
    siteHost: siteHostOf(siteUrl),
    timeZone: "America/Los_Angeles",
    currency: null,
  });
  const { run, created } = await enqueueSync(source, "initial", { requestedBy: args.userId });
  if (created) kickRun(run.id);
  await audit(args.workspaceId, args.userId, "gsc_selected", { site: siteUrl });
  return { sourceId: source.id, runId: run.id };
}

export async function removeSource(args: {
  workspaceId: string;
  userId: string;
  kind: "ga4_property" | "gsc_site";
}) {
  const { error } = await supabaseAdmin
    .from("analytics_sources")
    .delete()
    .eq("workspace_id", args.workspaceId)
    .eq("kind", args.kind);
  if (error) throw new Error(error.message);
  await supabaseAdmin.from("analytics_insights").delete().eq("workspace_id", args.workspaceId);
  await audit(args.workspaceId, args.userId, "source_removed", { kind: args.kind });
}

export async function disconnect(args: { workspaceId: string; userId: string }) {
  const { data: conns, error } = await supabaseAdmin
    .from("workspace_connections")
    .select("id")
    .eq("workspace_id", args.workspaceId)
    .eq("provider", "google")
    .neq("status", "revoked");
  if (error) throw new Error(error.message);
  let revoked = false;
  for (const conn of conns ?? []) {
    const token = await readRefreshToken(conn.id);
    if (token) revoked = (await revokeToken(token)) || revoked;
    await deleteCredentials(conn.id);
    // Sources cascade to every stored GA4 / Search Console row and sync run.
    await supabaseAdmin
      .from("analytics_sources")
      .delete()
      .eq("connection_id", conn.id)
      .eq("workspace_id", args.workspaceId);
    await supabaseAdmin
      .from("workspace_connections")
      .update({
        status: "revoked",
        revoked_at: new Date().toISOString(),
        revoked_reason: "disconnected",
        permissions: {},
      })
      .eq("id", conn.id);
  }
  await supabaseAdmin.from("analytics_insights").delete().eq("workspace_id", args.workspaceId);
  await audit(args.workspaceId, args.userId, "disconnected", { googleRevoked: revoked });
  return { disconnected: (conns ?? []).length > 0 };
}

// ── Sync now ────────────────────────────────────────────────────────────────
export async function syncNow(args: { workspaceId: string; userId: string }) {
  await activeConnection(args.workspaceId);
  const { data: sources, error } = await supabaseAdmin
    .from("analytics_sources")
    .select("*")
    .eq("workspace_id", args.workspaceId)
    .eq("status", "active");
  if (error) throw new Error(error.message);
  if (!sources?.length)
    throw new HttpError(409, "Choose a GA4 property or Search Console site first.");
  const runs: string[] = [];
  for (const source of sources) {
    const { run, created } = await enqueueSync(source, "manual", { requestedBy: args.userId });
    if (created) kickRun(run.id);
    runs.push(run.id);
  }
  return { runs, queued: runs.length };
}
