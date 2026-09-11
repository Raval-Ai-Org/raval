// Central AI gateway — OpenRouter.
// Chat/generation:   Qwen 3 Max
// Extraction/research: Gemini 2.5 Pro
// Economy / "Flash":   Gemini 2.5 Flash (fast chat, history summaries, and the
//                      model a workspace degrades to past its spend ceiling)
//
// All server routes/functions in this project call ONLY the helpers below.
// Swap providers by editing this one file.
//
// Every call goes through the same pipeline:
//   budget check (src/server/ai/budget.ts) → shared cache (per tenant) →
//   in-flight dedupe → provider → truncation detection → usage metering.
import "server-only";
import {
  fetchWithRetry,
  fetchWithTimeout,
  UpstreamError,
  type TransportFailure,
} from "@/server/upstream";
import { cache, digest, recordCacheLookup } from "@/server/cache/store";
import { checkBudget } from "@/server/ai/budget";
import { recordUsage } from "@/server/ai/metering";
import { estimateTextCost, round6 } from "@/server/ai/pricing";
import { getRequestScope } from "@/server/request-context";
import { getAppUrl } from "@/server/env";

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
export const CHAT_MODEL = "qwen/qwen3-max";
export const EXTRACTION_MODEL = "google/gemini-2.5-pro";
export const FAST_CHAT_MODEL = "google/gemini-2.5-flash";
/** Where text generation goes once a workspace is past its spend ceiling. */
export const DEGRADED_TEXT_MODEL = FAST_CHAT_MODEL;

/** The chat model picker's allow-list: the browser sends an id, never a model. */
export const CHAT_MODEL_CHOICES: Record<string, string> = {
  "ravi-flash": FAST_CHAT_MODEL,
  "ravi-pro": CHAT_MODEL,
};

const REFERER = getAppUrl();
const APP_TITLE = "Mellox AI";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
};

/**
 * Output-token budget class. The previous gateway clamped EVERY non-extraction
 * call to 1,200 tokens — while callers asked for 1,600–2,400 and generated up to
 * eight posts from that one budget (~150 tokens a post: thin, generic output).
 */
export type TokenTask = "chat" | "generate" | "extraction";

const TOKEN_BUDGETS: Record<TokenTask, { default: number; max: number }> = {
  chat: { default: 1_500, max: 2_000 },
  generate: { default: 1_200, max: 6_000 },
  extraction: { default: 2_400, max: 8_192 },
};
/** Output cap while degraded past a spend ceiling. */
const DEGRADED_MAX_TOKENS = 1_000;

export type ChatOptions = {
  model?: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  /** Which budget class applies. Default: "generate" (non-stream), "chat" (stream). */
  task?: TokenTask;
  response_format?: { type: "json_object" };
  tools?: unknown[];
  tool_choice?: unknown;
  /** Skip the response cache entirely (read and write). */
  noCache?: boolean;
  /**
   * The user explicitly asked for a new take ("regenerate"): skip the cached
   * answer, nudge temperature up, and store the fresh result.
   */
  regenerate?: boolean;
  /** Cache TTL in ms (default 30 minutes). */
  cacheTtlMs?: number;
  /** Metering route label; defaults to the request scope's route. */
  route?: string;
};

export type CompletionMeta = {
  _cached?: boolean;
  _truncated?: boolean;
  _model?: string;
  _degraded?: boolean;
};

// Longer cache = more dedupe = fewer billed calls.
const DEFAULT_CACHE_TTL_MS = 30 * 60 * 1000;
// Hard input cap prevents a runaway context ballooning input tokens.
const MAX_INPUT_CHARS = 16_000;
// Extraction can safely consume a larger crawl — Gemini 2.5 Pro has ~1M ctx.
const EXTRACTION_MAX_INPUT_CHARS = 60_000;
const CHAT_TIMEOUT_MS = 60_000;
const STREAM_TIMEOUT_MS = 90_000; // time to first byte

export function capTokens(n: number | undefined, task: TokenTask): number {
  const budget = TOKEN_BUDGETS[task];
  if (n == null) return budget.default;
  return Math.min(Math.max(1, Math.floor(n)), budget.max);
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

type OpenRouterUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  cost?: number;
  prompt_tokens_details?: { cached_tokens?: number };
};

/** USD for one completion: OpenRouter's own `usage.cost` when present, else our estimate. */
export function completionCost(model: string, usage: OpenRouterUsage | undefined): number {
  if (typeof usage?.cost === "number" && Number.isFinite(usage.cost)) return round6(usage.cost);
  return estimateTextCost(model, {
    inputTokens: usage?.prompt_tokens ?? 0,
    outputTokens: usage?.completion_tokens ?? 0,
  });
}

