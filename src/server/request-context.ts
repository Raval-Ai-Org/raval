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
  /**
   * The product workflow this work belongs to (a Studio job, a UGC render…),
   * so every provider call can be added up per piece made. See withWorkflow.
   */
  workflowKind?: WorkflowKind;
  workflowId?: string;
  /** Stage inside the workflow (e.g. "writing", "image", "poll"). */
  workflowStage?: string;
  /** Owner wallet used by the current paid action. */
  billingAccountId?: string;
  /** Preallocated charge id, shared by provider usage rows and the capture. */
  billingChargeId?: string;
  billingMeter?: import("@/lib/billing/catalog").Meter;
  /** Correlation id echoed in logs. */
  requestId?: string;
  /** Soft-limit notice set by the budget module; the /api kernel returns it as X-Usage-Warning. */
  usageWarning?: string;
  /** A wallet balance moved in this request; responses carry X-Billing-Changed. */
  billingChanged?: boolean;
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

/** Workflows whose provider spend is added up per row (`ai_usage_events.workflow_*`). */
export type WorkflowKind = "studio_job" | "ugc_render" | "brand_scan" | "market_brain";

/**
 * Run `fn` as part of one workflow: every usage row recorded inside carries
 * the workflow's kind, id and stage. Keeps the caller's request id, user and
 * billing scope; a nested call only changes what it names (a stage inside a
 * job keeps the job). `workspaceId` is set only when the caller passes one it
 * read from the workflow's own row.
 */
export function withWorkflow<T>(
  workflow: { kind: WorkflowKind; id: string; stage?: string; workspaceId?: string },
  fn: () => T,
): T {
  const parent = storage.getStore();
  return storage.run(
    {
      ...parent,
      requestId: parent?.requestId ?? newRequestId(),
      workflowKind: workflow.kind,
      workflowId: workflow.id,
      workflowStage: workflow.stage ?? parent?.workflowStage,
      ...(workflow.workspaceId ? { workspaceId: workflow.workspaceId } : {}),
    },
    fn,
  );
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
