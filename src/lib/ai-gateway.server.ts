// Central AI text gateway — OpenRouter only.
//
// Every paid text, vision and tool call in Mellox goes through this file (the
// GEO agent's tool loop lives beside it in ai-gateway.tool-loop.server.ts and
// uses the same transport). Callers name a metering `route`; the model list,
// reasoning effort, fallbacks and token ceiling come from the route's plan in
// src/server/ai/task-models.ts. No call site names a model.
//
// Every call goes through the same pipeline:
//   budget check (src/server/ai/budget.ts) → route plan (degraded past the
//   spend ceiling) → shared cache (per tenant) → in-flight dedupe → OpenRouter
//   (`models` fallback, `reasoning.effort`, `data_collection: deny`) →
//   truncation/refusal detection → usage metering from `usage.cost`, recorded
//   against the model that actually answered.
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
import {
  effectivePlan,
  escalatedPlan,
  planFor,
  type Effort,
  type TaskPlan,
} from "@/server/ai/task-models";
import { getRequestScope } from "@/server/request-context";
import { getAppUrl } from "@/server/env";
import { humanizeText } from "@/lib/ai/humanize-text";
import { safeParseJson } from "@/lib/ai/json";
import { logGuardrailEvent } from "@/server/guardrails/events";

export const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

/**
 * The chat model picker's allow-list: the browser sends an id, never a model.
 * Each id maps to a route label, and the route's plan picks the model.
 */
export const CHAT_ROUTE_CHOICES: Record<string, "chat" | "chat.pro"> = {
  "mellox-flash": "chat",
  "mellox-pro": "chat.pro",
};

const REFERER = getAppUrl();
const APP_TITLE = "Mellox AI";

export type ContentPart = {
  type: string;
  text?: string;
  image_url?: { url: string };
  cache_control?: { type: "ephemeral" };
};

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | ContentPart[];
};

/**
 * Answer-size class. Reasoning models spend part of `max_tokens` thinking, so
 * the gateway adds the effort's reasoning headroom on top of the answer size
 * a caller asks for (see tokenCeiling).
 */
export type TokenTask = "chat" | "generate" | "extraction";

const ANSWER_BUDGETS: Record<TokenTask, { default: number; max: number }> = {
  chat: { default: 1_500, max: 4_000 },
  generate: { default: 1_200, max: 8_000 },
  extraction: { default: 2_400, max: 8_192 },
};
/** Reasoning tokens count against max_tokens; this much is added per effort. */
const REASONING_HEADROOM: Record<Effort, number> = { low: 2_048, medium: 6_144, high: 12_288 };
/** The tiers' smallest completion limit (Gemini 3.x: 65,536). */
const MAX_OUTPUT_TOKENS = 64_000;
/** Answer cap while degraded past a spend ceiling (reasoning headroom still added). */
const DEGRADED_MAX_TOKENS = 1_000;

export type JsonSchemaFormat = {
  type: "json_schema";
  json_schema: { name: string; strict?: boolean; schema: Record<string, unknown> };
};

export type ChatOptions = {
  /** Metering route label; picks the model plan (src/server/ai/task-models.ts). */
  route: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  /** Answer tokens wanted; the gateway adds reasoning headroom. */
  max_tokens?: number;
  /** A total ceiling (reasoning + answer) that replaces the computed one. */
  maxTotalTokens?: number;
  /** Which answer-size class applies. Default: "generate" (non-stream), "chat" (stream). */
  task?: TokenTask;
  response_format?: { type: "json_object" } | JsonSchemaFormat;
  tools?: unknown[];
  /** Apply the route's documented escalation rule (see escalatedPlan). */
  escalate?: boolean;
  /**
   * Server-only explicit plan, for the rare caller that must ask one specific
   * model (GEO answer-engine probes). Never populated from browser input.
   */
  plan?: TaskPlan;
  /** Index of the message that ends the stable, cacheable prefix. */
  cacheBreakpoint?: number;
  /** Input character budget for trimMessages (default by task). */
  inputChars?: number;
  /** Skip the response cache entirely (read and write). */
  noCache?: boolean;
  /**
   * The user explicitly asked for a new take ("regenerate"): skip the cached
   * answer, nudge temperature up, and store the fresh result.
   */
  regenerate?: boolean;
  /** Cache TTL in ms (default 30 minutes). */
  cacheTtlMs?: number;
  timeoutMs?: number;
  retries?: number;
  /** A timed-out long generation may already be billed; default true for chat. */
  retryOnTimeout?: boolean;
};

