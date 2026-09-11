// upstream.ts — shared transport for paid third-party APIs (OpenRouter,
// Anthropic, KIE). One timeout/retry implementation and one error base class,
// so the route kernel maps every provider failure to an HTTP status in one
// place instead of each route listing `instanceof XGatewayError` checks.
import "server-only";

/** Base for every provider error. `status` is the HTTP status to surface. */
export class UpstreamError extends Error {
  readonly status: number;
  readonly provider: string;
  readonly code?: string;

  constructor(status: number, message: string, opts: { provider: string; code?: string }) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
    this.provider = opts.provider;
    this.code = opts.code;
  }
}

export type TransportFailure = { kind: "timeout" | "network"; detail: string };

export type FetchWithTimeoutOptions = {
  timeoutMs: number;
  /** Build the provider's own error for a timeout or network failure. */
  onTransportError: (failure: TransportFailure) => UpstreamError;
};

export type FetchWithRetryOptions = FetchWithTimeoutOptions & {
  /** Additional attempts after the first. Default 2. */
  retries?: number;
  /** Backoff base; attempt n waits base·2ⁿ plus jitter. Default 500ms. */
  baseDelayMs?: number;
  /** Response statuses worth retrying. Default 429/502/503/504. */
  retryableStatuses?: readonly number[];
};

const DEFAULT_RETRYABLE = [429, 502, 503, 504] as const;
// Transport failures surface as these statuses and are always retryable.
const TRANSPORT_STATUSES = new Set([502, 504]);
// Honour Retry-After only when it is short enough to wait inline.
const MAX_RETRY_AFTER_SECONDS = 10;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoff(baseMs: number, attempt: number): number {
  return baseMs * Math.pow(2, attempt) + Math.floor(Math.random() * 200);
}

/** `fetch` with a hard deadline. Timeouts and network failures become UpstreamErrors. */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  opts: FetchWithTimeoutOptions,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw opts.onTransportError({ kind: "timeout", detail: "timed out" });
    }
    const detail = (error instanceof Error ? error.message : String(error)).slice(0, 200);
    throw opts.onTransportError({ kind: "network", detail });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch with timeout plus exponential backoff on retryable statuses and
 * transport failures, honouring a short `Retry-After`. Returns the final
 * Response even when it is not ok — mapping a status to a provider-specific
 * message stays with the caller.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: FetchWithRetryOptions,
): Promise<Response> {
  const retries = opts.retries ?? 2;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const retryable = opts.retryableStatuses ?? DEFAULT_RETRYABLE;

  for (let attempt = 0; ; attempt++) {
    const last = attempt >= retries;
    let res: Response;
    try {
      res = await fetchWithTimeout(url, init, opts);
    } catch (error) {
      const transient = error instanceof UpstreamError && TRANSPORT_STATUSES.has(error.status);
      if (last || !transient) throw error;
      await sleep(backoff(baseDelayMs, attempt));
      continue;
    }

    if (res.ok || last || !retryable.includes(res.status)) return res;

    const retryAfter = Number(res.headers.get("retry-after") ?? "");
    const delayMs =
      Number.isFinite(retryAfter) && retryAfter > 0 && retryAfter <= MAX_RETRY_AFTER_SECONDS
        ? retryAfter * 1000
        : backoff(baseDelayMs, attempt);
    // Drain the body so the connection can be reused.
    await res.text().catch(() => "");
    await sleep(delayMs);
  }
}
