import "server-only";
import { humanizeText } from "@/lib/ai/humanize-text";
import { safeParseJson } from "@/lib/ai/json";
import { fetchWithRetry, UpstreamError } from "@/server/upstream";
import { BudgetExceededError, checkBudget } from "@/server/ai/budget";
import { recordUsage } from "@/server/ai/metering";
import { estimateTextCost } from "@/server/ai/pricing";
import { logGuardrailEvent } from "@/server/guardrails/events";

export const CLAUDE_SONNET_MODEL = "claude-sonnet-5";
export const CLAUDE_OPUS_MODEL = "claude-opus-5";

export type ClaudeModelKind = "brand-dna" | "marketing-coach" | "deep-strategy" | "default";

export function selectClaudeModel(
  kind: ClaudeModelKind = "default",
  opts: { isComplexStrategy?: boolean; forceOpus?: boolean } = {},
): string {
  if (opts.forceOpus) return CLAUDE_OPUS_MODEL;
  if (opts.isComplexStrategy || kind === "deep-strategy") return CLAUDE_OPUS_MODEL;
  return CLAUDE_SONNET_MODEL;
}

export class AnthropicGatewayError extends UpstreamError {
  constructor(status: number, message: string, code?: string) {
    super(status, message, { provider: "anthropic", code });
    this.name = "AnthropicGatewayError";
  }
}

function getAnthropicKey(): string {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key || key === "" || key === "replace-me" || key === "YOUR_KEY_HERE") {
    throw new AnthropicGatewayError(
      503,
      "Claude is not configured on the server. Set ANTHROPIC_API_KEY before running the Brand DNA or Marketing Coach flow.",
      "missing_api_key",
    );
  }
  return key;
}

async function requestClaude(
  payload: Record<string, unknown>,
  timeoutMs = 60_000,
  route = "unknown",
  retries?: number,
  retryOnTimeout = true,
): Promise<any> {
  const apiKey = getAnthropicKey();

  const res = await fetchWithRetry(
    "https://api.anthropic.com/v1/messages",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "User-Agent": "MelloxAI/1.0",
      },
      body: JSON.stringify(payload),
    },
    {
      timeoutMs,
      retries,
      retryOnTimeout,
      // Anthropic returns 500 for transient failures, 529 for overload, plus 5xx gateway errors.
      retryableStatuses: [429, 500, 502, 503, 504, 529],
      onTransportError: ({ kind, detail }) =>
        kind === "timeout"
          ? new AnthropicGatewayError(
              504,
              "Claude did not respond in time. Please retry.",
              "timeout",
            )
          : new AnthropicGatewayError(
              502,
              `Claude request failed while contacting the API: ${detail}`,
              "network_error",
            ),
    },
  );

  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    const status = res.status;
    const requestId = res.headers.get("request-id") || res.headers.get("x-request-id");
    console.error("Claude request failed", {
      route,
      provider: "anthropic",
      model: payload.model ?? "unknown",
      status,
      requestId: requestId || undefined,
      category: status === 400 ? "invalid_request" : status === 401 ? "auth" : "provider_error",
    });
    if (status === 401) {
      throw new AnthropicGatewayError(
        401,
        "Claude rejected the API key. Check ANTHROPIC_API_KEY.",
        "invalid_api_key",
      );
    }
    if (status === 429) {
      throw new AnthropicGatewayError(
        429,
        "Claude rate limit reached. Please try again in a moment.",
        "rate_limited",
      );
    }
    if (/credit balance is too low|billing/i.test(raw)) {
      throw new AnthropicGatewayError(
        402,
        "The Anthropic account behind this server has run out of API credits. Add credits in the Anthropic Console (Plans & Billing), then retry.",
        "insufficient_credits",
      );
    }
    throw new AnthropicGatewayError(
      status || 502,
      raw.slice(0, 300) || "Claude request failed.",
      "provider_error",
    );
  }

  let json: any;
  try {
    json = await res.json();
  } catch {
    throw new AnthropicGatewayError(502, "Claude returned malformed JSON.", "malformed_response");
  }
  if (!json?.content || !Array.isArray(json.content)) {
    throw new AnthropicGatewayError(
      502,
      "Claude returned an unexpected response shape.",
      "malformed_response",
    );
  }
  return json;
}

export type ClaudeEffort = "low" | "medium" | "high" | "xhigh" | "max";

