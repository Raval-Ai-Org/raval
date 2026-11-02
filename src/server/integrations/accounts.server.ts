// accounts.server.ts — connecting, checking and disconnecting apps through
// Composio (ADR-0042).
//
// Connecting:
//   1. startConnect asks Composio for a sign-in link. Composio answers with
//      the id the new account will have, which is stored at once as a
//      'pending' row of this workspace, plus a hashed single-use state.
//   2. The person signs in at the app in the small window; Composio returns
//      them to /api/integrations/apps/callback?state=… with its account id.
//   3. completeConnect checks the state (same person, not expired, unused),
//      that the id is this workspace's pending row, and — reading Composio
//      itself, never the query string — that the account is ACTIVE, for this
//      toolkit, and belongs to this workspace's Composio user.
//
// Composio sends no event when a connection stops working, so sweepAccounts
// (from the existing sdr-reconcile hook) re-reads each account every 6 hours,
// and the action guard flips an account the moment a call is refused.
import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { recordAudit } from "@/server/audit.server";
import { HttpError } from "@/server/http-error";
import { allowedReturnOriginFrom, safeReturnPath } from "@/server/connectors/return-url";
import { isIntegrationsEnabled, isIntegrationsTesting } from "@/lib/feature-flags";
import {
  composioUserId,
  integrationApp,
  isConnectable,
  type IntegrationApp,
} from "@/lib/integrations/catalog";
import {
  ComposioGatewayError,
  composioConfigured,
  createLink,
  deleteAccount,
  getAccount,
  listAccounts,
  type ComposioAccount,
} from "@/server/integrations/composio/gateway.server";

const PROVIDER = "apps";
const STATE_TTL = 20 * 60_000;
const CHECK_EVERY_MS = 6 * 3600_000;
const PENDING_TTL_MS = 24 * 3600_000;
const stateFormat = /^[A-Za-z0-9_-]{32,128}$/;
const hashState = (state: string) => createHash("sha256").update(state).digest("hex");
const db = supabaseAdmin as unknown as { from: (table: string) => any };

export const APPS_CALLBACK_PATH = "/api/integrations/apps/callback";

export type IntegrationAccountView = {
  id: string;
  app: string;
  label: string;
  status: "active" | "reconnect_required" | "error";
  connectedAt: string | null;
  /** Plain words for the person; never the provider's raw error. */
  problem: string | null;
};

export type IntegrationsView = {
  enabled: boolean;
  /** Composio is set up on this server. */
  configured: boolean;
  /** This workspace may connect apps still in their capability check. */
  testing: boolean;
  accounts: IntegrationAccountView[];
};

function returnOriginFor(candidate: string | null | undefined): string | null {
  return allowedReturnOriginFrom(candidate, process.env, {
    allowLocal: process.env.NODE_ENV !== "production",
    extraOrigins: process.env.GITHUB_ALLOWED_RETURN_ORIGINS,
  });
}

function appBase(origin: string | null): string {
  const base = origin ?? process.env.APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "";
  if (!base) throw new HttpError(503, "Connected apps aren't configured on this server.");
  return base.replace(/\/+$/, "");
}

function requireApp(id: string, workspaceId: string): IntegrationApp {
  const app = integrationApp(id);
  if (
    !app ||
    !app.toolkit ||
    !isConnectable(app, { testing: isIntegrationsTesting(workspaceId) })
  ) {
    throw new HttpError(400, "That app can't be connected yet.");
  }
  return app;
}

function viewOf(row: any): IntegrationAccountView {
  const app = integrationApp(row.app);
  return {
    id: row.id,
    app: row.app,
    label: row.label || app?.name || row.app,
    status: row.status,
    connectedAt: row.connected_at,
    problem:
      row.status === "reconnect_required"
        ? "Mellox can't reach this account any more. Connect it again."
        : row.status === "error"
          ? "This connection didn't finish. Try again."
          : null,
  };
}

/** What Settings shows. Read with the caller's own client, so RLS applies. */
export async function getIntegrationsView(
  supabase: { from: (table: string) => any },
  workspaceId: string,
): Promise<IntegrationsView> {
  const enabled = isIntegrationsEnabled(workspaceId);
  if (!enabled) return { enabled, configured: false, testing: false, accounts: [] };
  const { data, error } = await supabase
    .from("integration_accounts")
    .select("id, app, label, status, connected_at")
    .eq("workspace_id", workspaceId)
    .in("status", ["active", "reconnect_required"])
    .order("connected_at", { ascending: true });
  if (error) throw new Error(`Couldn't read connected apps: ${error.message}`);
  return {
    enabled,
    configured: composioConfigured(),
    testing: isIntegrationsTesting(workspaceId),
    accounts: (data ?? []).map(viewOf),
  };
}