/** Tenant scope for cache keys: a cached answer is never served across tenants. */
function cacheScope(): string {
  const scope = getRequestScope();
  return scope.workspaceId ? `ws:${scope.workspaceId}` : scope.userId ? `u:${scope.userId}` : "anon";
}

type CachedCompletion = { json: any; costUsd: number };

/** Non-streaming chat completion. Returns raw OpenAI-shape JSON plus `_`-prefixed metadata. */
export async function chatCompletion(
  opts: ChatOptions & { _extraction?: boolean },
): Promise<any & CompletionMeta> {
  const key = getKey();
  const isExtraction = opts._extraction === true;
  const task: TokenTask = isExtraction ? "extraction" : (opts.task ?? "generate");
  const inputBudget = isExtraction ? EXTRACTION_MAX_INPUT_CHARS : MAX_INPUT_CHARS;

  let model = opts.model ?? (isExtraction ? EXTRACTION_MODEL : CHAT_MODEL);
  let maxTokens = capTokens(opts.max_tokens, task);
  const budget = await checkBudget("text");
  const degraded = budget.mode === "degrade";
  if (degraded) {
    model = DEGRADED_TEXT_MODEL;
    maxTokens = Math.min(maxTokens, DEGRADED_MAX_TOKENS);
  }

  const body: Record<string, unknown> = {
    model,
    messages: trimMessages(opts.messages, inputBudget),
    stream: false,
    max_tokens: maxTokens,
    // Ask OpenRouter to report token usage and the billed cost.
    usage: { include: true },
  };
  // Extraction is deterministic by default — override only if caller sets it.
  let temp = opts.temperature ?? (isExtraction ? 0.2 : undefined);
  if (opts.regenerate) temp = Math.min(1.2, (temp ?? 0.7) + 0.25);
  if (temp != null) body.temperature = temp;
  if (opts.response_format) body.response_format = opts.response_format;
  if (opts.tools) body.tools = opts.tools;
  if (opts.tool_choice) body.tool_choice = opts.tool_choice;

  // Cache identical requests per tenant (never tool loops — non-deterministic).
  const cacheable = !opts.noCache && !opts.tools;
  const route = opts.route;
  let cacheKey = "";
  if (cacheable) {
    // The temperature-jittered body of a regenerate is keyed like the base
    // request, so the fresh answer replaces the one the user rejected.
    const keyBody = { ...body, temperature: opts.temperature ?? body.temperature };
    cacheKey = `ai:${await digest(`${cacheScope()}|${JSON.stringify(keyBody)}`)}`;
    if (!opts.regenerate) {
      const hit = await cache.get<CachedCompletion>(cacheKey);
      recordCacheLookup("ai", Boolean(hit));
      if (hit) {
        recordUsage({
          provider: "openrouter",
          model,
          route,
          cached: true,
          savedUsd: hit.costUsd,
          status: degraded ? "degraded" : "ok",
        });
        return { ...hit.json, _cached: true, _model: model, _degraded: degraded };
      }
    }
  }

  const dedupeKey = cacheable && !opts.regenerate ? `chat:${cacheKey}` : "";
  const run = async () => {
    const started = Date.now();
    let res: Response;
    try {
      res = await fetchWithRetry(
        `${OPENROUTER_BASE}/chat/completions`,
        { method: "POST", headers: headers(key), body: JSON.stringify(body) },
        { timeoutMs: CHAT_TIMEOUT_MS, onTransportError: transportError() },
      );
    } catch (error) {
      recordUsage({ provider: "openrouter", model, route, status: "error", latencyMs: Date.now() - started });
      throw error;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      recordUsage({ provider: "openrouter", model, route, status: "error", latencyMs: Date.now() - started });
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
    const truncated = json?.choices?.[0]?.finish_reason === "length";
    const usage: OpenRouterUsage | undefined = json?.usage;
    const costUsd = completionCost(model, usage);
    recordUsage({
      provider: "openrouter",
      model,
      route,
      inputTokens: usage?.prompt_tokens,
      outputTokens: usage?.completion_tokens,
      estCostUsd: costUsd,
      truncated,
      latencyMs: Date.now() - started,
      status: degraded ? "degraded" : "ok",
    });
    // A cut-off answer is never cached: a retry must get a fresh attempt, not
    // the same broken output for the next 30 minutes.
    if (cacheable && cacheKey && !truncated) {
      const ttlSeconds = Math.round((opts.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS) / 1000);
      await cache.set(cacheKey, { json, costUsd } satisfies CachedCompletion, ttlSeconds);
    }
    return { ...json, _truncated: truncated, _model: model, _degraded: degraded };
  };
  return dedupeKey ? dedupe(dedupeKey, run) : run();
}

/** Extraction/research completion — routed to Gemini 2.5 Pro with extraction-scale caps. */
export function extractionCompletion(opts: Omit<ChatOptions, "model">): Promise<any> {
  return chatCompletion({ ...opts, model: EXTRACTION_MODEL, _extraction: true });
}

/** SSE `data:` payload the chat UI reads to offer "Continue" on a cut-off reply. */
export const TRUNCATION_EVENT = JSON.stringify({ mellox: { truncated: true } });

/**
 * Pass OpenAI-shape SSE through unchanged while watching it: records usage when
 * the stream ends and, when the reply hit the token ceiling, inserts one
 * `{"mellox":{"truncated":true}}` event before `[DONE]`. Exported for tests.
 */
export function meterSseStream(
  upstream: ReadableStream<Uint8Array>,
  onDone: (info: { usage?: OpenRouterUsage; finishReason?: string; outputChars: number }) => void,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = "";
  let usage: OpenRouterUsage | undefined;
  let finishReason: string | undefined;
  let outputChars = 0;
  let finished = false;

  const finish = () => {
    if (finished) return;
    finished = true;
    onDone({ usage, finishReason, outputChars });
  };

  const handleLine = (line: string, out: TransformStreamDefaultController<Uint8Array>) => {
    const trimmed = line.trim();
    if (trimmed === "data: [DONE]" && finishReason === "length") {
      out.enqueue(encoder.encode(`data: ${TRUNCATION_EVENT}\n\n`));
    }
    if (trimmed.startsWith("data:") && trimmed !== "data: [DONE]") {
      try {
        const payload = JSON.parse(trimmed.slice(5).trim());
        const choice = payload?.choices?.[0];
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        if (typeof choice?.delta?.content === "string") outputChars += choice.delta.content.length;
        if (payload?.usage) usage = payload.usage;
      } catch {
        /* keep-alive comments and partial frames pass through untouched */
      }
    }
    out.enqueue(encoder.encode(`${line}\n`));
  };

  return upstream.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, out) {
        pending += decoder.decode(chunk, { stream: true });
        let newline = pending.indexOf("\n");
        while (newline >= 0) {
          handleLine(pending.slice(0, newline), out);
          pending = pending.slice(newline + 1);
          newline = pending.indexOf("\n");
        }
      },
      flush(out) {
        pending += decoder.decode();
        if (pending) out.enqueue(encoder.encode(pending));
        finish();
      },
    }),
  );
}