export type CompletionMeta = {
  _cached?: boolean;
  _truncated?: boolean;
  _model?: string;
  _degraded?: boolean;
  _costUsd?: number;
};

// Longer cache = more dedupe = fewer billed calls.
const DEFAULT_CACHE_TTL_MS = 30 * 60 * 1000;
// Hard input cap prevents a runaway context ballooning input tokens.
const MAX_INPUT_CHARS = 16_000;
// Extraction can safely consume a larger crawl (every tier has ~1M context).
const EXTRACTION_MAX_INPUT_CHARS = 60_000;
const CHAT_TIMEOUT_MS = 60_000;
const STREAM_TIMEOUT_MS = 90_000; // time to first byte

export function capTokens(n: number | undefined, task: TokenTask): number {
  const budget = ANSWER_BUDGETS[task];
  if (n == null) return budget.default;
  return Math.min(Math.max(1, Math.floor(n)), budget.max);
}

/** The max_tokens to send: answer size + reasoning headroom, at least the plan's ceiling. */
export function tokenCeiling(opts: {
  requested?: number;
  total?: number;
  task: TokenTask;
  plan: TaskPlan;
  degraded: boolean;
}): number {
  const headroom = opts.plan.effort ? REASONING_HEADROOM[opts.plan.effort] : 0;
  let ceiling: number;
  if (opts.total != null) {
    ceiling = Math.max(256, Math.floor(opts.total), opts.plan.maxTokens ?? 0);
  } else {
    const answer = capTokens(opts.requested, opts.task);
    ceiling = Math.max(answer + headroom, opts.plan.maxTokens ?? 0);
  }
  if (opts.degraded) ceiling = Math.min(ceiling, DEGRADED_MAX_TOKENS + headroom);
  return Math.min(ceiling, MAX_OUTPUT_TOKENS);
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
 * Output order always matches input order; only allocation order changed.
 * A message reduced to a stub can overshoot the budget by up to
 * TRUNCATED_MESSAGE_CHARS — keeping the turn's role legible is worth more
 * than the exact ceiling. Exported for tests.
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

/**
 * Anthropic models cache only what is marked. Put one `cache_control`
 * breakpoint on the message that ends the stable prefix (by default the last
 * of the leading system messages: identity + brand context). Gemini and OpenAI
 * cache implicitly, so for them the only rule is to keep stable content first.
 * Exported for tests.
 */
export function withPromptCache(
  messages: ChatMessage[],
  primaryModel: string,
  breakpoint?: number,
): ChatMessage[] {
  if (!primaryModel.startsWith("anthropic/") || !messages.length) return messages;
  let index = breakpoint;
  if (index == null) {
    index = -1;
    for (let i = 0; i < messages.length && messages[i].role === "system"; i++) index = i;
  }
  if (index < 0 || index >= messages.length) return messages;
  const target = messages[index];
  const parts: ContentPart[] =
    typeof target.content === "string"
      ? [{ type: "text", text: target.content }]
      : target.content.map((p) => ({ ...p }));
  const last = parts.length - 1;
  if (last < 0) return messages;
  parts[last] = { ...parts[last], cache_control: { type: "ephemeral" } };
  const out = messages.slice();
  out[index] = { ...target, content: parts };
  return out;
}

export class AiGatewayError extends UpstreamError {
  constructor(status: number, message: string, code?: string) {
    super(status, message, { provider: "openrouter", code });
    this.name = "AiGatewayError";
  }
}

function transportError(timeoutMessage?: string) {
  return ({ kind, detail }: TransportFailure) =>
    kind === "timeout"
      ? new AiGatewayError(504, timeoutMessage ?? "AI provider timed out. Please retry.", "timeout")
      : new AiGatewayError(502, `Network error contacting AI provider: ${detail}`, "network_error");
}

export function getOpenRouterKey(): string {
  const k = process.env.OPENROUTER_API_KEY?.trim();
  if (!k || k === "sk-or-v1-replace-me-later" || k === "YOUR_KEY_HERE" || !k.startsWith("sk-or-")) {
    throw new AiGatewayError(
      503,
      "AI service is not configured. Set OPENROUTER_API_KEY on the server.",
      "missing_api_key",
    );
  }
  return k;
}

export function openRouterHeaders(key: string): Record<string, string> {
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    "HTTP-Referer": REFERER,
    "X-Title": APP_TITLE,
  };
}

