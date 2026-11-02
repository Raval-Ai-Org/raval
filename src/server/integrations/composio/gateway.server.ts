// gateway.server.ts — the only file that reads COMPOSIO_API_KEY or talks to
// Composio (ADR-0042). Composio holds every connected app's tokens and
// refreshes them; Mellox keeps only Composio's account ids.
//
// Everything else goes through src/server/integrations/: accounts.server.ts
// for connecting, and execute.server.ts — the guard — for running a tool. A
// caller never reaches this file to run a tool directly.
//
// Two rules shape the transport:
//   * Reads retry on 429/5xx and transport failures; writes never do. A write
//     whose outcome is unknown (timeout, dropped connection) is reported as
//     `unknown_outcome`, and the caller resolves it by reading, never by
//     sending again.
//   * Composio is a supplier a person never chose, so it is never named to
//     them (`internal: true`); the wording stays in logs.
//
// The key travels in the `x-api-key` header only: never a URL, a log or a
// response.
import "server-only";
import { UpstreamError, fetchWithRetry } from "@/server/upstream";

export type ComposioErrorCode =
  | "missing_config"
  /** Composio refused Mellox's own key. */
  | "auth"
  /** The person's connection no longer works; they need to reconnect. */
  | "account_auth"
  | "rate_limited"
  | "not_found"
  | "invalid_request"
  /** A write may or may not have happened. Never retry it; read to find out. */
  | "unknown_outcome"
  | "timeout"
  | "provider_error";

export class ComposioGatewayError extends UpstreamError {
  constructor(status: number, message: string, code: ComposioErrorCode) {
    super(status, message, { provider: "composio", code, internal: true });
    this.name = "ComposioGatewayError";
  }
  get kind(): ComposioErrorCode {
    return this.code as ComposioErrorCode;
  }
}

export type ComposioAccountStatus =
  "INITIALIZING" | "INITIATED" | "ACTIVE" | "FAILED" | "EXPIRED" | "INACTIVE" | (string & {});

export type ComposioAccount = {
  id: string;
  status: ComposioAccountStatus;
  statusReason: string | null;
  toolkit: string;
  authConfigId: string;
  isDisabled: boolean;
  /** Deprecated by Composio but still returned; checked when present. */
  userId: string | null;
  /** Short readable id Composio gives an account, e.g. "instagram_frost". */
  wordId: string | null;
  alias: string | null;
};

export type ComposioLink = {
  redirectUrl: string;
  connectedAccountId: string;
  authConfigId: string;
  expiresAt: string | null;
};

export type ComposioExecution = {
  successful: boolean;
  data: Record<string, unknown>;
  error: string | null;
  logId: string | null;
};

const DEFAULT_BASE_URL = "https://backend.composio.dev/api/v3.1";
const READ_TIMEOUT_MS = 20_000;
// Uploads and publishing (video especially) can take a while at the provider.
const WRITE_TIMEOUT_MS = 90_000;

export function composioConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.COMPOSIO_API_KEY?.trim());
}

