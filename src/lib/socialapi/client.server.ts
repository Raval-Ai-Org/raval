// client.server.ts — the low-level SocialAPI.ai HTTP client (server-only).
//
// Contract: https://docs.social-api.ai (OpenAPI: /api-reference/openapi.json).
//   base URL  https://api.social-api.ai/v1
//   auth      Authorization: Bearer sapi_key_…   (server-side ONLY)
//   errors    { error: { code, message, meta }, request_id }
//
// The client never throws on an HTTP status: callers inspect `status` because
// several endpoints carry a meaningful body on non-2xx (POST /posts returns the
// post on 207 partial and 422 all-failed). It throws SocialApiError only when
// no response arrived (timeout / network).
//
// Retries are opt-in per call and limited to requests that are safe to repeat.
// POST /posts has no idempotency key, so a publish is NEVER retried here — a
// timeout after the provider accepted it would otherwise duplicate the post.
import "server-only";

export const SOCIALAPI_DEFAULT_BASE_URL = "https://api.social-api.ai/v1";

export type SocialApiErrorBody = {
  error?: { code?: string; message?: string; meta?: Record<string, unknown> };
  request_id?: string;
};

export type SocialApiResponse<T = any> = {
  status: number;
  data: T;
  requestId: string | null;
};

export type SocialApiRequest = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  /** Path below /v1, e.g. "/accounts". */
  path: string;
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  /** Multipart upload (media). Mutually exclusive with `body`. */
  form?: FormData;
  timeoutMs?: number;
  /** Retry transient failures (429 rate limits, 502/503/504, network). Only for repeat-safe calls. */
  retry?: boolean;
};

export type SocialApiCall = <T = any>(req: SocialApiRequest) => Promise<SocialApiResponse<T>>;

export class SocialApiError extends Error {
  constructor(
    public code: "timeout" | "network" | "misconfigured",
    message: string,
  ) {
    super(message);
    this.name = "SocialApiError";
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 2;
/** 429s that are quota/billing exhaustion, not transient rate limiting. */
const NON_RETRYABLE_429 = /^(validation\.(post|interaction)_limit_exhausted|billing\.)/;

export function assertSocialApiBaseUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new SocialApiError("misconfigured", "SOCIALAPI_BASE_URL is not a valid URL");
  }
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const loopback = host === "localhost" || host === "127.0.0.1" || host === "::1";
  // Loopback over http is allowed only for the in-process mock used by tests.
  if (u.protocol !== "https:" && !(loopback && u.protocol === "http:")) {
    throw new SocialApiError("misconfigured", "SOCIALAPI_BASE_URL must use https");
  }
  return u;
}

function buildUrl(base: URL, path: string, query: SocialApiRequest["query"]): string {
  const root = base.href.endsWith("/") ? base.href : `${base.href}/`;
  const u = new URL(path.replace(/^\//, ""), root);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, String(v));
  }
  return u.toString();
}

function retryDelayMs(attempt: number, retryAfter: string | null): number {
  const header = Number(retryAfter);
  if (Number.isFinite(header) && header > 0) return Math.min(header * 1000, 5_000);
  return 400 * 2 ** attempt;
}

function isRetryable(status: number, data: unknown): boolean {
  if (status === 502 || status === 503 || status === 504) return true;
  if (status !== 429) return false;
  const code = (data as SocialApiErrorBody | null)?.error?.code ?? "";
  return !NON_RETRYABLE_429.test(code);
}

export type SocialApiClientConfig = {
  apiKey: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
};

export function createSocialApiClient(config: SocialApiClientConfig): SocialApiCall {
  if (!config.apiKey) throw new SocialApiError("misconfigured", "SOCIALAPI_API_KEY is not set");
  const base = assertSocialApiBaseUrl(config.baseUrl || SOCIALAPI_DEFAULT_BASE_URL);
  const doFetch = config.fetchFn ?? fetch;
  const sleep = config.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  return async function call<T>(req: SocialApiRequest): Promise<SocialApiResponse<T>> {
    const method = req.method ?? "GET";
    const url = buildUrl(base, req.path, req.query);
    const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    // Log the route template, never the query string or body.
    const label = `${method} ${req.path.split("?")[0]}`;

    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const started = Date.now();
      try {
        const headers: Record<string, string> = {
          Authorization: `Bearer ${config.apiKey}`,
          Accept: "application/json",
        };
        let body: BodyInit | undefined;
        if (req.form) body = req.form;
        else if (req.body !== undefined) {
          headers["Content-Type"] = "application/json";
          body = JSON.stringify(req.body);
        }
        const res = await doFetch(url, { method, headers, body, signal: controller.signal });
        const text = res.status === 204 ? "" : await res.text();
        let data: any = null;
        if (text) {
          try {
            data = JSON.parse(text);
          } catch {
            data = null;
          }
        }
        const requestId = res.headers.get("x-request-id") ?? data?.request_id ?? null;
        console.log(
          `[socialapi] ${label} → ${res.status} (${Date.now() - started}ms)${requestId ? ` req=${requestId}` : ""}`,
        );
        if (req.retry && attempt < MAX_RETRIES && isRetryable(res.status, data)) {
          await sleep(retryDelayMs(attempt, res.headers.get("retry-after")));
          continue;
        }
        return { status: res.status, data: data as T, requestId };
      } catch (e) {
        const timedOut = e instanceof Error && e.name === "AbortError";
        console.error(
          `[socialapi] ${label} → ${timedOut ? `TIMEOUT (${timeoutMs}ms)` : "UNREACHABLE"}`,
        );
        if (req.retry && attempt < MAX_RETRIES) {
          await sleep(retryDelayMs(attempt, null));
          continue;
        }
        throw new SocialApiError(
          timedOut ? "timeout" : "network",
          timedOut
            ? `SocialAPI request timed out after ${timeoutMs}ms`
            : "SocialAPI could not be reached",
        );
      } finally {
        clearTimeout(timer);
      }
    }
  };
}