/**
 * One distinct error code per failure a caller or operator acts on
 * differently. Exported for tests (and the image/video clients).
 */
export function mapOpenRouterError(status: number, raw: string): AiGatewayError {
  let message = "";
  let errorType = "";
  try {
    const parsed = JSON.parse(raw) as {
      error?: { message?: string; metadata?: { error_type?: string } };
    };
    message = parsed?.error?.message ?? "";
    errorType = parsed?.error?.metadata?.error_type ?? "";
  } catch {
    message = raw;
  }
  const detail = (message || raw || "").slice(0, 300);
  if (status === 401)
    return new AiGatewayError(
      401,
      "OpenRouter rejected the API key. Update OPENROUTER_API_KEY.",
      "invalid_api_key",
    );
  if (status === 402)
    return new AiGatewayError(
      402,
      "OpenRouter is out of credits. Add credits in OpenRouter (openrouter.ai/settings/credits), then retry.",
      "insufficient_credits",
    );
  if (status === 429)
    return new AiGatewayError(
      429,
      "AI rate limit reached. Please try again in a moment.",
      "rate_limited",
    );
  if (
    /no endpoints found|no allowed providers|no available providers/i.test(detail) ||
    status === 404
  ) {
    return new AiGatewayError(
      503,
      `No OpenRouter provider can serve this request (model slug, required parameters or the data policy): ${detail}`,
      "no_endpoints",
    );
  }
  if (errorType === "context_length_exceeded" || /context length|context window/i.test(detail)) {
    return new AiGatewayError(
      413,
      "The request is larger than the model's context window.",
      "context_exceeded",
    );
  }
  if (status === 403 || errorType === "refusal" || errorType === "content_policy_violation") {
    return new AiGatewayError(422, "The AI model declined this request.", "refusal");
  }
  if (status >= 500)
    return new AiGatewayError(502, detail || "AI provider error", "provider_error");
  return new AiGatewayError(status || 502, detail || "AI provider error", "invalid_request");
}

/* ─────────────────────────── transport (swappable) ─────────────────────────── */

export type TransportOpts = {
  route: string;
  timeoutMs: number;
  retries?: number;
  retryOnTimeout?: boolean;
};

/** Raw chat-completions request; replaceable in tests. Returns the parsed JSON. */
export type LlmTransport = (body: Record<string, unknown>, opts: TransportOpts) => Promise<any>;

async function openRouterTransport(
  body: Record<string, unknown>,
  opts: TransportOpts,
): Promise<any> {
  const key = getOpenRouterKey();
  const res = await fetchWithRetry(
    `${OPENROUTER_BASE}/chat/completions`,
    { method: "POST", headers: openRouterHeaders(key), body: JSON.stringify(body) },
    {
      timeoutMs: opts.timeoutMs,
      retries: opts.retries,
      retryOnTimeout: opts.retryOnTimeout,
      retryableStatuses: [429, 500, 502, 503, 504, 529],
      onTransportError: transportError(),
    },
  );
  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    const error = mapOpenRouterError(res.status, raw);
    console.error("OpenRouter request failed", {
      route: opts.route,
      models: body.models,
      status: res.status,
      code: error.code,
    });
    throw error;
  }
  let json: any;
  try {
    json = await res.json();
  } catch {
    // The model may already have generated (and billed) this answer.
    throw new AiGatewayError(502, "AI provider returned malformed JSON.", "malformed_response");
  }
  if (json?.error && !json?.choices) {
    const code = Number(json.error.code) || 502;
    throw mapOpenRouterError(code, JSON.stringify(json));
  }
  if (!json?.choices?.[0]?.message) {
    throw new AiGatewayError(502, "AI provider returned no completion.", "malformed_response");
  }
  return json;
}

let transportOverride: LlmTransport | null = null;

/** Tests: route every non-streaming request to a fake. Returns a restore function. */
export function setLlmTransport(t: LlmTransport | null): () => void {
  const previous = transportOverride;
  transportOverride = t;
  return () => {
    transportOverride = previous;
  };
}

export function sendCompletion(body: Record<string, unknown>, opts: TransportOpts): Promise<any> {
  return (transportOverride ?? openRouterTransport)(body, opts);
}

