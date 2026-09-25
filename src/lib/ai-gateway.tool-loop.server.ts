// ai-gateway.tool-loop.server.ts — a metered, bounded tool-use loop over
// OpenRouter chat completions (OpenAI function-calling format). Used by the
// GEO Engineer (src/server/geo/agents/).
//
// Rules that keep reasoning models working across turns:
//   - tool_choice is always "auto": Claude Opus 5.5 rejects forced tool use.
//   - Each assistant turn is appended exactly as the API returned it,
//     `reasoning_details` included, and sent back unchanged. Opus rejects
//     replayed reasoning that was altered or dropped, so the conversation is
//     append-only and earlier turns are never edited.
//   - The first turn may fail over along the plan's model list; after that the
//     conversation stays on the model that answered, so reasoning is only ever
//     replayed to the model that produced it.
//   - Only tool/transition summaries leave this loop (ToolLoopTurn.toolCalls);
//     reasoning is never logged or surfaced.
import "server-only";
import { BudgetExceededError, checkBudget } from "@/server/ai/budget";
import { recordUsage } from "@/server/ai/metering";
import { planFor, type Effort } from "@/server/ai/task-models";
import {
  AiGatewayError,
  buildRequestBody,
  completionCost,
  sendCompletion,
  type ContentPart,
  type OpenRouterUsage,
} from "./ai-gateway.server";

/** A tool the model may call. `input_schema` is a JSON Schema object. */
export type LlmTool = {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  /** Schema-valid tool inputs (requires additionalProperties: false + required). */
  strict?: boolean;
};

export type LlmToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type LlmLoopMessage =
  | { role: "user"; content: string | ContentPart[] }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: LlmToolCall[];
      /** Opaque; replayed unchanged. */
      reasoning_details?: unknown[];
      [key: string]: unknown;
    }
  | { role: "tool"; tool_call_id: string; content: string };

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
  messages: LlmLoopMessage[];
};

export type LlmToolLoopOpts = {
  /** Metering route label; the model plan comes from it. */
  route: string;
  system: string;
  tools: LlmTool[];
  /** Conversation so far (resumable from a checkpoint). Never mutated. */
  messages: LlmLoopMessage[];
  handleTool: (name: string, input: unknown) => Promise<ToolOutcome>;
  /** Calling one of these (with a non-error outcome) ends the loop with a submission. */
  terminalTools: string[];
  maxTurns: number;
  maxTokensPerTurn?: number;
  maxCostUsd: number;
  /** Absolute wall-clock deadline (ms since epoch). */
  deadlineAt: number;
  /** Overrides the route plan's effort for this loop. */
  effort?: Effort;
  workspaceId?: string | null;
  userId?: string | null;
  maxToolResultChars?: number;
  maxParallelTools?: number;
  isCancelled?: () => boolean | Promise<boolean>;
  onTurn?: (turn: ToolLoopTurn) => Promise<void> | void;
};

export type LlmToolLoopResult = {
  status: "submitted" | "max_turns" | "budget" | "deadline" | "cancelled" | "no_submission";
  submission: { tool: string; input: unknown } | null;
  messages: LlmLoopMessage[];
  usage: ToolLoopUsage;
  /** The model that answered (the last turn's). */
  model: string;
};

const PER_REQUEST_TIMEOUT_MS = 120_000;

/**
 * True when a stored conversation is in this loop's format. Checkpoints saved
 * by the former Anthropic-format loop are not, and a stage restarts instead of
 * replaying them.
 */
export function isLoopConversation(messages: unknown): messages is LlmLoopMessage[] {
  if (!Array.isArray(messages) || !messages.length) return false;
  return messages.every((m) => {
    if (!m || typeof m !== "object") return false;
    const msg = m as { role?: unknown; content?: unknown };
    if (msg.role === "tool") return true;
    if (msg.role === "assistant") return typeof msg.content === "string" || msg.content === null;
    if (msg.role !== "user") return false;
    if (typeof msg.content === "string") return true;
    // Anthropic-format tool_result blocks are the old shape.
    return (
      Array.isArray(msg.content) &&
      msg.content.every((b) => (b as { type?: string })?.type === "text")
    );
  });
}

function toFunctionTools(tools: LlmTool[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
      ...(t.strict ? { strict: true } : {}),
    },
  }));
}

/**
 * The request messages: the system prompt with a cache breakpoint, then the
 * conversation with one rolling breakpoint on its last user/tool message. The
 * breakpoints are request-only; the stored conversation is never changed.
 */
