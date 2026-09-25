// kie-gateway.server.ts — Kie.ai Market API client, used ONLY by the video
// provider (src/server/ugc/providers/kie.server.ts). TEMPORARY: KIE is being
// dropped; images already run on OpenRouter (src/lib/openrouter-image.server.ts).
// Removing KIE = delete this file, providers/kie.server.ts, the KIE webhook
// route and the KIE_* env vars (checklist in docs/adr/0026-openrouter-only-models.md).
import "server-only";
import { UpstreamError } from "@/server/upstream";
import { log } from "@/server/observability/logger";

const KIE_BASE = "https://api.kie.ai/api/v1";

export function getKieConfigStatus() {
  return { configured: Boolean(process.env.KIE_API_KEY?.trim()), runtime: "node" } as const;
}

export class KieGatewayError extends UpstreamError {
  readonly category: string;
  /** Kie's own response code (e.g. 402 = the Kie account is out of credits). */
  readonly providerCode?: number;

  constructor(status: number, message: string, category = "provider", providerCode?: number) {
    super(status, message, { provider: "kie", code: category });
    this.name = "KieGatewayError";
    this.category = category;
    this.providerCode = providerCode;
  }
}

function getApiKey(): string {
  const key = process.env.KIE_API_KEY?.trim();
  if (!key) {
    throw new KieGatewayError(
      503,
      "Kie video generation is not configured. Set KIE_API_KEY on the server and restart the app.",
      "configuration",
    );
  }
  return key;
}

function headers(key: string): HeadersInit {
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

/**
 * Kie reuses HTTP-500-shaped codes for plain request-validation failures (an
 * unsupported aspect ratio, a missing field) as well as for genuine provider
 * errors — confirmed by direct testing: both `{"code":500,"msg":"This
 * aspect_ratio is not within the range of allowed options"}` and a real
 * transient failure come back the same shape. Recognize the validation kind
 * by its message so it fails fast (no retry, no model fallback burning
 * credits on a request that will never succeed) instead of being treated as
 * a temporary outage.
 */
const VALIDATION_HINT_RE = /not within the range|is required|not supported|invalid|must be one of/i;

function mapStatus(status: number, detail?: string): KieGatewayError {
  const error = mapStatusCategory(status, detail);
  return new KieGatewayError(error.status, error.message, error.category, status);
}

function mapStatusCategory(status: number, detail?: string): KieGatewayError {
  const message = detail?.trim() || undefined;
  if (status === 401 || status === 403)
    return new KieGatewayError(
      503,
      "Kie authentication failed. Check the server-side API key.",
      "authentication",
    );
  if (status === 429)
    return new KieGatewayError(
      429,
      "Kie is rate limiting generation requests. Please try again shortly.",
      "rate_limit",
    );
  if (status === 422)
    return new KieGatewayError(422, message || "Kie rejected this request.", "request");
  if (status >= 400 && status < 500)
    return new KieGatewayError(400, message || "Kie rejected this request.", "request");
  if (message && VALIDATION_HINT_RE.test(message)) {
    return new KieGatewayError(400, message, "request");
  }
  // A real 5xx / unrecognized code: never invent detail Kie didn't give us,
  // but never discard detail it did give us either — the generic sentence is
  // strictly a fallback for a genuinely empty response.
  return new KieGatewayError(
    502,
    message
      ? `The image provider rejected the request: ${message}`
      : "The image provider is temporarily unavailable.",
    "provider",
  );
}

/** A blip worth one silent retry rather than surfacing to the user. */
const TRANSIENT_RETRY_CATEGORIES = new Set(["provider", "network"]);
const TRANSIENT_RETRY_DELAYS_MS = [800, 2000];

async function fetchJsonOnce(url: string, init: RequestInit, timeoutMs: number): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    let payload: any;
    try {
      payload = await response.json();
    } catch {
      if (!response.ok)
        throw mapStatus(response.status, "The Kie provider returned malformed data.");
      throw new KieGatewayError(502, "The Kie provider returned malformed data.", "response");
    }

    const kCode = Number(payload?.code ?? payload?.status ?? 0);
    if (payload && (payload.code !== undefined || payload.status !== undefined)) {
      const msg = typeof payload?.msg === "string" ? payload.msg : undefined;
      if (kCode !== 200 && kCode !== 0) {
        throw mapStatus(kCode || response.status || 400, msg || "Kie rejected this request.");
      }
    }

    if (!response.ok)
      throw mapStatus(response.status, payload?.msg || "The Kie provider rejected the request.");
    return payload;
  } catch (error) {
    if (error instanceof KieGatewayError) throw error;
    if ((error as { name?: string })?.name === "AbortError")
      throw new KieGatewayError(504, "Image generation timed out. Please retry.", "timeout");
    throw new KieGatewayError(502, "The image provider could not be reached.", "network");
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A single 5xx or dropped connection from Kie shouldn't fail the whole
 * generation — it's usually a passing blip, not a real outage. Retry those
 * (never validation/auth/rate-limit errors, which won't change on retry)
 * before letting the error reach the caller.
 */
async function fetchJson(url: string, init: RequestInit, timeoutMs: number): Promise<any> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= TRANSIENT_RETRY_DELAYS_MS.length; attempt++) {
    try {
      return await fetchJsonOnce(url, init, timeoutMs);
    } catch (error) {
      lastError = error;
      const retryable =
        error instanceof KieGatewayError && TRANSIENT_RETRY_CATEGORIES.has(error.category);
      if (!retryable || attempt === TRANSIENT_RETRY_DELAYS_MS.length) throw error;
      await new Promise((resolve) => setTimeout(resolve, TRANSIENT_RETRY_DELAYS_MS[attempt]));
    }
  }
  throw lastError;
}