function baseUrl(): string {
  return (process.env.COMPOSIO_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function requireKey(): string {
  const key = process.env.COMPOSIO_API_KEY?.trim();
  if (!key) {
    throw new ComposioGatewayError(
      503,
      "Connected apps are not configured on the server. Set COMPOSIO_API_KEY.",
      "missing_config",
    );
  }
  return key;
}

// ── Transport ─────────────────────────────────────────────────────────────

export type ComposioRequest = {
  method: "GET" | "POST" | "DELETE";
  path: string;
  query?: Record<string, string | string[] | undefined>;
  body?: Record<string, unknown>;
  /** Changes something. Never retried; an unclear outcome is `unknown_outcome`. */
  write: boolean;
  timeoutMs?: number;
};

/** The narrow slice of HTTP this gateway uses — tests inject a fake. */
export type ComposioTransport = (
  req: ComposioRequest,
) => Promise<{ status: number; json: unknown }>;

let transportOverride: ComposioTransport | null = null;

/** Tests inject a fake transport instead of calling Composio. Pass null to reset. */
export function setComposioTransport(next: ComposioTransport | null): void {
  transportOverride = next;
}

function urlFor(req: ComposioRequest): string {
  const url = new URL(`${baseUrl()}${req.path}`);
  for (const [key, value] of Object.entries(req.query ?? {})) {
    if (value === undefined) continue;
    url.searchParams.set(key, Array.isArray(value) ? value.join(",") : value);
  }
  return url.toString();
}

const httpTransport: ComposioTransport = async (req) => {
  const key = requireKey();
  const timeoutMs = req.timeoutMs ?? (req.write ? WRITE_TIMEOUT_MS : READ_TIMEOUT_MS);
  const res = await fetchWithRetry(
    urlFor(req),
    {
      method: req.method,
      headers: {
        "x-api-key": key,
        ...(req.body ? { "Content-Type": "application/json" } : {}),
      },
      body: req.body ? JSON.stringify(req.body) : undefined,
    },
    {
      timeoutMs,
      retries: req.write ? 0 : 2,
      retryOnTimeout: !req.write,
      retryableStatuses: [429, 500, 502, 503, 504],
      onTransportError: ({ kind, detail }) =>
        req.write
          ? new ComposioGatewayError(
              504,
              `Composio ${req.method} ${req.path} ${kind}: ${detail}; the outcome is unknown`,
              "unknown_outcome",
            )
          : new ComposioGatewayError(
              kind === "timeout" ? 504 : 502,
              `Composio ${req.method} ${req.path} ${kind}: ${detail}`,
              kind === "timeout" ? "timeout" : "provider_error",
            ),
    },
  );
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
};

function transport(): ComposioTransport {
  return transportOverride ?? httpTransport;
}

type ErrorBody = { error?: { message?: string; slug?: string; code?: number } };

// Wording Composio and the apps behind it use when a connection's grant is gone.
const ACCOUNT_AUTH =
  /ConnectedAccount(?:_|\s)?(?:Expired|Inactive|Disabled|NotActive)|token (?:has )?expired|invalid_grant|revoked|re-?auth|reconnect|unauthori[sz]ed|\b401\b/i;

/** Map a non-2xx Composio response to one of our error codes. Pure; exported for tests. */
export function classifyFailure(
  status: number,
  body: unknown,
  write: boolean,
): ComposioGatewayError {
  const err = (body as ErrorBody | null)?.error;
  const detail =
    `${err?.slug ?? ""} ${err?.message ?? ""}`.trim().slice(0, 300) || `HTTP ${status}`;
  if (status === 401 && /APIKey/i.test(err?.slug ?? "")) {
    return new ComposioGatewayError(503, `Composio rejected Mellox's key: ${detail}`, "auth");
  }
  if (ACCOUNT_AUTH.test(detail) || status === 401 || status === 403) {
    return new ComposioGatewayError(
      409,
      `Connection needs signing in again: ${detail}`,
      "account_auth",
    );
  }
  if (status === 404) return new ComposioGatewayError(404, `Not found: ${detail}`, "not_found");
  if (status === 429)
    return new ComposioGatewayError(429, `Rate limited: ${detail}`, "rate_limited");
  if (status === 400 || status === 422) {
    return new ComposioGatewayError(400, `Request refused: ${detail}`, "invalid_request");
  }
  // A 5xx on a write may still have reached the app.
  if (write && status >= 500) {
    return new ComposioGatewayError(
      502,
      `Outcome unknown (${status}): ${detail}`,
      "unknown_outcome",
    );
  }
  return new ComposioGatewayError(502, `Composio failed (${status}): ${detail}`, "provider_error");
}

async function call<T>(req: ComposioRequest): Promise<T> {
  const { status, json } = await transport()(req);
  if (status < 200 || status >= 300) throw classifyFailure(status, json, req.write);
  return json as T;
}

// ── Mapping ───────────────────────────────────────────────────────────────

type RawAccount = {
  id?: string;
  nanoid?: string;
  status?: string;
  status_reason?: string | null;
  toolkit?: { slug?: string };
  auth_config?: { id?: string };
  is_disabled?: boolean;
  user_id?: string | null;
  word_id?: string | null;
  alias?: string | null;
};

export function toAccount(raw: RawAccount): ComposioAccount {
  return {
    id: String(raw.id ?? raw.nanoid ?? ""),
    status: (raw.status ?? "FAILED").toUpperCase(),
    statusReason: raw.status_reason ?? null,
    toolkit: String(raw.toolkit?.slug ?? "").toLowerCase(),
    authConfigId: String(raw.auth_config?.id ?? ""),
    isDisabled: Boolean(raw.is_disabled),
    userId: raw.user_id ?? null,
    wordId: raw.word_id ?? null,
    alias: raw.alias ?? null,
  };
}

// ── Auth configs ──────────────────────────────────────────────────────────
//
// One auth config per toolkit. `COMPOSIO_AUTH_CONFIG_<TOOLKIT>` names Mellox's
// own OAuth app when there is one; otherwise Composio's managed sign-in is
// found (or made once). Moving a toolkit to Mellox's own app is a config
// change only; existing connections keep their own auth config id.

const authConfigCache = new Map<string, string>();

function envAuthConfig(toolkit: string): string | null {
  const value = process.env[`COMPOSIO_AUTH_CONFIG_${toolkit.toUpperCase()}`]?.trim();
  return value || null;
}

type RawAuthConfig = { id?: string; toolkit?: { slug?: string }; is_composio_managed?: boolean };

export async function authConfigFor(toolkit: string): Promise<string> {
  const pinned = envAuthConfig(toolkit);
  if (pinned) return pinned;
  const cached = authConfigCache.get(toolkit);
  if (cached) return cached;
  const list = await call<{ items?: RawAuthConfig[] }>({
    method: "GET",
    path: "/auth_configs",
    query: { toolkit_slug: toolkit, limit: "50" },
    write: false,
  });
  const managed = (list.items ?? []).find(
    (item) => item.is_composio_managed && item.toolkit?.slug?.toLowerCase() === toolkit && item.id,
  );
  let id = managed?.id ?? null;
  if (!id) {
    const created = await call<{ auth_config?: { id?: string } }>({
      method: "POST",
      path: "/auth_configs",
      body: { toolkit: { slug: toolkit }, auth_config: { type: "use_composio_managed_auth" } },
      write: true,
    });
    id = created.auth_config?.id ?? null;
  }
  if (!id) throw new ComposioGatewayError(502, `No auth config for ${toolkit}`, "provider_error");
  authConfigCache.set(toolkit, id);
  return id;
}

// ── Connected accounts ────────────────────────────────────────────────────

export async function createLink(args: {
  toolkit: string;
  userId: string;
  callbackUrl: string;
}): Promise<ComposioLink> {
  const authConfigId = await authConfigFor(args.toolkit);
  const res = await call<{
    redirect_url?: string;
    connected_account_id?: string;
    expires_at?: string;
  }>({
    method: "POST",
    path: "/connected_accounts/link",
    body: { auth_config_id: authConfigId, user_id: args.userId, callback_url: args.callbackUrl },
    // Making a link changes nothing the person has; safe to treat as a read for retries.
    write: false,
  });
  if (!res.redirect_url || !res.connected_account_id) {
    throw new ComposioGatewayError(502, "Composio returned no sign-in link", "provider_error");
  }
  return {
    redirectUrl: res.redirect_url,
    connectedAccountId: res.connected_account_id,
    authConfigId,
    expiresAt: res.expires_at ?? null,
  };
}

export async function getAccount(id: string): Promise<ComposioAccount> {
  return toAccount(
    await call<RawAccount>({
      method: "GET",
      path: `/connected_accounts/${encodeURIComponent(id)}`,
      write: false,
    }),
  );
}

/** Every account Composio holds for one Composio user (one Mellox workspace). */
export async function listAccounts(userId: string): Promise<ComposioAccount[]> {
  const accounts: ComposioAccount[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page++) {
    const res = await call<{ items?: RawAccount[]; next_cursor?: string | null }>({
      method: "GET",
      path: "/connected_accounts",
      query: { user_ids: userId, limit: "100", cursor },
      write: false,
    });
    accounts.push(...(res.items ?? []).map(toAccount));
    cursor = res.next_cursor ?? undefined;
    if (!cursor) break;
  }
  return accounts;
}

/** Remove the account at Composio. A missing account counts as removed. */
export async function deleteAccount(id: string): Promise<void> {
  try {
    await call({
      method: "DELETE",
      path: `/connected_accounts/${encodeURIComponent(id)}`,
      write: true,
    });
  } catch (error) {
    if (error instanceof ComposioGatewayError && error.kind === "not_found") return;
    throw error;
  }
}

// ── Tools ─────────────────────────────────────────────────────────────────

/** Run one tool for one connected account. Only execute.server.ts calls this. */
export async function executeTool(args: {
  tool: string;
  userId: string;
  connectedAccountId: string;
  arguments: Record<string, unknown>;
  write: boolean;
  version?: string;
  timeoutMs?: number;
}): Promise<ComposioExecution> {
  const res = await call<{
    successful?: boolean;
    data?: Record<string, unknown>;
    error?: string | null;
    log_id?: string;
  }>({
    method: "POST",
    path: `/tools/execute/${encodeURIComponent(args.tool)}`,
    body: {
      user_id: args.userId,
      connected_account_id: args.connectedAccountId,
      arguments: args.arguments,
      version: args.version ?? process.env.COMPOSIO_TOOLKIT_VERSION?.trim() ?? "latest",
    },
    write: args.write,
    timeoutMs: args.timeoutMs,
  });
  const execution: ComposioExecution = {
    successful: res.successful === true,
    data: res.data ?? {},
    error: res.error ?? null,
    logId: res.log_id ?? null,
  };
  if (!execution.successful && execution.error && ACCOUNT_AUTH.test(execution.error)) {
    throw new ComposioGatewayError(
      409,
      `Connection needs signing in again: ${execution.error.slice(0, 300)}`,
      "account_auth",
    );
  }
  return execution;
}
