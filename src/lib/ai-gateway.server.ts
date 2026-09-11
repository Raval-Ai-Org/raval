// Central AI gateway — OpenRouter.
// Chat/generation:   Qwen 3 Max
// Extraction/research: Gemini 2.5 Pro
//
// All server routes/functions in this project call ONLY the helpers below.
// Swap providers by editing this one file.
import "server-only";
import {
  fetchWithRetry,
  fetchWithTimeout,
  UpstreamError,
  type TransportFailure,
} from "@/server/upstream";

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
export const CHAT_MODEL = "qwen/qwen3-max";
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

// Share of the budget the system block may consume before it is itself cut.
// Guards against a caller passing a runaway "context" string; the /api/chat
// schema already caps context at 6k, so this only ever binds on abuse.
const SYSTEM_BUDGET_RATIO = 0.6;
// What a message cut down to a stub keeps, so its role still reads as a turn.
const TRUNCATED_MESSAGE_CHARS = 200;

/**
 * Truncate message content to keep input tokens bounded.
 *
 * Allocation is by PRIORITY, not array order:
 *   1. system messages  — identity, grounding rules, action tags, brand context
 *   2. the newest turn  — the question actually being answered
 *   3. remaining turns  — newest first, oldest dropped to a stub
 *
 * The previous implementation walked front-to-back and spent the budget in
 * array order, so leading system prompts and the *oldest* history consumed it
 * and the current user question — always the last element — was the first thing
 * cut to 200 chars. Twelve turns into a conversation the model answered a
 * fragment of the question with stale history fully intact, and nothing
 * surfaced the truncation to the user.
 *
 * Output order always matches input order; only allocation order changed.
 *
 * Exported for tests. Like the previous implementation, a message reduced to a
 * stub can overshoot the budget by up to TRUNCATED_MESSAGE_CHARS — keeping the
 * turn's role legible is worth more than the exact ceiling.
 */
export function trimMessages(
  messages: ChatMessage[],
  budgetChars = MAX_INPUT_CHARS,
): ChatMessage[] {
  const out: ChatMessage[] = [...messages];
  const textIndices = messages
    .map((m, i) => (typeof m.content === "string" ? i : -1))
    .filter((i) => i >= 0);
  if (textIndices.length === 0) return out;

  let budget = budgetChars;

  const spend = (index: number, allowance: number): void => {
    const content = messages[index].content as string;
    if (content.length <= allowance) {
      budget -= content.length;
      return;
    }
    const keep = Math.max(TRUNCATED_MESSAGE_CHARS, allowance);
    out[index] = { ...messages[index], content: content.slice(0, keep) };
    budget -= Math.min(keep, allowance);
  };

  // 1. System messages first, bounded so they cannot starve the conversation.
  const systemIndices = textIndices.filter((i) => messages[i].role === "system");
  let systemAllowance = Math.floor(budgetChars * SYSTEM_BUDGET_RATIO);
  for (const i of systemIndices) {
    const before = budget;
    spend(i, Math.min(systemAllowance, budget));
    systemAllowance -= before - budget;
  }

  // 2. The newest turn gets whatever remains, before any older history.
  const conversationIndices = textIndices.filter((i) => messages[i].role !== "system");
  const newest = conversationIndices.pop();
  if (newest !== undefined) spend(newest, Math.max(budget, 0));

  // 3. Older history, newest first. Anything past the budget becomes a stub.
  for (let k = conversationIndices.length - 1; k >= 0; k--) {
    spend(conversationIndices[k], Math.max(budget, 0));
  }

  return out;
}

export class AiGatewayError extends UpstreamError {
  constructor(status: number, message: string) {
    super(status, message, { provider: "openrouter" });
    this.name = "AiGatewayError";
  }
}

function transportError(timeoutMessage?: string) {
  return ({ kind, detail }: TransportFailure) =>
    kind === "timeout"
      ? new AiGatewayError(504, timeoutMessage ?? "AI provider timed out. Please retry.")
      : new AiGatewayError(502, `Network error contacting AI provider: ${detail}`);
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
      { timeoutMs: CHAT_TIMEOUT_MS, onTransportError: transportError() },
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
    {
      timeoutMs: STREAM_TIMEOUT_MS,
      onTransportError: transportError("AI provider did not respond in time. Please retry."),
    },
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