export type ClaudeTextOpts = {
  route: string;
  system: string;
  user: string;
  model?: string;
  /**
   * Output ceiling. On Claude Opus 5 adaptive thinking is on by default and its
   * tokens count against this ceiling, so it must cover thinking + the answer.
   */
  maxTokens?: number;
  /** output_config.effort — bounds thinking depth, and with it latency and spend. */
  effort?: ClaudeEffort;
  /**
   * JSON Schema for structured output (output_config.format). Only the subset the
   * API supports: no string-length or numeric constraints, additionalProperties: false.
   */
  outputSchema?: Record<string, unknown>;
  timeoutMs?: number;
  retries?: number;
};

export type ClaudeTextResult = {
  text: string;
  truncated: boolean;
  model: string;
  degraded: boolean;
};

/** Output cap while a workspace is past its spend ceiling. */
const DEGRADED_MAX_TOKENS = 1_500;

/**
 * Claude text completion with budget enforcement, usage metering and
 * truncation reporting. Past a spend ceiling the call degrades (Opus → Sonnet,
 * smaller output cap) instead of failing.
 */
export async function claudeTextCompletion(opts: ClaudeTextOpts): Promise<ClaudeTextResult> {
  let model = opts.model ?? selectClaudeModel("default");
  let maxTokens = Math.max(256, Math.min(opts.maxTokens ?? 1800, 16_000));
  const budget = await checkBudget("text");
  const degraded = budget.mode === "degrade";
  if (degraded) {
    if (model === CLAUDE_OPUS_MODEL) model = CLAUDE_SONNET_MODEL;
    maxTokens = Math.min(maxTokens, DEGRADED_MAX_TOKENS);
  }

  const outputConfig: Record<string, unknown> = {};
  if (opts.effort) outputConfig.effort = degraded && opts.effort !== "low" ? "medium" : opts.effort;
  if (opts.outputSchema) {
    outputConfig.format = { type: "json_schema", schema: opts.outputSchema };
  }
  const started = Date.now();
  let response: any;
  try {
    response = await requestClaude(
      {
        model,
        max_tokens: maxTokens,
        system: opts.system,
        messages: [{ role: "user", content: opts.user }],
        ...(Object.keys(outputConfig).length ? { output_config: outputConfig } : {}),
      },
      opts.timeoutMs ?? 60_000,
      opts.route,
      opts.retries,
      // A single long generation that timed out may already be billed; 429,
      // 5xx and 529 are still retried.
      false,
    );
  } catch (error) {
    recordUsage({
      provider: "anthropic",
      model,
      route: opts.route,
      status: "error",
      latencyMs: Date.now() - started,
    });
    throw error;
  }

  const parts = response?.content ?? [];
  // Em dash is the clearest "AI voice" tell in generated prose; strip it here
  // so every caller (claudeTextPrompt, claudeJsonPrompt, claudeSchemaPrompt)
  // gets clean output for free. Safe even for JSON-schema output: this only
  // touches em/en-dash characters inside string content, never structural
  // JSON syntax. claudeToolLoop (code/patch generation) calls its own
  // transport directly and never passes through here, so this never touches
  // generated code.
  const text = humanizeText(
    parts
      .map((part: any) => (part?.type === "text" ? part.text : ""))
      .join("")
      .trim(),
  );

  const stopReason: unknown = response?.stop_reason;
  const truncated = stopReason === "max_tokens";
  const usage = response?.usage ?? {};
  recordUsage({
    provider: "anthropic",
    model,
    route: opts.route,
    inputTokens: (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0),
    outputTokens: usage.output_tokens,
    estCostUsd: estimateTextCost(model, {
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
    }),
    truncated,
    latencyMs: Date.now() - started,
    status: degraded ? "degraded" : "ok",
  });

  if (stopReason === "refusal") {
    console.error("Claude declined request", { route: opts.route, model });
    throw new AnthropicGatewayError(422, `Claude declined to answer for ${opts.route}.`, "refusal");
  }
  if (truncated && opts.outputSchema) {
    // Truncated structured output is never valid.
    throw new AnthropicGatewayError(
      502,
      `Claude output for ${opts.route} was cut off before completion.`,
      "max_tokens",
    );
  }

  if (!text) {
    throw new AnthropicGatewayError(
      502,
      `Claude returned empty output for ${opts.route}.`,
      "empty_response",
    );
  }

  return { text, truncated, model, degraded };
}

/* ───────────────────────── Tool-use loop (agents) ───────────────────────── */

export type ClaudeTool = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  /** Schema-valid tool inputs (requires additionalProperties: false + required). */
  strict?: boolean;
};

