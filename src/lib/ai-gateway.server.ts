// Central AI gateway — OpenRouter.
// Chat/generation:   Qwen 3 Max
// Extraction/research: Gemini 2.5 Pro
//
// All server routes/functions in this project call ONLY the helpers below.
// Swap providers by editing this one file.

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const CHAT_MODEL = "qwen/qwen3-max";
export const EXTRACTION_MODEL = "google/gemini-2.5-pro";

const REFERER = process.env.APP_URL || "https://raval.ai";
const APP_TITLE = "Mellox AI";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
};

export type ChatOptions = {
  model?: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: "json_object" };
  tools?: unknown[];
  tool_choice?: unknown;
  /** Skip the in-memory response cache (default: cache enabled for non-streaming). */
  noCache?: boolean;
  /** Cache TTL in ms (default 10 minutes). */
  cacheTtlMs?: number;
};

/* ---------------- Credit-efficiency: hard caps + in-memory cache ---------------- */

// Hard cap so a runaway prompt never bills for a huge completion.
// 800 tokens covers TL;DR + 5 bullets + plan comfortably for normal chat.
const MAX_TOKENS_CAP = 1200;
const DEFAULT_MAX_TOKENS = 800;
// Extraction (Brand DNA, memory, insights) returns rich structured JSON with
// nested arrays — needs a larger ceiling. Cap tightened: 4k output is enough
// for our schemas; 8k was pure over-provisioning.
const EXTRACTION_MAX_TOKENS = 4096;
const EXTRACTION_DEFAULT_MAX_TOKENS = 2400;
// Longer cache = more dedupe = fewer billed calls.
const DEFAULT_CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX_ENTRIES = 400;
// Hard input cap prevents a runaway context ballooning input tokens.
const MAX_INPUT_CHARS = 16_000;
// Extraction can safely consume a larger crawl — Gemini 2.5 Pro has ~1M ctx.
const EXTRACTION_MAX_INPUT_CHARS = 60_000;
const CHAT_TIMEOUT_MS = 60_000;
const STREAM_TIMEOUT_MS = 90_000; // time to first byte
// Retry policy for transient upstream failures (429 / 5xx / network).
const MAX_RETRIES = 2;
const RETRY_BASE_MS = 500;

type CacheEntry = { value: any; expires: number };
const responseCache = new Map<string, CacheEntry>();

async function sha256(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function cacheGet(map: Map<string, CacheEntry>, key: string): any | null {
  const hit = map.get(key);
  if (!hit) return null;
  if (hit.expires < Date.now()) {
    map.delete(key);
    return null;
  }
  // LRU touch
  map.delete(key);
  map.set(key, hit);
  return hit.value;
}

function cacheSet(map: Map<string, CacheEntry>, key: string, value: any, ttl: number) {
  if (map.size >= CACHE_MAX_ENTRIES) {
    const oldest = map.keys().next().value;
    if (oldest) map.delete(oldest);
  }
  map.set(key, { value, expires: Date.now() + ttl });
}

function capTokens(n: number | undefined, ceiling = MAX_TOKENS_CAP): number {
  if (n == null) return Math.min(DEFAULT_MAX_TOKENS, ceiling);
  return Math.min(Math.max(1, Math.floor(n)), ceiling);
}

/** Truncate long text content in messages to keep input tokens bounded. */
function trimMessages(messages: ChatMessage[], budgetChars = MAX_INPUT_CHARS): ChatMessage[] {
  let budget = budgetChars;
  return messages.map((m) => {
    if (typeof m.content !== "string") return m;
    if (budget <= 0) return { ...m, content: m.content.slice(0, 200) };
    if (m.content.length <= budget) {
      budget -= m.content.length;
      return m;
    }
    const trimmed = m.content.slice(0, budget);
    budget = 0;
    return { ...m, content: trimmed };
  });
}

export class AiGatewayError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function getKey(): string {
  const k = process.env.OPENROUTER_API_KEY?.trim();
  if (!k || k === "sk-or-v1-replace-me-later" || k === "YOUR_KEY_HERE") {
    throw new AiGatewayError(
      503,
      "AI service is not configured. Please check the server API configuration.",
    );
  }
  if (!k.startsWith("sk-or-")) {
    throw new AiGatewayError(
      503,
      "AI service is not configured. Please check the server API configuration.",
    );
  }
  return k;
}

function headers(key: string): Record<string, string> {
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    "HTTP-Referer": REFERER,
    "X-Title": APP_TITLE,
  };
}

