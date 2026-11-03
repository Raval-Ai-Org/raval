// execute.server.ts — the one way to run a connected app's tool (ADR-0042).
//
// Every caller (publishing, feeds, chat reads, agents) comes through
// runIntegrationTool, which in order:
//   1. honours the kill switch (isIntegrationsEnabled);
//   2. loads the account by id and checks it belongs to the verified workspace
//      and is active — an id from a request or from user-editable `meta` is
//      never trusted on its own;
//   3. allows only a tool the catalog lists for that app (least privilege;
//      destructive tools are never listed);
//   4. checks the person's role against the tool's minRole;
//   5. refuses a write without an approval reference (the approved content
//      item, the clicked chat action, the approved agent request);
//   6. rate limits per workspace;
//   7. runs it, then records the call (integration_tool_calls, append-only)
//      and audits writes.
// A failed sign-in flips the account to `reconnect_required` so the person
// sees "Reconnect" instead of a silent failure.
import "server-only";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { recordAudit } from "@/server/audit.server";
import { HttpError } from "@/server/http-error";
import { consumeRateLimit, RateLimitedError } from "@/server/rate-limit";
import { isIntegrationsEnabled } from "@/lib/feature-flags";
import {
  allowedProxy,
  allowedTool,
  composioUserId,
  integrationApp,
  roleAllows,
} from "@/lib/integrations/catalog";
import {
  ComposioGatewayError,
  executeTool,
  proxyRequest,
  uploadFile,
  type ComposioExecution,
  type ComposioFile,
  type ProxyResult,
} from "@/server/integrations/composio/gateway.server";

const db = supabaseAdmin as unknown as { from: (table: string) => any };

export type ToolCaller =
  /** A person in the app (chat, a button, a page). */
  | { kind: "person"; userId: string; role: string }
  /** Background work for the workspace (publisher, feed sync, sweep). */
  | { kind: "worker"; actingUserId?: string | null };

export type RunToolArgs = {
  workspaceId: string;
  /** integration_accounts.id */
  accountId: string;
  tool: string;
  arguments: Record<string, unknown>;
  caller: ToolCaller;
  /** What asked for it: 'publish', 'feed', 'chat', 'sweep', 'agent' ... */
  purpose: string;
  /** Required for writes: the approval this runs under. */
  approvalRef?: string | null;
  timeoutMs?: number;
};

export type AccountRow = {
  id: string;
  workspace_id: string;
  app: string;
  toolkit: string;
  composio_account_id: string;
  status: string;
};