export type ClaudeBlock = { type: string; [key: string]: unknown };
export type ClaudeMessage = { role: "user" | "assistant"; content: string | ClaudeBlock[] };

export type ToolOutcome = {
  /** What the model sees. */
  content: string;
  isError?: boolean;
  /** One line for the activity log — never the model's reasoning. */
  summary: string;
  detail?: Record<string, unknown>;
};

export type ToolLoopUsage = {
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
};

export type ToolLoopTurn = {
  turn: number;
  usage: ToolLoopUsage;
  toolCalls: { name: string; summary: string; isError: boolean }[];
  stopReason: string;
  messages: ClaudeMessage[];
};

export type ClaudeToolLoopOpts = {
  route: string;
  model?: string;
  system: string;
  tools: ClaudeTool[];
  /** Conversation so far (resumable from a checkpoint). Never mutated. */
  messages: ClaudeMessage[];
  handleTool: (name: string, input: unknown) => Promise<ToolOutcome>;
  /** Calling one of these (with a non-error outcome) ends the loop with a submission. */
  terminalTools: string[];
  maxTurns: number;
  maxTokensPerTurn?: number;
  maxCostUsd: number;
  /** Absolute wall-clock deadline (ms since epoch). */
  deadlineAt: number;
  effort?: ClaudeEffort;
  workspaceId?: string | null;
  userId?: string | null;
  maxToolResultChars?: number;
  maxParallelTools?: number;
  isCancelled?: () => boolean | Promise<boolean>;
  onTurn?: (turn: ToolLoopTurn) => Promise<void> | void;
};

export type ClaudeToolLoopResult = {
  status: "submitted" | "max_turns" | "budget" | "deadline" | "cancelled" | "no_submission";
  submission: { tool: string; input: unknown } | null;
  messages: ClaudeMessage[];
  usage: ToolLoopUsage;
  model: string;
};

/** Raw request function; replaceable in tests. */
export type ClaudeTransport = (
  payload: Record<string, unknown>,
  timeoutMs: number,
  route: string,
  retries?: number,
) => Promise<any>;

let transportOverride: ClaudeTransport | null = null;

/** Tests: route Claude requests to a fake. Returns a restore function. */
export function setClaudeTransport(t: ClaudeTransport | null): () => void {
  const previous = transportOverride;
  transportOverride = t;
  return () => {
    transportOverride = previous;
  };
}

const PER_REQUEST_TIMEOUT_MS = 120_000;

/** Put one cache breakpoint on the last block of the last message (rolling). */
function withRollingCache(messages: ClaudeMessage[]): ClaudeMessage[] {
  if (!messages.length) return messages;
  const out = messages.slice();
  const last = out[out.length - 1];
  const blocks: ClaudeBlock[] =
    typeof last.content === "string"
      ? [{ type: "text", text: last.content }]
      : last.content.map((b) => ({ ...b }));
  const i = blocks.length - 1;
  if (i >= 0 && blocks[i].type !== "thinking" && blocks[i].type !== "redacted_thinking") {
    blocks[i] = { ...blocks[i], cache_control: { type: "ephemeral" } };
  }
  out[out.length - 1] = { role: last.role, content: blocks };
  return out;
}

async function runLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/**
 * A metered, bounded tool-use loop. Every turn is budget-checked and metered;
 * the loop stops at a submission, a turn/cost/deadline cap, or cancellation.
 * Full assistant content (thinking blocks included) is appended back
 * unchanged, and all tool results for a turn go back in one user message.
 */