export async function startConnect(args: {
  workspaceId: string;
  userId: string;
  app: string;
  /** Connect again in place of this account (same app). */
  replaces?: string | null;
  returnOrigin?: string | null;
  returnPath?: string | null;
}): Promise<{ url: string; expiresInSeconds: number }> {
  if (!isIntegrationsEnabled(args.workspaceId)) throw new HttpError(404, "Not found");
  if (!composioConfigured()) {
    throw new HttpError(503, "Connected apps aren't configured on this server.");
  }
  const app = requireApp(args.app, args.workspaceId);
  const origin = returnOriginFor(args.returnOrigin);
  if (args.returnOrigin && !origin)
    throw new HttpError(400, "Mellox can't return to this address.");

  if (args.replaces) {
    const { data: old } = await db
      .from("integration_accounts")
      .select("id, app")
      .eq("id", args.replaces)
      .eq("workspace_id", args.workspaceId)
      .maybeSingle();
    if (!old || old.app !== app.id)
      throw new HttpError(404, "That account isn't in this workspace.");
  } else if (!app.multiple) {
    const { count } = await db
      .from("integration_accounts")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", args.workspaceId)
      .eq("app", app.id)
      .eq("status", "active");
    if ((count ?? 0) > 0) throw new HttpError(409, `${app.name} is already connected.`);
  }

  const state = randomBytes(32).toString("base64url");
  const callbackUrl = `${appBase(origin)}${APPS_CALLBACK_PATH}?state=${state}`;
  const link = await createLink({
    toolkit: app.toolkit!,
    userId: composioUserId(args.workspaceId),
    callbackUrl,
  });

  const { error: rowError } = await db.from("integration_accounts").insert({
    workspace_id: args.workspaceId,
    app: app.id,
    toolkit: app.toolkit,
    composio_account_id: link.connectedAccountId,
    auth_config_id: link.authConfigId,
    status: "pending",
    connected_by: args.userId,
    metadata: args.replaces ? { replaces: args.replaces } : {},
  });
  if (rowError) throw new Error(`Couldn't start the connection: ${rowError.message}`);

  const { error: stateError } = await db.from("connector_install_states").insert({
    state_hash: hashState(state),
    workspace_id: args.workspaceId,
    user_id: args.userId,
    provider: PROVIDER,
    expires_at: new Date(Date.now() + STATE_TTL).toISOString(),
    return_origin: origin,
    return_path: safeReturnPath(args.returnPath),
  });
  if (stateError) throw new Error(`Couldn't start the connection: ${stateError.message}`);

  return { url: link.redirectUrl, expiresInSeconds: STATE_TTL / 1000 };
}

/** Where the callback route sends the browser back to. */
export async function returnOrigin(state: string): Promise<string | null> {
  if (!stateFormat.test(state)) return null;
  const { data } = await db
    .from("connector_install_states")
    .select("return_origin")
    .eq("state_hash", hashState(state))
    .eq("provider", PROVIDER)
    .maybeSingle();
  return returnOriginFor(data?.return_origin ?? null);
}

async function consumeState(value: string, userId: string) {
  if (!stateFormat.test(value)) throw new HttpError(400, "This connection link is invalid.");
  const { data, error } = await db
    .from("connector_install_states")
    .select("id, workspace_id, user_id, expires_at, consumed_at, return_path")
    .eq("state_hash", hashState(value))
    .eq("provider", PROVIDER)
    .maybeSingle();
  if (
    error ||
    !data ||
    data.user_id !== userId ||
    data.consumed_at ||
    Date.parse(data.expires_at) < Date.now()
  ) {
    throw new HttpError(400, "This connection link has expired. Start again from Mellox.");
  }
  // Single use: only the first completion claims it.
  const { data: claimed } = await db
    .from("connector_install_states")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", data.id)
    .is("consumed_at", null)
    .select("id")
    .maybeSingle();
  if (!claimed) throw new HttpError(400, "This connection link was already used.");
  return {
    workspaceId: data.workspace_id as string,
    returnPath: (data.return_path as string | null) ?? null,
  };
}