function mapStatus(status: number, body: string): AiGatewayError {
  if (status === 401)
    return new AiGatewayError(
      401,
      "OpenRouter rejected the API key. Please update OPENROUTER_API_KEY.",
    );
  if (status === 402)
    return new AiGatewayError(
      402,
      "AI credits exhausted on OpenRouter. Please top up at openrouter.ai/credits.",
    );
  if (status === 429)
    return new AiGatewayError(429, "AI rate limit reached. Please try again in a moment.");
  return new AiGatewayError(status || 502, body?.slice(0, 300) || "AI provider error");
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  timeoutMessage?: string,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (error: any) {
    if (error?.name === "AbortError") {
      throw new AiGatewayError(504, timeoutMessage ?? "AI provider timed out. Please retry.");
    }
    // Network / DNS / socket failures — surface as 502 with clear message.
    throw new AiGatewayError(
      502,
      `Network error contacting AI provider: ${String(error?.message ?? error).slice(0, 200)}`,
    );
  } finally {
    clearTimeout(timer);
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 502 || status === 503 || status === 504;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Fetch with timeout + exponential backoff on 429/5xx and network errors.
 * Honors `Retry-After` header when present.
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit,
  opts: { timeoutMs: number; retries?: number; timeoutMessage?: string },
): Promise<Response> {
  const retries = opts.retries ?? MAX_RETRIES;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchWithTimeout(url, init, opts.timeoutMs, opts.timeoutMessage);
      if (res.ok || !isRetryableStatus(res.status) || attempt === retries) {
        return res;
      }
      // Retryable status — honor Retry-After when reasonable, else backoff.
      const retryAfter = Number(res.headers.get("retry-after") ?? "");
      const delayMs =
        Number.isFinite(retryAfter) && retryAfter > 0 && retryAfter <= 10
          ? retryAfter * 1000
          : RETRY_BASE_MS * Math.pow(2, attempt) + Math.floor(Math.random() * 200);
      // Drain body so the connection can be reused.
      await res.text().catch(() => "");
      await sleep(delayMs);
    } catch (e) {
      lastErr = e;
      // Retry only on 502/504 gateway errors we raised or transient network drops.
      const status = e instanceof AiGatewayError ? e.status : 0;
      if (attempt === retries || (status !== 0 && status !== 502 && status !== 504)) {
        throw e;
      }
      await sleep(RETRY_BASE_MS * Math.pow(2, attempt) + Math.floor(Math.random() * 200));
    }
  }
  // Unreachable, but satisfies TS.
  throw lastErr instanceof Error ? lastErr : new AiGatewayError(502, "AI provider unavailable");
}

/* -------- In-flight dedupe: coalesce concurrent identical requests -------- */
const inflight = new Map<string, Promise<any>>();
async function dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const p = (async () => {
    try {
      return await fn();
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

/** Non-streaming chat completion. Returns raw OpenAI-shape JSON. Cached by default. */
export async function chatCompletion(opts: ChatOptions & { _extraction?: boolean }): Promise<any> {
  const key = getKey();
  const isExtraction = opts._extraction === true;
  const tokenCeiling = isExtraction ? EXTRACTION_MAX_TOKENS : MAX_TOKENS_CAP;
  const inputBudget = isExtraction ? EXTRACTION_MAX_INPUT_CHARS : MAX_INPUT_CHARS;
  const capped = isExtraction
    ? capTokens(opts.max_tokens ?? EXTRACTION_DEFAULT_MAX_TOKENS, tokenCeiling)
    : capTokens(opts.max_tokens, tokenCeiling);
  const trimmed = trimMessages(opts.messages, inputBudget);
  const body: Record<string, unknown> = {
    model: opts.model ?? CHAT_MODEL,
    messages: trimmed,
    stream: false,
    max_tokens: capped,
  };
  // Extraction is deterministic by default — override only if caller sets it.
  const temp = opts.temperature ?? (isExtraction ? 0.2 : undefined);
  if (temp != null) body.temperature = temp;
  if (opts.response_format) body.response_format = opts.response_format;
  if (opts.tools) body.tools = opts.tools;
  if (opts.tool_choice) body.tool_choice = opts.tool_choice;

  // Cache identical requests (skip when tools are involved — non-deterministic tool loops).
  const cacheable = !opts.noCache && !opts.tools;
  let cacheKey = "";
  if (cacheable) {
    cacheKey = await sha256(JSON.stringify(body));
    const hit = cacheGet(responseCache, cacheKey);
    if (hit) return { ...hit, _cached: true };
  }

  // Coalesce concurrent identical requests (dedupe key = cache key when cacheable).
  const dedupeKey = cacheable ? `chat:${cacheKey}` : "";
  const run = async () => {
    const res = await fetchWithRetry(
      `${OPENROUTER_BASE}/chat/completions`,
      {
        method: "POST",
        headers: headers(key),
        body: JSON.stringify(body),
      },
      { timeoutMs: CHAT_TIMEOUT_MS },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw mapStatus(res.status, text);
    }
    let json: any;
    try {
      json = await res.json();
    } catch {
      throw new AiGatewayError(502, "AI provider returned malformed JSON");
    }
    if (!json?.choices?.[0]?.message) {
      throw new AiGatewayError(502, "AI provider returned no completion");
    }
    const finish = json?.choices?.[0]?.finish_reason;
    if (finish === "length") {
      console.warn(
        `[ai-gateway] finish_reason=length (model=${body.model}, max_tokens=${capped}) — output truncated`,
      );
    }
    if (cacheable && cacheKey)
      cacheSet(responseCache, cacheKey, json, opts.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS);
    return json;
  };
  return dedupeKey ? dedupe(dedupeKey, run) : run();
}

/** Extraction/research completion — routed to Gemini 2.5 Pro with extraction-scale caps. */
export function extractionCompletion(opts: Omit<ChatOptions, "model">): Promise<any> {
  return chatCompletion({ ...opts, model: EXTRACTION_MODEL, _extraction: true });
}

/** Streaming chat completion. Passes through OpenAI-shape SSE. */
export async function chatCompletionStream(opts: ChatOptions): Promise<Response> {
  const key = getKey();
  const capped = capTokens(opts.max_tokens);
  const body: Record<string, unknown> = {
    model: opts.model ?? CHAT_MODEL,
    messages: trimMessages(opts.messages),
    stream: true,
    max_tokens: capped,
  };
  if (opts.temperature != null) body.temperature = opts.temperature;
  if (opts.tools) body.tools = opts.tools;
  if (opts.tool_choice) body.tool_choice = opts.tool_choice;

  // Time-to-first-byte timeout only — we don't want to cut a healthy long stream.
  const upstream = await fetchWithTimeout(
    `${OPENROUTER_BASE}/chat/completions`,
    {
      method: "POST",
      headers: headers(key),
      body: JSON.stringify(body),
    },
    STREAM_TIMEOUT_MS,
    "AI provider did not respond in time. Please retry.",
  );

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    throw mapStatus(upstream.status, text);
  }
  return new Response(upstream.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