/** Streaming chat completion. Passes through OpenAI-shape SSE, metered. */
export async function chatCompletionStream(opts: ChatOptions): Promise<Response> {
  const key = getKey();
  let model = opts.model ?? CHAT_MODEL;
  let maxTokens = capTokens(opts.max_tokens, opts.task ?? "chat");
  const budget = await checkBudget("text");
  const degraded = budget.mode === "degrade";
  if (degraded) {
    model = DEGRADED_TEXT_MODEL;
    maxTokens = Math.min(maxTokens, DEGRADED_MAX_TOKENS);
  }
  const body: Record<string, unknown> = {
    model,
    messages: trimMessages(opts.messages),
    stream: true,
    max_tokens: maxTokens,
    usage: { include: true },
  };
  if (opts.temperature != null) body.temperature = opts.temperature;
  if (opts.tools) body.tools = opts.tools;
  if (opts.tool_choice) body.tool_choice = opts.tool_choice;

  const started = Date.now();
  const route = opts.route ?? getRequestScope().route;
  // Captured now: the stream finishes after the request scope has closed.
  const scope = getRequestScope();

  // Time-to-first-byte timeout only — we don't want to cut a healthy long stream.
  const upstream = await fetchWithTimeout(
    `${OPENROUTER_BASE}/chat/completions`,
    { method: "POST", headers: headers(key), body: JSON.stringify(body) },
    {
      timeoutMs: STREAM_TIMEOUT_MS,
      onTransportError: transportError("AI provider did not respond in time. Please retry."),
    },
  );

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    recordUsage({
      provider: "openrouter",
      model,
      route,
      status: "error",
      workspaceId: scope.workspaceId ?? null,
      userId: scope.userId ?? null,
    });
    throw mapStatus(upstream.status, text);
  }

  const metered = meterSseStream(upstream.body, ({ usage, finishReason, outputChars }) => {
    recordUsage({
      provider: "openrouter",
      model,
      route,
      workspaceId: scope.workspaceId ?? null,
      userId: scope.userId ?? null,
      inputTokens: usage?.prompt_tokens,
      outputTokens: usage?.completion_tokens ?? Math.ceil(outputChars / 4),
      estCostUsd: completionCost(model, usage),
      truncated: finishReason === "length",
      latencyMs: Date.now() - started,
      status: degraded ? "degraded" : "ok",
    });
  });

  return new Response(metered, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-AI-Model": model,
      ...(degraded ? { "X-Usage-Degraded": "1" } : {}),
    },
  });
}