/** The workspace id a state belongs to, for the role check before completing. */
export async function stateWorkspace(value: string, userId: string): Promise<string> {
  if (!stateFormat.test(value)) throw new HttpError(400, "This connection link is invalid.");
  const { data } = await db
    .from("connector_install_states")
    .select("workspace_id, user_id")
    .eq("state_hash", hashState(value))
    .eq("provider", PROVIDER)
    .maybeSingle();
  if (!data || data.user_id !== userId) {
    throw new HttpError(400, "This connection link has expired. Start again from Mellox.");
  }
  return data.workspace_id as string;
}

/** Does Composio say this account belongs to this workspace? */
async function ownedBy(account: ComposioAccount, workspaceId: string): Promise<boolean> {
  const owner = composioUserId(workspaceId);
  if (account.userId) return account.userId === owner;
  const mine = await listAccounts(owner);
  return mine.some((a) => a.id === account.id);
}

export async function completeConnect(args: {
  state: string;
  connectedAccountId: string;
  userId: string;
}): Promise<{
  status: "connected" | "error";
  app: string;
  label: string | null;
  returnPath: string | null;
}> {
  const state = await consumeState(args.state, args.userId);
  const { data: row } = await db
    .from("integration_accounts")
    .select("id, app, toolkit, status, metadata")
    .eq("workspace_id", state.workspaceId)
    .eq("composio_account_id", args.connectedAccountId)
    .maybeSingle();
  if (!row || row.status !== "pending") {
    throw new HttpError(400, "This connection doesn't match what Mellox started. Try again.");
  }

  const account = await getAccount(args.connectedAccountId);
  const app = integrationApp(row.app);
  const owned = account.toolkit === row.toolkit && (await ownedBy(account, state.workspaceId));
  if (!owned) {
    await db
      .from("integration_accounts")
      .update({ status: "error", last_error: "account did not match this workspace" })
      .eq("id", row.id);
    throw new HttpError(400, "This connection doesn't match what Mellox started. Try again.");
  }
  if (account.status !== "ACTIVE" || account.isDisabled) {
    await db
      .from("integration_accounts")
      .update({
        status: "error",
        last_error: (account.statusReason ?? account.status).slice(0, 500),
      })
      .eq("id", row.id);
    return { status: "error", app: row.app, label: null, returnPath: state.returnPath };
  }

  const label = account.alias || account.wordId || app?.name || row.app;
  const now = new Date().toISOString();
  const { error } = await db
    .from("integration_accounts")
    .update({
      status: "active",
      label,
      auth_config_id: account.authConfigId || undefined,
      connected_at: now,
      last_checked_at: now,
      last_error: null,
      connected_by: args.userId,
    })
    .eq("id", row.id)
    .eq("status", "pending");
  if (error) throw new Error(`Couldn't save the connection: ${error.message}`);

  // A social network: find where it can post (Pages, boards, the business
  // account) so it shows up in the publish picker. A failure leaves the
  // connection on with a plain reason; it never undoes the sign-in.
  try {
    const { syncDestinations } = await import("@/server/social/composio/service.server");
    await syncDestinations({
      workspaceId: state.workspaceId,
      integrationAccountId: row.id,
      app: row.app,
      connectedBy: args.userId,
    });
  } catch (error) {
    console.warn(
      "[integrations] destination lookup failed",
      row.id,
      error instanceof Error ? error.message : error,
    );
  }

  const replaces = (row.metadata as { replaces?: string } | null)?.replaces;
  if (replaces) {
    await retire({
      workspaceId: state.workspaceId,
      accountId: replaces,
      userId: args.userId,
      reason: "replaced",
    });
  }
  await recordAudit({
    workspaceId: state.workspaceId,
    userId: args.userId,
    action: replaces ? "integrations.reconnect" : "integrations.connect",
    entity: row.id,
    payload: { app: row.app },
  });
  return { status: "connected", app: row.app, label, returnPath: state.returnPath };
}