/* ─────────────────────────────── request body ─────────────────────────────── */

type BodyArgs = {
  plan: TaskPlan;
  messages: ChatMessage[] | unknown[];
  maxTokens: number;
  stream: boolean;
  temperature?: number;
  responseFormat?: ChatOptions["response_format"];
  tools?: unknown[];
  /** Keep reasoning out of the response (everything except the tool loop). */
  excludeReasoning: boolean;
};

/**
 * The OpenRouter body every call shares. Exported for tests.
 *
 *   models     — primary then fallbacks; OpenRouter fails over natively.
 *   reasoning  — effort only. Claude Opus 5.5 rejects a disabled or manual
 *                thinking budget, so neither is ever sent.
 *   provider   — data_collection "deny" always (customer brand data);
 *                require_parameters whenever a schema or tools must be honoured.
 *   tool_choice — "auto" only: Opus 5.5 rejects forced tool use.
 */
export function buildRequestBody(args: BodyArgs): Record<string, unknown> {
  const strict = Boolean(args.tools?.length) || args.responseFormat?.type === "json_schema";
  const body: Record<string, unknown> = {
    models: args.plan.models,
    messages: args.messages,
    stream: args.stream,
    max_tokens: args.maxTokens,
    usage: { include: true },
    provider: { data_collection: "deny", ...(strict ? { require_parameters: true } : {}) },
  };
  if (args.plan.effort) {
    body.reasoning = {
      effort: args.plan.effort,
      ...(args.excludeReasoning ? { exclude: true } : {}),
    };
  }
  // A sampling knob the fallback may not support would make require_parameters
  // exclude it (GPT-5.6 takes no temperature), so strict calls leave it out.
  if (args.temperature != null && !strict) body.temperature = args.temperature;
  if (args.responseFormat) body.response_format = args.responseFormat;
  if (args.tools?.length) {
    body.tools = args.tools;
    body.tool_choice = "auto";
  }
  if (args.stream) body.stream_options = { include_usage: true };
  return body;
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

export type OpenRouterUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  cost?: number;
  prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
  completion_tokens_details?: { reasoning_tokens?: number };
};

/** USD for one completion: OpenRouter's own `usage.cost` when present, else our estimate. */
export function completionCost(model: string, usage: OpenRouterUsage | undefined): number {
  if (typeof usage?.cost === "number" && Number.isFinite(usage.cost)) return round6(usage.cost);
  const cached = usage?.prompt_tokens_details?.cached_tokens ?? 0;
  return estimateTextCost(model, {
    inputTokens: Math.max(0, (usage?.prompt_tokens ?? 0) - cached),
    // completion_tokens already includes reasoning tokens on OpenRouter.
    outputTokens: usage?.completion_tokens ?? 0,
    cacheReadTokens: cached,
    cacheWriteTokens: usage?.prompt_tokens_details?.cache_write_tokens ?? 0,
  });
}

/** Tenant scope for cache keys: a cached answer is never served across tenants. */
function cacheScope(): string {
  const scope = getRequestScope();
  return scope.workspaceId
    ? `ws:${scope.workspaceId}`
    : scope.userId
      ? `u:${scope.userId}`
      : "anon";
}

type CachedCompletion = { json: any; costUsd: number };

const MID_ANSWER_FAILURE = "The AI provider failed part-way through its answer.";

function resolvePlan(opts: Pick<ChatOptions, "route" | "escalate" | "plan">): TaskPlan {
  if (opts.plan) return opts.plan;
  return opts.escalate ? escalatedPlan(opts.route, true) : planFor(opts.route);
}

