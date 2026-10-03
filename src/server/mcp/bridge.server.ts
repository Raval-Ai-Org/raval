// How an MCP tool reaches Mellox: by calling the SAME server function or /api
// route the app calls, in-process, as the same member. Each one runs its own
// authentication, role check, rate limit, plan and credit checks exactly as it
// does for the browser, so a tool can never do more than its caller could do
// in the app. Nothing here touches the database or a provider directly.
import "server-only";
import { markMcpRequest } from "@/server/api-auth";
import { getAppUrl } from "@/server/env";
import { resolveServerFn } from "@/server/fns";
import { runWithRequest } from "@/server/request-context";
import type { McpCaller } from "./access.server";
import { McpError, type McpErrorCode } from "./errors.server";

function internalRequest(
  caller: McpCaller,
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown } = {},
): Request {
  const headers = new Headers({ authorization: `Bearer ${caller.token}` });
  let body: string | undefined;
  if (init.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.body);
  }
  return markMcpRequest(
    new Request(`${getAppUrl()}${path}`, { method: init.method ?? "POST", headers, body }),
  );
}

/** Call a registered server function (`src/server/fns/<module>.ts`). */
export async function callFn<T = unknown>(
  caller: McpCaller,
  moduleName: string,
  fnName: string,
  data?: unknown,
): Promise<T> {
  const fn = resolveServerFn(moduleName, fnName);
  if (!fn) throw new McpError("internal_error", "That action isn't available.");
  const request = internalRequest(caller, `/api/rpc/${moduleName}/${fnName}`);
  return runWithRequest(request, () => fn.invoke(data)) as Promise<T>;
}

type RouteHandler = (request: Request) => Promise<Response>;

const STATUS_CODE: Record<number, McpErrorCode> = {
  400: "invalid_input",
  401: "unauthenticated",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  429: "rate_limited",
  503: "unavailable",
};

const BILLING_CODES = new Set([
  "upgrade_required",
  "insufficient_balance",
  "limit_reached",
  "spend_not_allowed",
  "brand_frozen",
]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function routeError(status: number, raw: unknown): McpError {
  const body = record(raw);
  const nested = record(body.error);
  const message =
    [body.message, nested.detail, nested.message, body.error, body.detail].find(
      (v): v is string => typeof v === "string" && v.length > 0,
    ) ?? "That didn't work. Please try again.";
  if (status === 402 && typeof body.code === "string" && BILLING_CODES.has(body.code)) {
    const { code, message: _message, ...details } = body;
    return new McpError(code as McpErrorCode, message, details);
  }
  const code = STATUS_CODE[status] ?? (status >= 500 ? "upstream_error" : "invalid_input");
  return new McpError(code, message);
}

/** Call an /api route handler (one exported by `defineRoute`). */
export async function callRoute<T = unknown>(
  caller: McpCaller,
  handler: RouteHandler,
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown; query?: Record<string, string> } = {},
): Promise<T> {
  const search = init.query ? `?${new URLSearchParams(init.query).toString()}` : "";
  const response = await handler(
    internalRequest(caller, `${path}${search}`, { method: init.method, body: init.body }),
  );
  const body = await response.json().catch(() => null);
  if (!response.ok) throw routeError(response.status, body);
  return body as T;
}
