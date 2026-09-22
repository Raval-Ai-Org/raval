// client.server.ts — the shared DataForSEO transport.
//
// Every DataForSEO module (Google Trends, Backlinks) goes through `dataForSeoPost`
// / `dataForSeoGet`: HTTP Basic from the server-only env vars, a hard request
// timeout, and the envelope check DataForSEO needs because it reports failures
// inside an HTTP 200 body (`status_code` 20000 is the only success).
//
// The host is a fixed constant, never user input, so this uses plain `fetch`
// rather than the SSRF-guarded `safeFetch` (which is GET/HEAD only anyway).
// User-supplied domains are validated with `assertPublicUrl` by the callers
// before they reach a request body.
import "server-only";

export const DATAFORSEO_BASE_URL = "https://api.dataforseo.com/v3/";
export const DATAFORSEO_TIMEOUT_MS = 15_000;

export class DataForSeoError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: number,
    /** Transport-level failure (timeout, network, HTTP 429/5xx) worth retrying later. */
    public readonly transient = false,
  ) {
    super(message);
    this.name = "DataForSeoError";
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** True when both credentials are present. Used for "is this feature available" checks. */
export function dataForSeoConfigured(): boolean {
  return Boolean(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD);
}

export function dataForSeoCredentials(): { login: string; password: string } {
  const login = process.env.DATAFORSEO_LOGIN;
  const password = process.env.DATAFORSEO_PASSWORD;
  if (!login || !password) throw new DataForSeoError("DataForSEO is not configured", 503);
  return { login, password };
}

/**
 * Raw request. Returns the parsed JSON body without interpreting it — callers
 * decide whether to run the envelope check (task_post reports a real cost even
 * when the envelope is rejected, so metering happens before assertion).
 */
export async function dataForSeoRequest(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = DATAFORSEO_TIMEOUT_MS,
): Promise<unknown> {
  const { login, password } = dataForSeoCredentials();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      ...init,
      headers: {
        Authorization: `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message = isRecord(payload) ? stringValue(payload.status_message) : undefined;
      throw new DataForSeoError(
        `DataForSEO request failed (HTTP ${response.status}${message ? `: ${message}` : ""})`,
        // 401/402 are configuration problems, not upstream flakiness: surfacing
        // them as-is lets the runner fail fast instead of burning retries.
        response.status === 401 || response.status === 402 ? response.status : 502,
        response.status,
        response.status === 429 || response.status >= 500,
      );
    }
    return payload;
  } catch (error) {
    if (error instanceof DataForSeoError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new DataForSeoError("DataForSEO request timed out", 504, undefined, true);
    }
    throw new DataForSeoError("Unable to reach DataForSEO", 502, undefined, true);
  } finally {
    clearTimeout(timer);
  }
}

export type DataForSeoEnvelope = {
  /** USD charged for this call, as reported by DataForSEO. Authoritative. */
  cost: number;
  statusCode: number;
  statusMessage?: string;
  tasks: unknown[];
  /** tasks[0], already narrowed. */
  task: Record<string, unknown>;
  taskStatusCode: number;
  taskStatusMessage?: string;
};

/**
 * Envelope + task status check. DataForSEO signals failure inside HTTP 200, so
 * this is the real error boundary.
 *
 * Task status codes that are NOT failures:
 *   20000 — ok
 *   40102 — "No Search Results": a finished task with nothing to report, which
 *           is what a domain with no backlinks looks like, not an error.
 * 40501 ("Invalid Field") IS a failure — it means we sent a bad parameter.
 */
export function readEnvelope(payload: unknown, context: string): DataForSeoEnvelope {
  if (!isRecord(payload)) {
    throw new DataForSeoError(`DataForSEO returned an unexpected ${context} response`, 502);
  }
  const statusCode = numberValue(payload.status_code) ?? 0;
  const statusMessage = stringValue(payload.status_message);
  const cost = numberValue(payload.cost) ?? 0;
  if (statusCode !== 20000) {
    throw new DataForSeoError(
      `DataForSEO ${context} failed: ${statusMessage ?? "request rejected"}`,
      // 40100-family = auth, 402xx = balance. Both are permanent for this run.
      statusCode >= 40100 && statusCode < 40200 ? 401 : statusCode === 40200 ? 402 : 502,
      statusCode,
    );
  }
  if (!Array.isArray(payload.tasks) || payload.tasks.length === 0) {
    throw new DataForSeoError(`DataForSEO returned no task in the ${context} response`, 502);
  }
  const task = payload.tasks[0];
  if (!isRecord(task)) {
    throw new DataForSeoError(`DataForSEO returned an invalid ${context} task`, 502);
  }
  const taskStatusCode = numberValue(task.status_code) ?? 0;
  const taskStatusMessage = stringValue(task.status_message);
  if (taskStatusCode !== 20000 && taskStatusCode !== 40102) {
    throw new DataForSeoError(
      `DataForSEO ${context} failed: ${taskStatusMessage ?? "task rejected"}`,
      taskStatusCode >= 40100 && taskStatusCode < 40200 ? 401 : 502,
      taskStatusCode,
      // 5xxxx are provider-side internal errors; worth one more attempt.
      taskStatusCode >= 50000,
    );
  }
  return {
    cost,
    statusCode,
    statusMessage,
    tasks: payload.tasks,
    task,
    taskStatusCode,
    taskStatusMessage,
  };
}

/** POST one task array to `/v3/<path>` and read the envelope. */
export async function dataForSeoPost(
  call: { path: string; body: unknown[]; timeoutMs?: number },
  fetchImpl: typeof fetch = fetch,
): Promise<DataForSeoEnvelope> {
  const payload = await dataForSeoRequest(
    `${DATAFORSEO_BASE_URL}${call.path}`,
    { method: "POST", body: JSON.stringify(call.body) },
    fetchImpl,
    call.timeoutMs,
  );
  return readEnvelope(payload, call.path);
}

/** GET `/v3/<path>` and read the envelope. Used by the free account endpoints. */
export async function dataForSeoGet(
  path: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs?: number,
): Promise<DataForSeoEnvelope> {
  const payload = await dataForSeoRequest(
    `${DATAFORSEO_BASE_URL}${path}`,
    { method: "GET" },
    fetchImpl,
    timeoutMs,
  );
  return readEnvelope(payload, path);
}

/** `tasks[0].result[0]` as a record. Empty object when the task found nothing. */
export function taskResult(envelope: DataForSeoEnvelope): Record<string, unknown> {
  const result = Array.isArray(envelope.task.result) ? envelope.task.result[0] : undefined;
  return isRecord(result) ? result : {};
}

/** `tasks[0].result[0].items`. Empty array when the task found nothing. */
export function taskItems(envelope: DataForSeoEnvelope): unknown[] {
  const result = taskResult(envelope);
  return Array.isArray(result.items) ? result.items : [];
}

/**
 * `total_count` when the endpoint reports one. Callers use it to decide whether
 * a listing was truncated — which gates the lost-link sweep, so a missing value
 * must stay `undefined` rather than defaulting to the row count.
 */
export function taskTotalCount(envelope: DataForSeoEnvelope): number | undefined {
  const result = taskResult(envelope);
  return numberValue(result.total_count) ?? numberValue(result.items_count);
}