/** Non-streaming chat completion. Returns raw OpenAI-shape JSON plus `_`-prefixed metadata. */
export async function chatCompletion(opts: ChatOptions): Promise<any & CompletionMeta> {
  const task: TokenTask = opts.task ?? "generate";
  const isExtraction = task === "extraction";
  const inputBudget =
    opts.inputChars ?? (isExtraction ? EXTRACTION_MAX_INPUT_CHARS : MAX_INPUT_CHARS);
  const route = opts.route;

  const budget = await checkBudget("text");
  const degraded = budget.mode === "degrade";
  const plan = effectivePlan(resolvePlan(opts), degraded);
  const primary = plan.models[0];
  const maxTokens = tokenCeiling({
    requested: opts.max_tokens,
    total: opts.maxTotalTokens,
    task,
    plan,
    degraded,
  });

  // Extraction is deterministic by default — override only if caller sets it.
  let temp = opts.temperature ?? plan.temperature ?? (isExtraction ? 0.2 : undefined);
  if (opts.regenerate) temp = Math.min(1.2, (temp ?? 0.7) + 0.25);

  const body = buildRequestBody({
    plan,
    messages: withPromptCache(
      trimMessages(opts.messages, inputBudget),
      primary,
      opts.cacheBreakpoint,
    ),
    maxTokens,
    stream: false,
    temperature: temp,
    responseFormat: opts.response_format,
    tools: opts.tools,
    excludeReasoning: true,
  });

  // Cache identical requests per tenant. Open tool use is never cached.
  const cacheable = !opts.noCache && !opts.tools?.length;
  let cacheKey = "";
  if (cacheable) {
    // The temperature-jittered body of a regenerate is keyed like the base
    // request, so the fresh answer replaces the one the user rejected.
    const keyBody = { ...body, route, temperature: opts.temperature ?? body.temperature };
    cacheKey = `ai:${await digest(`${cacheScope()}|${JSON.stringify(keyBody)}`)}`;
    if (!opts.regenerate) {
      const hit = await cache.get<CachedCompletion>(cacheKey);
      recordCacheLookup("ai", Boolean(hit));
      if (hit) {
        const model = hit.json?.model ?? primary;
        recordUsage({
          provider: "openrouter",
          model,
          route,
          cached: true,
          savedUsd: hit.costUsd,
          status: degraded ? "degraded" : "ok",
        });
        return { ...hit.json, _cached: true, _model: model, _degraded: degraded, _costUsd: 0 };
      }
    }
  }

  const dedupeKey = cacheable && !opts.regenerate ? `chat:${cacheKey}` : "";
  const attempt = async (): Promise<any> => {
    const started = Date.now();
    let json: any;
    try {
      json = await sendCompletion(body, {
        route,
        timeoutMs: opts.timeoutMs ?? CHAT_TIMEOUT_MS,
        retries: opts.retries,
        retryOnTimeout: opts.retryOnTimeout,
      });
    } catch (error) {
      recordUsage({
        provider: "openrouter",
        model: primary,
        route,
        status: "error",
        latencyMs: Date.now() - started,
      });
      throw error;
    }
    const model: string = typeof json?.model === "string" && json.model ? json.model : primary;
    // A provider that failed mid-generation still answers 200, with partial
    // content and finish_reason "error". That text is never an answer.
    if (json?.choices?.[0]?.finish_reason === "error") {
      recordUsage({
        provider: "openrouter",
        model,
        route,
        inputTokens: json?.usage?.prompt_tokens,
        outputTokens: json?.usage?.completion_tokens,
        estCostUsd: completionCost(model, json?.usage),
        status: "error",
        latencyMs: Date.now() - started,
      });
      throw new AiGatewayError(502, `${MID_ANSWER_FAILURE} Please retry.`, "provider_error");
    }
    const truncated = json?.choices?.[0]?.finish_reason === "length";
    const usage: OpenRouterUsage | undefined = json?.usage;
    const costUsd = completionCost(model, usage);
    if (model !== primary) {
      // Silent reroutes (a fallback, or a safeguard serving an older model) are
      // expected occasionally; log them so a persistent pattern is visible.
      console.info("[ai-gateway] answered by a different model", { route, primary, model });
    }
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
    return {
      ...json,
      _truncated: truncated,
      _model: model,
      _degraded: degraded,
      _costUsd: costUsd,
    };
  };
  // One more attempt after a provider failed mid-answer (metered as an error).
  const run = async () => {
    try {
      return await attempt();
    } catch (error) {
      if (error instanceof AiGatewayError && error.message.startsWith(MID_ANSWER_FAILURE)) {
        return attempt();
      }
      throw error;
    }
  };
  return dedupeKey ? dedupe(dedupeKey, run) : run();
}

/** Extraction/research completion — extraction-scale input and answer budgets. */
export function extractionCompletion(opts: Omit<ChatOptions, "task">): Promise<any> {
  return chatCompletion({ ...opts, task: "extraction" });
}

/* ───────────────────────────────── streaming ───────────────────────────────── */

