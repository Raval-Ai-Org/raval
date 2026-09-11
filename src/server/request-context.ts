import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

// Ambient request scope. Route handlers (the /api kernel and /api/rpc) open the
// scope once per request so middleware and deep server code — the AI gateways'
// usage metering, guardrail event logging, the agent runtime — can read who is
// calling and on whose workspace's behalf, without every function threading
// those values through its signature.
//
// `workspaceId` is only ever set after membership was verified server-side
// (never straight from a header), so anything attributed to it — spend,
// guardrail events, agent runs — belongs to a workspace the caller is in.
export type RequestScope = {
  request?: Request;
  userId?: string;
  workspaceId?: string;
  /** Logical route/function name, e.g. "chat" or "content/generateContentBatch". */
  route?: string;
  /** Agent run this work belongs to, when executed by the agent runtime. */
  runId?: string;
  /** Correlation id echoed in logs. */
  requestId?: string;
  /** Soft-limit notice set by the budget module; the /api kernel returns it as X-Usage-Warning. */
  usageWarning?: string;
};

const storage = new AsyncLocalStorage<RequestScope>();

export function runWithRequest<T>(request: Request, fn: () => T): T {
  return storage.run({ request, requestId: newRequestId(request) }, fn);
}

/** Open a scope without a Request (cron jobs, workers, tests). */
export function runWithScope<T>(scope: RequestScope, fn: () => T): T {
  const parent = storage.getStore();
  return storage.run({ ...parent, requestId: newRequestId(), ...scope }, fn);
}

/** Merge values into the current scope (no-op outside a scope). */
export function setRequestScope(patch: Partial<RequestScope>): void {
  const store = storage.getStore();
  if (store) Object.assign(store, patch);
}

export function getRequestScope(): RequestScope {
  return storage.getStore() ?? {};
}

export function getRequest(): Request {
  const store = storage.getStore();
  if (!store?.request) {
    throw new Error("getRequest() called outside of a request scope");
  }
  return store.request;
}

export function tryGetRequest(): Request | undefined {
  return storage.getStore()?.request;
}

function newRequestId(request?: Request): string {
  const incoming = request?.headers.get("x-request-id");
  if (incoming && /^[A-Za-z0-9._-]{8,64}$/.test(incoming)) return incoming;
  return globalThis.crypto.randomUUID();
}