export async function loadAccount(workspaceId: string, accountId: string): Promise<AccountRow> {
  const { data, error } = await db
    .from("integration_accounts")
    .select("id, workspace_id, app, toolkit, composio_account_id, status")
    .eq("id", accountId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (error) throw new Error(`Couldn't read the connected account: ${error.message}`);
  if (!data) throw new HttpError(404, "That connected account isn't in this workspace.");
  return data as AccountRow;
}

export async function markReconnect(accountId: string, reason: string): Promise<void> {
  await db
    .from("integration_accounts")
    .update({ status: "reconnect_required", last_error: reason.slice(0, 500) })
    .eq("id", accountId)
    .eq("status", "active");
}

async function recordCall(row: {
  workspace_id: string;
  account_id: string;
  user_id: string | null;
  app: string;
  tool: string;
  is_write: boolean;
  ok: boolean;
  error_code: string | null;
  duration_ms: number;
  log_id: string | null;
  purpose: string;
  approval_ref: string | null;
}): Promise<void> {
  const { error } = await db.from("integration_tool_calls").insert(row);
  if (error) console.error("[integrations] call not recorded", row.tool, error.message);
}

/**
 * Put a file in Composio's store for one allow-listed tool of one account, so
 * the tool can take it as `{ name, mimetype, s3key }`. Same account checks as
 * running the tool; the tool itself still goes through runIntegrationTool.
 */
export async function stageIntegrationFile(args: {
  workspaceId: string;
  accountId: string;
  tool: string;
  name: string;
  mimetype: string;
  bytes: Uint8Array;
}): Promise<ComposioFile> {
  if (!isIntegrationsEnabled(args.workspaceId)) throw new HttpError(404, "Not found");
  const account = await loadAccount(args.workspaceId, args.accountId);
  if (account.status !== "active") {
    throw new HttpError(409, "This app needs connecting again before Mellox can use it.");
  }
  const app = integrationApp(account.app);
  if (!app || !allowedTool(app, args.tool)) {
    throw new HttpError(403, "Mellox doesn't use that action for this app.");
  }
  return uploadFile({
    toolkit: account.toolkit,
    tool: args.tool,
    name: args.name,
    mimetype: args.mimetype,
    bytes: args.bytes,
  });
}

export type RunProxyArgs = {
  workspaceId: string;
  accountId: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** The app's own API path, e.g. "/designs/abc". Checked against the catalog. */
  endpoint: string;
  body?: Record<string, unknown>;
  binary?: { base64: string; contentType: string };
  headers?: Record<string, string>;
  caller: ToolCaller;
  purpose: string;
  approvalRef?: string | null;
  timeoutMs?: number;
};

/**
 * Call an app's own API through Composio (for apps whose API Mellox already
 * speaks, like Canva). Same guard as a tool: account, allow-listed endpoint,
 * role, approval for writes, rate limit, call log and audit.
 */
export async function runIntegrationProxy(args: RunProxyArgs): Promise<ProxyResult> {
  if (!isIntegrationsEnabled(args.workspaceId)) throw new HttpError(404, "Not found");

  const account = await loadAccount(args.workspaceId, args.accountId);
  if (account.status !== "active") {
    throw new HttpError(409, "This app needs connecting again before Mellox can use it.");
  }
  const app = integrationApp(account.app);
  const rule = app ? allowedProxy(app, args.method, args.endpoint) : null;
  if (!app || !rule) {
    throw new HttpError(403, "Mellox doesn't use that action for this app.");
  }
  if (args.caller.kind === "person" && !roleAllows(args.caller.role, rule.minRole)) {
    throw new HttpError(403, "Your role can't do that in this workspace.");
  }
  if (rule.write && !args.approvalRef) {
    throw new HttpError(403, "This change needs approval first.");
  }

  const tier = rule.write ? "integration-write" : "integration-read";
  const limit = await consumeRateLimit(tier, `ws:${args.workspaceId}`);
  if (!limit.ok) throw new RateLimitedError(tier, limit);

  const userId =
    args.caller.kind === "person" ? args.caller.userId : (args.caller.actingUserId ?? null);
  const label = `${args.method} ${rule.label}`;
  const startedAt = Date.now();
  let errorCode: string | null = null;
  try {
    const result = await proxyRequest({
      userId: composioUserId(args.workspaceId),
      connectedAccountId: account.composio_account_id,
      method: args.method,
      endpoint: args.endpoint,
      body: args.body,
      binary: args.binary,
      headers: args.headers,
      write: rule.write,
      timeoutMs: args.timeoutMs,
    });
    if (result.status === 401) {
      errorCode = "account_auth";
      await markReconnect(account.id, `${app.name} refused the connection (401).`);
    } else if (result.status < 200 || result.status >= 300) {
      errorCode = `http_${result.status}`;
    }
    return result;
  } catch (error) {
    errorCode = error instanceof ComposioGatewayError ? error.kind : "error";
    if (error instanceof ComposioGatewayError && error.kind === "account_auth") {
      await markReconnect(account.id, error.detail);
    }
    throw error;
  } finally {
    await recordCall({
      workspace_id: args.workspaceId,
      account_id: account.id,
      user_id: userId,
      app: account.app,
      tool: label.slice(0, 120),
      is_write: rule.write,
      ok: errorCode === null,
      error_code: errorCode,
      duration_ms: Date.now() - startedAt,
      log_id: null,
      purpose: args.purpose.slice(0, 40),
      approval_ref: args.approvalRef ?? null,
    });
    if (rule.write) {
      await recordAudit({
        workspaceId: args.workspaceId,
        userId,
        action: `integrations.${account.app}.proxy`,
        entity: account.id,
        payload: {
          endpoint: label,
          purpose: args.purpose,
          approvalRef: args.approvalRef ?? null,
          ok: errorCode === null,
          errorCode,
        },
      });
    }
  }
}

export async function runIntegrationTool(args: RunToolArgs): Promise<ComposioExecution> {
  if (!isIntegrationsEnabled(args.workspaceId)) throw new HttpError(404, "Not found");

  const account = await loadAccount(args.workspaceId, args.accountId);
  if (account.status !== "active") {
    throw new HttpError(409, "This app needs connecting again before Mellox can use it.");
  }
  const app = integrationApp(account.app);
  const rule = app ? allowedTool(app, args.tool) : null;
  if (!app || !rule) {
    throw new HttpError(403, "Mellox doesn't use that action for this app.");
  }
  if (args.caller.kind === "person" && !roleAllows(args.caller.role, rule.minRole)) {
    throw new HttpError(403, "Your role can't do that in this workspace.");
  }
  if (rule.write && !args.approvalRef) {
    throw new HttpError(403, "This change needs approval first.");
  }

  const tier = rule.write ? "integration-write" : "integration-read";
  const limit = await consumeRateLimit(tier, `ws:${args.workspaceId}`);
  if (!limit.ok) throw new RateLimitedError(tier, limit);

  const userId =
    args.caller.kind === "person" ? args.caller.userId : (args.caller.actingUserId ?? null);
  const startedAt = Date.now();
  let execution: ComposioExecution | null = null;
  let errorCode: string | null = null;
  try {
    execution = await executeTool({
      tool: rule.slug,
      userId: composioUserId(args.workspaceId),
      connectedAccountId: account.composio_account_id,
      arguments: args.arguments,
      write: rule.write,
      timeoutMs: args.timeoutMs,
    });
    if (!execution.successful) errorCode = "provider_error";
    return execution;
  } catch (error) {
    errorCode = error instanceof ComposioGatewayError ? error.kind : "error";
    if (error instanceof ComposioGatewayError && error.kind === "account_auth") {
      await markReconnect(account.id, error.detail);
    }
    throw error;
  } finally {
    await recordCall({
      workspace_id: args.workspaceId,
      account_id: account.id,
      user_id: userId,
      app: account.app,
      tool: rule.slug,
      is_write: rule.write,
      ok: errorCode === null,
      error_code: errorCode,
      duration_ms: Date.now() - startedAt,
      log_id: execution?.logId ?? null,
      purpose: args.purpose.slice(0, 40),
      approval_ref: args.approvalRef ?? null,
    });
    if (rule.write) {
      await recordAudit({
        workspaceId: args.workspaceId,
        userId,
        action: `integrations.${account.app}.${rule.slug.toLowerCase()}`,
        entity: account.id,
        payload: {
          purpose: args.purpose,
          approvalRef: args.approvalRef ?? null,
          ok: errorCode === null,
          errorCode,
        },
      });
    }
  }
}