export async function retire(args: {
  workspaceId: string;
  accountId: string;
  userId: string | null;
  reason: string;
}): Promise<boolean> {
  const { data: row } = await db
    .from("integration_accounts")
    .select("id, composio_account_id, status")
    .eq("id", args.accountId)
    .eq("workspace_id", args.workspaceId)
    .maybeSingle();
  if (!row || row.status === "disconnected") return false;
  try {
    await deleteAccount(row.composio_account_id);
  } catch (error) {
    // Still disconnect on our side: Mellox stops using it either way, and the
    // sweep never re-reads a disconnected row.
    console.warn(
      "[integrations] Composio delete failed",
      row.id,
      error instanceof Error ? error.message : error,
    );
  }
  await db
    .from("integration_accounts")
    .update({
      status: "disconnected",
      revoked_at: new Date().toISOString(),
      revoked_by: args.userId,
      last_error: args.reason,
    })
    .eq("id", row.id);
  await db
    .from("social_accounts")
    .update({ status: "disconnected", disconnected_at: new Date().toISOString() })
    .eq("integration_account_id", row.id);
  return true;
}

export async function disconnect(args: {
  workspaceId: string;
  accountId: string;
  userId: string;
}): Promise<{ disconnected: boolean }> {
  if (!isIntegrationsEnabled(args.workspaceId)) throw new HttpError(404, "Not found");
  const disconnected = await retire({ ...args, reason: "disconnected by a person" });
  if (!disconnected) throw new HttpError(404, "That account isn't connected.");
  await recordAudit({
    workspaceId: args.workspaceId,
    userId: args.userId,
    action: "integrations.disconnect",
    entity: args.accountId,
  });
  return { disconnected };
}

/** Pure: what a Composio account's state means for our row. Exported for tests. */
export function sweepVerdict(account: ComposioAccount | null): {
  status: "active" | "reconnect_required" | "disconnected";
  reason: string | null;
} {
  if (!account) return { status: "disconnected", reason: "removed at the app" };
  if (account.status === "ACTIVE" && !account.isDisabled) return { status: "active", reason: null };
  if (account.status === "INITIATED" || account.status === "INITIALIZING") {
    return { status: "reconnect_required", reason: "sign-in never finished" };
  }
  return {
    status: "reconnect_required",
    reason: (account.statusReason || account.status || "unknown").slice(0, 500),
  };
}

/**
 * Re-read the accounts not checked for 6 hours, oldest first, and drop
 * sign-ins nobody finished. Called from the sdr-reconcile hook.
 */
export async function sweepAccounts(opts: { limit?: number; now?: number } = {}) {
  const now = opts.now ?? Date.now();
  const result = { checked: 0, reconnect: 0, removed: 0, pendingDropped: 0 };
  if (!composioConfigured()) return result;

  const { data: stale } = await db
    .from("integration_accounts")
    .delete()
    .eq("status", "pending")
    .lt("created_at", new Date(now - PENDING_TTL_MS).toISOString())
    .select("id");
  result.pendingDropped = stale?.length ?? 0;

  const { data: rows, error } = await db
    .from("integration_accounts")
    .select("id, workspace_id, composio_account_id, status, last_checked_at")
    .in("status", ["active", "reconnect_required"])
    .or(
      `last_checked_at.is.null,last_checked_at.lt.${new Date(now - CHECK_EVERY_MS).toISOString()}`,
    )
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .limit(opts.limit ?? 40);
  if (error) throw new Error(`Couldn't read connected apps: ${error.message}`);

  for (const row of rows ?? []) {
    if (!isIntegrationsEnabled(row.workspace_id)) continue;
    let account: ComposioAccount | null;
    try {
      account = await getAccount(row.composio_account_id);
    } catch (err) {
      if (err instanceof ComposioGatewayError && err.kind === "not_found") account = null;
      else {
        // Composio itself is down or refused our key: never blame the person's account.
        console.warn(
          "[integrations] sweep read failed",
          row.id,
          err instanceof Error ? err.message : err,
        );
        continue;
      }
    }
    const verdict = sweepVerdict(account);
    result.checked += 1;
    if (verdict.status === "reconnect_required" && row.status === "active") result.reconnect += 1;
    if (verdict.status === "disconnected") result.removed += 1;
    await db
      .from("integration_accounts")
      .update({
        status: verdict.status,
        last_checked_at: new Date(now).toISOString(),
        last_error: verdict.reason,
        ...(verdict.status === "disconnected" ? { revoked_at: new Date(now).toISOString() } : {}),
      })
      .eq("id", row.id);
  }
  return result;
}