/** SSE `data:` payload the chat UI reads to offer "Continue" on a cut-off reply. */
export const TRUNCATION_EVENT = JSON.stringify({ mellox: { truncated: true } });

/**
 * Pass OpenAI-shape SSE through while watching it: strips any reasoning the
 * provider streams (it is never shown to users), records usage and the
 * answering model when the stream ends and, when the reply hit the token
 * ceiling, inserts one `{"mellox":{"truncated":true}}` event before `[DONE]`.
 * Exported for tests.
 */
export function meterSseStream(
  upstream: ReadableStream<Uint8Array>,
  onDone: (info: {
    usage?: OpenRouterUsage;
    finishReason?: string;
    outputChars: number;
    model?: string;
  }) => void,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = "";
  let usage: OpenRouterUsage | undefined;
  let finishReason: string | undefined;
  let model: string | undefined;
  let outputChars = 0;
  let finished = false;

  const finish = () => {
    if (finished) return;
    finished = true;
    onDone({ usage, finishReason, outputChars, model });
  };

  const handleLine = (line: string, out: TransformStreamDefaultController<Uint8Array>) => {
    const trimmed = line.trim();
    if (trimmed === "data: [DONE]" && finishReason === "length") {
      out.enqueue(encoder.encode(`data: ${TRUNCATION_EVENT}\n\n`));
    }
    let emit = line;
    if (trimmed.startsWith("data:") && trimmed !== "data: [DONE]") {
      try {
        const payload = JSON.parse(trimmed.slice(5).trim());
        const choice = payload?.choices?.[0];
        if (typeof payload?.model === "string" && payload.model) model = payload.model;
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        if (typeof choice?.delta?.content === "string") outputChars += choice.delta.content.length;
        if (payload?.usage) usage = payload.usage;
        const delta = choice?.delta;
        if (delta && ("reasoning" in delta || "reasoning_details" in delta)) {
          delete delta.reasoning;
          delete delta.reasoning_details;
          // A reasoning-only chunk carries nothing the user should see.
          if (
            delta.content == null &&
            !delta.tool_calls &&
            !choice.finish_reason &&
            !payload.usage
          ) {
            return;
          }
          emit = `data: ${JSON.stringify(payload)}`;
        }
      } catch {
        /* keep-alive comments and partial frames pass through untouched */
      }
    }
    out.enqueue(encoder.encode(`${emit}\n`));
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
  const key = getOpenRouterKey();
  const budget = await checkBudget("text");
  const degraded = budget.mode === "degrade";
  const plan = effectivePlan(resolvePlan(opts), degraded);
  const primary = plan.models[0];
  const maxTokens = tokenCeiling({
    requested: opts.max_tokens,
    total: opts.maxTotalTokens,
    task: opts.task ?? "chat",
    plan,
    degraded,
  });
  const body = buildRequestBody({
    plan,
    messages: withPromptCache(trimMessages(opts.messages), primary, opts.cacheBreakpoint),
    maxTokens,
    stream: true,
    temperature: opts.temperature ?? plan.temperature,
    tools: opts.tools,
    excludeReasoning: true,
  });

  const started = Date.now();
  const route = opts.route;
  // Captured now: the stream finishes after the request scope has closed.
  const scope = getRequestScope();

  // Time-to-first-byte timeout only — we don't want to cut a healthy long stream.
  const upstream = await fetchWithTimeout(
    `${OPENROUTER_BASE}/chat/completions`,
    { method: "POST", headers: openRouterHeaders(key), body: JSON.stringify(body) },
    {
      timeoutMs: STREAM_TIMEOUT_MS,
      onTransportError: transportError("AI provider did not respond in time. Please retry."),
    },
  );

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    recordUsage({
      provider: "openrouter",
      model: primary,
      route,
      status: "error",
      workspaceId: scope.workspaceId ?? null,
      userId: scope.userId ?? null,
    });
    throw mapOpenRouterError(upstream.status, text);
  }

  const metered = meterSseStream(upstream.body, ({ usage, finishReason, outputChars, model }) => {
    const answered = model ?? primary;
    recordUsage({
      provider: "openrouter",
      model: answered,
      route,
      workspaceId: scope.workspaceId ?? null,
      userId: scope.userId ?? null,
      inputTokens: usage?.prompt_tokens,
      outputTokens: usage?.completion_tokens ?? Math.ceil(outputChars / 4),
      estCostUsd: completionCost(answered, usage),
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
      "X-AI-Model": primary,
      ...(degraded ? { "X-Usage-Degraded": "1" } : {}),
    },
  });
}

/* ───────────────────── system + user prompts (llmText / llmJson) ───────────────────── */

/** An image shown to a vision model as a base64 content part. */
export type LlmImageInput = {
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  /** Base64 data, no data: prefix. */
  data: string;
};

/** Per-image and per-request limits that every tier accepts. */
export const LLM_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const LLM_MAX_IMAGES = 20;
/** llmText callers assemble and cap their own prompts; this only stops abuse. */
const PROMPT_MAX_INPUT_CHARS = 400_000;

function userContent(user: string, images?: LlmImageInput[]): string | ContentPart[] {
  if (!images?.length) return user;
  if (images.length > LLM_MAX_IMAGES) {
    throw new AiGatewayError(400, "Too many images for one request.", "too_many_images");
  }
  for (const img of images) {
    if (Math.floor((img.data.length * 3) / 4) > LLM_MAX_IMAGE_BYTES) {
      throw new AiGatewayError(400, "An image is too large to analyse.", "image_too_large");
    }
  }
  return [
    ...images.map((img) => ({
      type: "image_url",
      image_url: { url: `data:${img.mediaType};base64,${img.data}` },
    })),
    { type: "text", text: user },
  ];
}

export type LlmTextOpts = {
  route: string;
  system: string;
  user: string;
  /** Images shown to the model before the user text (vision). */
  images?: LlmImageInput[];
  /**
   * Total output ceiling (reasoning + answer). The route plan's ceiling is the
   * floor, so a caller only raises it.
   */
  maxTokens?: number;
  /**
   * JSON Schema for structured output (response_format json_schema, strict).
   * additionalProperties: false and every property required.
   */
  outputSchema?: Record<string, unknown>;
  /** Apply the route's escalation rule. */
  escalate?: boolean;
  temperature?: number;
  timeoutMs?: number;
  retries?: number;
  /** Use the per-tenant response cache (off by default for these prompts). */
  cache?: boolean;
};

export type LlmTextResult = {
  text: string;
  truncated: boolean;
  /** The model that actually answered. */
  model: string;
  degraded: boolean;
  costUsd: number;
};

/**
 * System + user text completion with budget enforcement, usage metering,
 * refusal and truncation reporting. Past a spend ceiling the call degrades to
 * the route's degraded plan instead of failing.
 */
export async function llmText(opts: LlmTextOpts): Promise<LlmTextResult> {
  const json = await chatCompletion({
    route: opts.route,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: userContent(opts.user, opts.images) },
    ],
    task: "generate",
    // System + user prompts are built and bounded by their callers.
    inputChars: PROMPT_MAX_INPUT_CHARS,
    maxTotalTokens: opts.maxTokens,
    escalate: opts.escalate,
    temperature: opts.temperature,
    response_format: opts.outputSchema
      ? {
          type: "json_schema",
          json_schema: { name: schemaName(opts.route), strict: true, schema: opts.outputSchema },
        }
      : undefined,
    noCache: !opts.cache,
    timeoutMs: opts.timeoutMs ?? 60_000,
    retries: opts.retries,
    // A single long generation that timed out may already be billed; 429, 5xx
    // and 529 are still retried.
    retryOnTimeout: false,
  });
  const choice = json?.choices?.[0];
  const message = choice?.message ?? {};
  const finish: string | undefined = choice?.finish_reason;
  const model: string = json?._model ?? "unknown";

  if (finish === "content_filter" || (typeof message.refusal === "string" && message.refusal)) {
    console.error("AI model declined request", { route: opts.route, model });
    throw new AiGatewayError(422, `The AI model declined to answer for ${opts.route}.`, "refusal");
  }
  const truncated = json?._truncated === true;
  if (truncated && opts.outputSchema) {
    // Truncated structured output is never valid.
    throw new AiGatewayError(
      502,
      `The AI output for ${opts.route} was cut off before completion.`,
      "max_tokens",
    );
  }
  const raw = typeof message.content === "string" ? message.content : "";
  // Em dash is the clearest "AI voice" tell in generated prose; strip it here
  // so every caller gets clean output. Safe for JSON-schema output: it only
  // touches dash characters inside string content, never JSON syntax.
  const text = humanizeText(raw.trim());
  if (!text) {
    throw new AiGatewayError(
      502,
      `The AI model returned empty output for ${opts.route}.`,
      "empty_response",
    );
  }
  return {
    text,
    truncated,
    model,
    degraded: json?._degraded === true,
    costUsd: Number(json?._costUsd ?? 0),
  };
}