export async function claudeToolLoop(opts: ClaudeToolLoopOpts): Promise<ClaudeToolLoopResult> {
  const model = opts.model ?? CLAUDE_SONNET_MODEL;
  const maxTokens = Math.max(1024, Math.min(opts.maxTokensPerTurn ?? 16_000, 32_000));
  const maxResult = opts.maxToolResultChars ?? 40_000;
  const terminal = new Set(opts.terminalTools);
  const messages: ClaudeMessage[] = opts.messages.slice();
  const usage: ToolLoopUsage = {
    turns: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
  };
  const done = (
    status: ClaudeToolLoopResult["status"],
    submission: ClaudeToolLoopResult["submission"] = null,
  ): ClaudeToolLoopResult => ({ status, submission, messages, usage, model });
  const send = transportOverride ?? requestClaude;
  let nudged = false;

  for (let turn = 1; turn <= opts.maxTurns; turn++) {
    if (await opts.isCancelled?.()) return done("cancelled");
    const remaining = opts.deadlineAt - Date.now();
    if (remaining <= 1_000) return done("deadline");
    if (usage.costUsd >= opts.maxCostUsd) return done("budget");

    const budget = await checkBudget("text", {
      workspaceId: opts.workspaceId,
      userId: opts.userId,
    });
    if (budget.mode === "block") {
      throw new BudgetExceededError(
        "text",
        budget.reason ?? "AI allowance reached for this period.",
      );
    }
    // A degraded workspace doesn't get a long agent run on a smaller budget.
    if (budget.mode === "degrade") return done("budget");

    const payload: Record<string, unknown> = {
      model,
      max_tokens: maxTokens,
      system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
      tools: opts.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
        ...(t.strict ? { strict: true } : {}),
      })),
      tool_choice: { type: "auto" },
      messages: withRollingCache(messages),
      ...(opts.effort ? { output_config: { effort: opts.effort } } : {}),
    };

    const started = Date.now();
    let response: any;
    try {
      response = await send(payload, Math.min(remaining, PER_REQUEST_TIMEOUT_MS), opts.route, 2);
    } catch (error) {
      recordUsage({
        provider: "anthropic",
        model,
        route: opts.route,
        status: "error",
        latencyMs: Date.now() - started,
        workspaceId: opts.workspaceId,
        userId: opts.userId,
      });
      throw error;
    }

    const u = response?.usage ?? {};
    const turnCost = estimateTextCost(model, {
      inputTokens: u.input_tokens ?? 0,
      outputTokens: u.output_tokens ?? 0,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
    });
    usage.turns = turn;
    usage.inputTokens += u.input_tokens ?? 0;
    usage.outputTokens += u.output_tokens ?? 0;
    usage.cacheReadTokens += u.cache_read_input_tokens ?? 0;
    usage.cacheWriteTokens += u.cache_creation_input_tokens ?? 0;
    usage.costUsd = Math.round((usage.costUsd + (turnCost ?? 0)) * 1e6) / 1e6;
    const stopReason: string = response?.stop_reason ?? "unknown";
    recordUsage({
      provider: "anthropic",
      model,
      route: opts.route,
      inputTokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
      outputTokens: u.output_tokens,
      estCostUsd: turnCost,
      truncated: stopReason === "max_tokens",
      latencyMs: Date.now() - started,
      status: "ok",
      workspaceId: opts.workspaceId,
      userId: opts.userId,
    });

    if (stopReason === "refusal") {
      throw new AnthropicGatewayError(
        422,
        `Claude declined the request for ${opts.route}.`,
        "refusal",
      );
    }
    if (stopReason === "model_context_window_exceeded") {
      throw new AnthropicGatewayError(
        413,
        "The investigation grew past the model's context window.",
        "context_exceeded",
      );
    }
    const content: ClaudeBlock[] = Array.isArray(response?.content) ? response.content : [];
    if (stopReason === "max_tokens") {
      throw new AnthropicGatewayError(
        502,
        `Claude's turn for ${opts.route} was cut off before it finished.`,
        "max_tokens",
      );
    }
    messages.push({ role: "assistant", content });

    const toolUses = content.filter((b) => b.type === "tool_use") as (ClaudeBlock & {
      id: string;
      name: string;
      input: unknown;
    })[];
    const toolCalls: ToolLoopTurn["toolCalls"] = [];

    if (stopReason === "pause_turn") {
      await opts.onTurn?.({ turn, usage: { ...usage }, toolCalls, stopReason, messages });
      continue;
    }

    if (!toolUses.length) {
      await opts.onTurn?.({ turn, usage: { ...usage }, toolCalls, stopReason, messages });
      if (nudged) return done("no_submission");
      nudged = true;
      messages.push({
        role: "user",
        content: `Finish by calling ${opts.terminalTools.map((t) => `\`${t}\``).join(" or ")} with your result.`,
      });
      continue;
    }

    let submission: ClaudeToolLoopResult["submission"] = null;
    const results = await runLimited(toolUses, opts.maxParallelTools ?? 4, async (call) => {
      let outcome: ToolOutcome;
      try {
        outcome = await opts.handleTool(call.name, call.input);
      } catch (error) {
        outcome = {
          content: error instanceof Error ? error.message : "The tool failed.",
          isError: true,
          summary: `${call.name} failed`,
        };
      }
      if (terminal.has(call.name) && !outcome.isError && !submission) {
        submission = { tool: call.name, input: call.input };
      }
      toolCalls.push({
        name: call.name,
        summary: outcome.summary,
        isError: Boolean(outcome.isError),
      });
      const text =
        outcome.content.length > maxResult
          ? `${outcome.content.slice(0, maxResult)}\n…[truncated ${outcome.content.length - maxResult} characters]`
          : outcome.content;
      return {
        type: "tool_result",
        tool_use_id: call.id,
        content: text,
        ...(outcome.isError ? { is_error: true } : {}),
      } satisfies ClaudeBlock;
    });
    messages.push({ role: "user", content: results });
    await opts.onTurn?.({ turn, usage: { ...usage }, toolCalls, stopReason, messages });
    if (submission) return done("submitted", submission);
  }
  return done("max_turns");
}

/** Text-only convenience wrapper (existing callers). */
export async function claudeTextPrompt(opts: ClaudeTextOpts): Promise<string> {
  return (await claudeTextCompletion(opts)).text;
}

const JSON_ONLY =
  "Return ONLY valid JSON matching the requested schema. Do not wrap in markdown fences. Do not add prose before or after the JSON.";

export type ClaudeJsonPromptOpts<T> = {
  route: string;
  system: string;
  user: string;
  fallback: T;
  model?: string;
  maxTokens?: number;
  effort?: ClaudeEffort;
  /**
   * JSON Schema for structured output. The answer is then valid JSON by
   * construction, so no parse-repair call is made; an answer cut off at the
   * ceiling is retried once with twice the ceiling.
   */
  outputSchema?: Record<string, unknown>;
  timeoutMs?: number;
  retries?: number;
};

const isCutOff = (error: unknown) =>
  error instanceof AnthropicGatewayError && error.code === "max_tokens";

async function claudeSchemaPrompt<T>(
  opts: ClaudeJsonPromptOpts<T>,
  schema: Record<string, unknown>,
): Promise<T> {
  const maxTokens = opts.maxTokens ?? 1800;
  const call = (ceiling: number) =>
    claudeTextCompletion({
      route: opts.route,
      system: opts.system,
      user: opts.user,
      model: opts.model,
      maxTokens: ceiling,
      effort: opts.effort,
      outputSchema: schema,
      timeoutMs: opts.timeoutMs,
      retries: opts.retries,
    });
  let text: string | null = null;
  let truncated = false;
  try {
    text = (await call(maxTokens)).text;
  } catch (error) {
    if (!isCutOff(error)) throw error;
    truncated = true;
    try {
      text = (await call(Math.min(maxTokens * 2, 16_000))).text;
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
    detail: { fallbackUsed: true, truncated, provider: "anthropic", structured: true },
  });
  return opts.fallback;
}

/**
 * Claude JSON prompt with a safe default. With `outputSchema` the answer is
 * schema-constrained (see claudeSchemaPrompt). Without one, a parse failure
 * gets one repair attempt (with a larger budget if the first answer was cut
 * off); if that also fails the fallback is returned and a `parse_failure`
 * guardrail event is recorded — never silently.
 */
export async function claudeJsonPrompt<T>(opts: ClaudeJsonPromptOpts<T>): Promise<T> {
  if (opts.outputSchema) return claudeSchemaPrompt(opts, opts.outputSchema);
  const system = `${opts.system}\n\n${JSON_ONLY}`;
  const first = await claudeTextCompletion({
    route: opts.route,
    system,
    user: opts.user,
    model: opts.model,
    maxTokens: opts.maxTokens,
  });
  const sentinel = Symbol("unparsed");
  const parsed = safeParseJson<T | typeof sentinel>(first.text, sentinel);
  if (parsed !== sentinel && parsed != null) return parsed as T;

  try {
    const second = await claudeTextCompletion({
      route: opts.route,
      system,
      user: `${opts.user}\n\n## Correction required\n${
        first.truncated
          ? "Your previous answer was cut off. Answer again, more concisely, as complete valid JSON."
          : "Your previous answer was not valid JSON. Answer again with STRICT valid JSON only."
      }`,
      model: opts.model,
      maxTokens: first.truncated ? Math.min((opts.maxTokens ?? 1800) * 2, 16_000) : opts.maxTokens,
    });
    const repaired = safeParseJson<T | typeof sentinel>(second.text, sentinel);
    if (repaired !== sentinel && repaired != null) return repaired as T;
  } catch (error) {
    if (error instanceof AnthropicGatewayError && error.code !== "empty_response") throw error;
  }

  logGuardrailEvent({
    kind: "parse_failure",
    severity: "warn",
    route: opts.route,
    detail: { fallbackUsed: true, truncated: first.truncated, provider: "anthropic" },
  });
  return opts.fallback;
}