function resultUrls(record: any): string[] {
  const visit = (value: any, depth: number): string[] => {
    if (depth > 8 || value == null) return [];
    if (typeof value === "string") {
      if (/^https:\/\//i.test(value)) return [value];
      try {
        return visit(JSON.parse(value), depth + 1);
      } catch {
        return [];
      }
    }
    if (Array.isArray(value)) return value.flatMap((item) => visit(item, depth + 1));
    if (typeof value !== "object") return [];

    const urls: string[] = [];
    for (const key of [
      "resultUrls",
      "result_urls",
      "urls",
      "images",
      "videos",
      "videoUrl",
      "video_url",
      "url",
    ]) {
      if (key in value) urls.push(...visit(value[key], depth + 1));
    }
    for (const key of ["resultJson", "result_json", "result", "data"]) {
      if (key in value) urls.push(...visit(value[key], depth + 1));
    }
    return [...new Set(urls)];
  };

  return visit(record, 0);
}

/**
 * Create one Kie Market task with a caller-built input. No budget check and no
 * metering here: the caller holds an ai_usage_reservations hold for the task
 * and captures or releases it when the task settles. Not retried — a retried
 * create after a lost response could start (and bill) a second render; the
 * caller's job retries instead.
 */
export async function createKieTask(opts: {
  model: string;
  input: Record<string, unknown>;
  callBackUrl?: string;
}): Promise<{ taskId: string }> {
  const startedAt = Date.now();
  const json = await fetchJsonOnce(
    `${KIE_BASE}/jobs/createTask`,
    {
      method: "POST",
      headers: headers(getApiKey()),
      body: JSON.stringify({
        model: opts.model,
        input: opts.input,
        ...(opts.callBackUrl ? { callBackUrl: opts.callBackUrl } : {}),
      }),
    },
    30_000,
  );
  const taskId = json?.data?.taskId ?? json?.data?.task_id ?? json?.taskId ?? json?.task_id;
  if (typeof taskId !== "string" || !taskId) {
    throw new KieGatewayError(502, "The video provider did not return a task ID.", "response");
  }
  log.info("kie.task.submitted", { model: opts.model, taskId, elapsedMs: Date.now() - startedAt });
  return { taskId };
}

export type KieTaskRecord = {
  state: "pending" | "success" | "failed";
  /** Kie's raw state: waiting | queuing | generating | success | fail. */
  providerState: string;
  urls: string[];
  failCode: string | null;
  failMessage: string | null;
  /** Kie credits the task consumed (reported once it settles). */
  creditsConsumed: number | null;
  costTimeMs: number | null;
};

/** One status read with the detail a durable job needs (cost, failure code). */
export async function getKieTask(taskId: string): Promise<KieTaskRecord> {
  const json = await fetchJson(
    `${KIE_BASE}/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
    { headers: headers(getApiKey()) },
    30_000,
  );
  const record = json?.data ?? json;
  const providerState = String(record?.state ?? record?.status ?? "").toLowerCase();
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const text = (v: unknown) =>
    typeof v === "string" && v.trim() ? v.trim().slice(0, 300) : v == null ? null : String(v);
  const base = {
    providerState,
    failCode: text(record?.failCode),
    failMessage: text(record?.failMsg ?? record?.errorMessage),
    creditsConsumed: num(record?.creditsConsumed),
    costTimeMs: num(record?.costTime),
  };
  if (["success", "completed", "succeeded"].includes(providerState)) {
    return { ...base, state: "success", urls: resultUrls(record) };
  }
  if (["fail", "failed", "error", "cancelled"].includes(providerState)) {
    return { ...base, state: "failed", urls: [] };
  }
  return { ...base, state: "pending", urls: [] };
}

export function pickVideoUrl(urls: string[]): { videoUrl?: string; thumbnailUrl?: string } {
  return {
    videoUrl: urls.find((url) => /\.(mp4|webm|mov)(?:\?|$)/i.test(url)) ?? urls[0],
    thumbnailUrl: urls.find((url) => /\.(png|jpe?g|webp)(?:\?|$)/i.test(url)),
  };
}