// ─── Error taxonomy (provider code → Mellox distribution code) ──────────────
// The Mellox envelope `{ error: { code, detail } }` is shared with the SDR
// provider so the Studio renders both identically (src/lib/sdr.functions.ts).
export type DistributionErrorCode =
  | "PLATFORM_VALIDATION"
  | "ACCOUNT_EXPIRED"
  | "BYOK_REQUIRED"
  | "QUOTA_EXCEEDED"
  | "PROVIDER_BILLING"
  | "RATE_LIMITED"
  | "DUPLICATE"
  | "CONFLICT"
  | "NOT_FOUND"
  | "UNSUPPORTED"
  | "PROVIDER_MISCONFIGURED"
  | "DISTRIBUTION_UNAVAILABLE"
  | "UNKNOWN";

export function classifySocialApiError(
  status: number,
  code: string | undefined,
): DistributionErrorCode {
  const c = code ?? "";
  if (c === "account.reconnection_required" || /^platform\.[a-z_]+\.auth$/.test(c))
    return "ACCOUNT_EXPIRED";
  if (c === "byok.credentials_invalid") return "ACCOUNT_EXPIRED";
  if (c.startsWith("byok.")) return "BYOK_REQUIRED";
  if (c === "billing.past_due" || status === 402) return "PROVIDER_BILLING";
  if (/limit_exhausted$/.test(c) || c.startsWith("billing.")) return "QUOTA_EXCEEDED";
  if (/\.rate_limit$/.test(c) || status === 429) return "RATE_LIMITED";
  // Our own key rejected: an operator problem, never the end user's.
  if (c.startsWith("auth.") || status === 401) return "PROVIDER_MISCONFIGURED";
  if (status === 501 || c === "resource.not_supported") return "UNSUPPORTED";
  if (status === 404) return "NOT_FOUND";
  if (c === "account.already_linked" || c === "resource.conflict") return "DUPLICATE";
  if (status === 409) return "CONFLICT";
  if (status === 400 || status === 403 || status === 412 || status === 413 || status === 422)
    return "PLATFORM_VALIDATION";
  if (status >= 500 || status === 0) return "DISTRIBUTION_UNAVAILABLE";
  return "UNKNOWN";
}

const OPERATOR_DETAIL =
  "The publishing provider rejected Mellox's credentials. An administrator needs to check the SocialAPI configuration.";

/** Map a non-2xx provider response to the Mellox `{ status, body }` envelope. */
export function socialApiErrorResponse(res: SocialApiResponse<unknown>): {
  status: number;
  body: { error: { code: DistributionErrorCode; detail: string; requestId?: string } };
} {
  const data = res.data as SocialApiErrorBody | null;
  const providerCode = data?.error?.code;
  const code = classifySocialApiError(res.status, providerCode);
  const detail =
    code === "PROVIDER_MISCONFIGURED"
      ? OPERATOR_DETAIL
      : (data?.error?.message ?? `Publishing provider error (${res.status})`);
  // Upstream auth/5xx failures become 503 for our caller; user-actionable
  // statuses pass through so the UI can distinguish them.
  const status =
    code === "PROVIDER_MISCONFIGURED" || code === "DISTRIBUTION_UNAVAILABLE" ? 503 : res.status;
  return {
    status,
    body: { error: { code, detail, ...(res.requestId ? { requestId: res.requestId } : {}) } },
  };
}

/** Transport failure (no response) → envelope. */
export function socialApiTransportError(e: unknown): {
  status: number;
  body: { error: { code: DistributionErrorCode; detail: string } };
} {
  const misconfigured = e instanceof SocialApiError && e.code === "misconfigured";
  return {
    status: 503,
    body: {
      error: {
        code: misconfigured ? "PROVIDER_MISCONFIGURED" : "DISTRIBUTION_UNAVAILABLE",
        detail: misconfigured
          ? OPERATOR_DETAIL
          : e instanceof Error
            ? e.message
            : "The publishing provider could not be reached",
      },
    },
  };
}