function schemaName(route: string): string {
  return route.replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 60) || "output";
}

/** Text-only convenience wrapper. */
export async function llmTextPrompt(opts: LlmTextOpts): Promise<string> {
  return (await llmText(opts)).text;
}

const JSON_ONLY =
  "Return ONLY valid JSON matching the requested schema. Do not wrap in markdown fences. Do not add prose before or after the JSON.";

export type LlmJsonOpts<T> = LlmTextOpts & { fallback: T };

const isCutOff = (error: unknown) => error instanceof AiGatewayError && error.code === "max_tokens";

async function schemaPrompt<T>(opts: LlmJsonOpts<T>, schema: Record<string, unknown>): Promise<T> {
  const call = (maxTokens: number | undefined) =>
    llmText({ ...opts, outputSchema: schema, maxTokens });
  let text: string | null = null;
  let truncated = false;
  try {
    text = (await call(opts.maxTokens)).text;
  } catch (error) {
    if (!isCutOff(error)) throw error;
    truncated = true;
    try {
      text = (await call(Math.min((opts.maxTokens ?? 8_000) * 2, 32_000))).text;
    } catch (retryError) {
      if (!isCutOff(retryError)) throw retryError;
    }
  }
  if (text !== null) {
    const sentinel = Symbol("unparsed");
    const parsed = safeParseJson<T | typeof sentinel>(text, sentinel);
    if (parsed !== sentinel && parsed != null) return parsed as T;
  }
  logGuardrailEvent({
    kind: "parse_failure",
    severity: "warn",
    route: opts.route,
    detail: { fallbackUsed: true, truncated, provider: "openrouter", structured: true },
  });
  return opts.fallback;
}