function requestMessages(system: string, messages: LlmLoopMessage[], anthropic: boolean) {
  const out: unknown[] = [
    anthropic
      ? {
          role: "system",
          content: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        }
      : { role: "system", content: system },
    // `model` is Mellox bookkeeping; the turn goes back exactly as the API sent it.
    ...messages.map((m) => {
      if (m.role !== "assistant" || !("model" in m)) return m;
      const { model: _model, ...turn } = m;
      return turn;
    }),
  ];
  if (!anthropic) return out;
  const lastIndex = out.length - 1;
  const last = out[lastIndex] as LlmLoopMessage;
  if (last.role === "user" || last.role === "tool") {
    const text = typeof last.content === "string" ? last.content : null;
    if (text !== null) {
      out[lastIndex] = {
        ...last,
        content: [{ type: "text", text, cache_control: { type: "ephemeral" } }],
      };
    }
  }
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

function parseArguments(raw: string): unknown {
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

/**
 * A metered, bounded tool-use loop. Every turn is budget-checked and metered;
 * the loop stops at a submission, a turn/cost/deadline cap, or cancellation.
 * Full assistant turns go back unchanged; each tool result is its own `tool`
 * message.
 */
export async function llmToolLoop(opts: LlmToolLoopOpts): Promise<LlmToolLoopResult> {
  const plan = planFor(opts.route);
  const effort = opts.effort ?? plan.effort;
  const maxTokens = Math.max(
    1024,
    Math.min(opts.maxTokensPerTurn ?? plan.maxTokens ?? 16_000, 32_000),
  );
  const maxResult = opts.maxToolResultChars ?? 40_000;
  const terminal = new Set(opts.terminalTools);
  const messages: LlmLoopMessage[] = opts.messages.slice();
  const tools = toFunctionTools(opts.tools);
  const usage: ToolLoopUsage = {
    turns: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0,
  };
  // A resumed conversation that already holds an assistant turn stays on that
  // turn's model; a fresh one may fail over along the plan.
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const resumedModel =
    lastAssistant && typeof lastAssistant.model === "string" ? lastAssistant.model : undefined;
  let models = resumedModel ? [resumedModel] : plan.models;
  let model = models[0];
  const done = (
    status: LlmToolLoopResult["status"],
    submission: LlmToolLoopResult["submission"] = null,
  ): LlmToolLoopResult => ({ status, submission, messages, usage, model });
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

    const body = buildRequestBody({
      plan: { ...plan, models, effort },
      messages: requestMessages(opts.system, messages, models[0].startsWith("anthropic/")),
      maxTokens,
      stream: false,
      tools,
      // The loop needs reasoning_details back to replay them.
      excludeReasoning: false,
    });

    const started = Date.now();
    let response: any;
    try {
      response = await sendCompletion(body, {
        route: opts.route,
        timeoutMs: Math.min(remaining, PER_REQUEST_TIMEOUT_MS),
        retries: 2,
        retryOnTimeout: true,
      });
    } catch (error) {
      recordUsage({
        provider: "openrouter",
        model,
        route: opts.route,
        status: "error",
        latencyMs: Date.now() - started,
        workspaceId: opts.workspaceId,
        userId: opts.userId,
      });
      throw error;
    }

    const answered: string =
      typeof response?.model === "string" && response.model ? response.model : models[0];
    model = answered;
    models = [answered];

    const u: OpenRouterUsage = response?.usage ?? {};
    const turnCost = completionCost(answered, u);
    const cacheRead = u.prompt_tokens_details?.cached_tokens ?? 0;
    const cacheWrite = u.prompt_tokens_details?.cache_write_tokens ?? 0;
    usage.turns = turn;
    usage.inputTokens += u.prompt_tokens ?? 0;
    usage.outputTokens += u.completion_tokens ?? 0;
    usage.cacheReadTokens += cacheRead;
    usage.cacheWriteTokens += cacheWrite;
    usage.costUsd = Math.round((usage.costUsd + (turnCost ?? 0)) * 1e6) / 1e6;
    const choice = response?.choices?.[0];
    const stopReason: string = choice?.finish_reason ?? "unknown";
    recordUsage({
      provider: "openrouter",
      model: answered,
      route: opts.route,
      inputTokens: u.prompt_tokens,
      outputTokens: u.completion_tokens,
      estCostUsd: turnCost,
      truncated: stopReason === "length",
      latencyMs: Date.now() - started,
      status: "ok",
      workspaceId: opts.workspaceId,
      userId: opts.userId,
    });

    const message = choice?.message ?? {};
    if (
      stopReason === "content_filter" ||
      (typeof message.refusal === "string" && message.refusal)
    ) {
      throw new AiGatewayError(
        422,
        `The AI model declined the request for ${opts.route}.`,
        "refusal",
      );
    }
    if (stopReason === "length") {
      throw new AiGatewayError(
        502,
        `The AI model's turn for ${opts.route} was cut off before it finished.`,
        "max_tokens",
      );
    }
    if (stopReason === "error") {
      throw new AiGatewayError(
        502,
        `The AI provider failed mid-turn for ${opts.route}.`,
        "provider_error",
      );
    }

    // Appended exactly as returned (reasoning_details included), plus the
    // answering model so a resumed run stays on it.
    const assistant: LlmLoopMessage = {
      ...message,
      role: "assistant",
      content: typeof message.content === "string" ? message.content : null,
      model: answered,
    };
    messages.push(assistant);

    const toolUses: LlmToolCall[] = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    const toolCalls: ToolLoopTurn["toolCalls"] = [];

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

    let submission: LlmToolLoopResult["submission"] = null;
    const results = await runLimited(toolUses, opts.maxParallelTools ?? 4, async (call) => {
      const name = call.function?.name ?? "";
      let outcome: ToolOutcome;
      let input: unknown;
      try {
        input = parseArguments(call.function?.arguments ?? "");
        outcome = await opts.handleTool(name, input);
      } catch (error) {
        outcome = {
          content:
            error instanceof SyntaxError
              ? "The tool arguments were not valid JSON. Call the tool again with valid JSON arguments."
              : error instanceof Error
                ? error.message
                : "The tool failed.",
          isError: true,
          summary: `${name} failed`,
        };
      }
      if (terminal.has(name) && !outcome.isError && !submission) {
        submission = { tool: name, input };
      }
      toolCalls.push({ name, summary: outcome.summary, isError: Boolean(outcome.isError) });
      const text =
        outcome.content.length > maxResult
          ? `${outcome.content.slice(0, maxResult)}\n…[truncated ${outcome.content.length - maxResult} characters]`
          : outcome.content;
      return {
        role: "tool",
        tool_call_id: call.id,
        content: outcome.isError ? `Error: ${text}` : text,
      } satisfies LlmLoopMessage;
    });
    messages.push(...results);
    await opts.onTurn?.({ turn, usage: { ...usage }, toolCalls, stopReason, messages });
    if (submission) return done("submitted", submission);
  }
  return done("max_turns");
}
