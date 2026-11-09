import { supabase } from "@/integrations/supabase/client";
import { workspaceIdFromPath } from "@/lib/workspace/paths";
import { emitAppEvent } from "@/lib/app-events";

// Authenticated fetch for our /api/* server routes.
// Attaches the Supabase access token as a Bearer header, and the workspace as
// `x-workspace-id` so the server can attribute AI spend to it for metering and
// plan budgets. The server only honours that header after verifying the
// caller is a member (src/server/route.ts) — it is attribution, never
// authorization. Routes that act on workspace data take the id in their input
// and verify it (defineRoute auth: "workspace" / requireWorkspaceRole).

/**
 * The workspace of the page the user is on, read from the canonical URL
 * (/w/<id>/...) at the moment of the call. There is no cached or stored
 * "active workspace": a request captures the id when it starts, so switching
 * workspaces mid-request can never re-point it.
 */
export function getActiveWorkspaceId(): string | null {
  if (typeof window === "undefined") return null;
  return workspaceIdFromPath(window.location.pathname);
}

export type AuthedFetchInit = RequestInit & {
  /** The workspace this request acts for; defaults to the current page's. */
  workspaceId?: string | null;
  /**
   * The caller shows its own upgrade option for a 402 (the chat does, inline),
   * so the global "Upgrade / Get credits" toast is skipped.
   */
  billingInline?: boolean;
  /**
   * Background work that should never crowd out what the person is doing:
   * `ai` for slow model calls nobody is waiting on (idea suggestions), `poll`
   * for status checks. Each lane runs only a few requests at a time (see
   * LANE_LIMIT), so opening a page or a window always finds a free connection.
   */
  lane?: FetchLane;
};

export type FetchLane = "ai" | "poll";

/**
 * Browsers open at most six connections per site over HTTP/1.1. Background
 * lanes together use at most three, leaving the rest for navigation and
 * whatever the person just pressed.
 */
const LANE_LIMIT: Record<FetchLane, number> = { ai: 1, poll: 2 };
const laneRunning: Record<FetchLane, number> = { ai: 0, poll: 0 };
const laneWaiting: Record<FetchLane, Array<() => void>> = { ai: [], poll: [] };

function abortError(signal: AbortSignal) {
  return signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}

/** Run `task` once its lane has room; a slot passes straight to the next waiter. */
async function inLane<T>(
  lane: FetchLane | undefined,
  signal: AbortSignal | null | undefined,
  task: () => Promise<T>,
): Promise<T> {
  if (!lane) return task();
  if (signal?.aborted) throw abortError(signal);
  if (laneRunning[lane] < LANE_LIMIT[lane]) {
    laneRunning[lane] += 1;
  } else {
    // Wait for a slot; the finishing request hands its slot over.
    await new Promise<void>((resolve, reject) => {
      const go = () => {
        signal?.removeEventListener("abort", stop);
        resolve();
      };
      const stop = () => {
        const i = laneWaiting[lane].indexOf(go);
        if (i >= 0) laneWaiting[lane].splice(i, 1);
        reject(abortError(signal!));
      };
      laneWaiting[lane].push(go);
      signal?.addEventListener("abort", stop, { once: true });
    });
  }
  try {
    return await task();
  } finally {
    const next = laneWaiting[lane].shift();
    if (next) next();
    else laneRunning[lane] -= 1;
  }
}

/**
 * Identical GET requests already on their way share one network request.
 * A browser keeps only six connections per site open over HTTP/1.1; several
 * places asking for the same job, balance or library at once used to fill
 * them while a piece was being made, and every other request (opening a
 * page, a window's data) then waited in the queue: the app looked frozen.
 * Each caller gets its own copy of the response.
 */
const inflight = new Map<string, Promise<Response>>();

function sharedFetch(
  input: RequestInfo | URL,
  init: RequestInit,
  headers: Headers,
  lane?: FetchLane,
) {
  const send = () => inLane(lane, init.signal, () => fetch(input, { ...init, headers }));
  const method = (init.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (method !== "GET" || init.body || init.signal || input instanceof Request) {
    return send();
  }
  const url = input instanceof URL ? input.href : String(input);
  const key = `${url}\n${[...headers.entries()]
    .map(([k, v]) => `${k}:${v}`)
    .sort()
    .join("\n")}\n${init.cache ?? ""}\n${init.credentials ?? ""}`;
  let request = inflight.get(key);
  if (!request) {
    request = send();
    inflight.set(key, request);
    const forget = () => {
      if (inflight.get(key) === request) inflight.delete(key);
    };
    request.then(forget, forget);
  }
  return request.then((response) => response.clone());
}

export async function authedFetch(input: RequestInfo | URL, init: AuthedFetchInit = {}) {
  const { workspaceId: explicit, billingInline, lane, ...rest } = init;
  // Captured before the first await so a navigation during token refresh
  // cannot change which workspace this request is attributed to.
  const workspaceId = explicit !== undefined ? explicit : getActiveWorkspaceId();
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const token = data.session?.access_token;
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  new Headers(rest.headers).forEach((value, key) => headers.set(key, value));
  if (token && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${token}`);
  }
  if (workspaceId && !headers.has("x-workspace-id")) {
    headers.set("x-workspace-id", workspaceId);
  }
  const response = await sharedFetch(input, rest, headers, lane);
  // Credits were set aside, charged or returned: refresh the balance now.
  const balance = response.headers.get("X-Billing-Balance");
  if (
    balance !== null &&
    balance.trim() &&
    Number.isSafeInteger(Number(balance)) &&
    Number(balance) >= 0
  ) {
    emitAppEvent("billing:changed", { balance: Number(balance) });
  } else if (response.headers.get("X-Billing-Changed")) emitAppEvent("billing:changed");
  if (response.status === 402) {
    const payload = await response
      .clone()
      .json()
      .catch(() => null);
    if (payload && typeof payload.code === "string") {
      if (billingInline) emitAppEvent("billing:changed");
      else emitAppEvent("billing:blocked", payload);
    }
  }
  return response;
}