/**
 * JSON prompt with a safe default. With `outputSchema` the answer is
 * schema-constrained (valid by construction; a cut-off answer is retried once
 * with twice the ceiling). Without one, a parse failure gets one repair
 * attempt; if that also fails the fallback is returned and a `parse_failure`
 * guardrail event is recorded — never silently.
 */
export async function llmJson<T>(opts: LlmJsonOpts<T>): Promise<T> {
  if (opts.outputSchema) return schemaPrompt(opts, opts.outputSchema);
  const system = `${opts.system}\n\n${JSON_ONLY}`;
  const first = await llmText({ ...opts, system });
  const sentinel = Symbol("unparsed");
  const parsed = safeParseJson<T | typeof sentinel>(first.text, sentinel);
  if (parsed !== sentinel && parsed != null) return parsed as T;

  try {
    const second = await llmText({
      ...opts,
      system,
      user: `${opts.user}\n\n## Correction required\n${
        first.truncated
          ? "Your previous answer was cut off. Answer again, more concisely, as complete valid JSON."
          : "Your previous answer was not valid JSON. Answer again with STRICT valid JSON only."
      }`,
      maxTokens: first.truncated ? Math.min((opts.maxTokens ?? 8_000) * 2, 32_000) : opts.maxTokens,
    });
    const repaired = safeParseJson<T | typeof sentinel>(second.text, sentinel);
    if (repaired !== sentinel && repaired != null) return repaired as T;
  } catch (error) {
    if (error instanceof AiGatewayError && error.code !== "empty_response") throw error;
  }

  logGuardrailEvent({
    kind: "parse_failure",
    severity: "warn",
    route: opts.route,
    detail: { fallbackUsed: true, truncated: first.truncated, provider: "openrouter" },
  });
  return opts.fallback;
}

/**
 * Whether a failure is safe to retry (another attempt, another tier). Safe
 * cases never produced billable output: not configured, rate limited, out of
 * credits, unreachable. A malformed-but-generated answer may already be
 * billed, so it surfaces instead of being paid for twice.
 */
export function isRetrySafe(error: unknown): boolean {
  if (!(error instanceof UpstreamError)) return false;
  if (error.code === "malformed_response") return false;
  return [401, 402, 403, 429, 500, 502, 503, 504, 529].includes(error.status);
}
