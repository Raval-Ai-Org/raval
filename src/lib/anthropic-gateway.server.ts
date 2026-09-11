import "server-only";
import { safeParseJson } from "@/lib/ai/json";
import { fetchWithRetry, UpstreamError } from "@/server/upstream";

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

export async function claudeTextPrompt(opts: {
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
}): Promise<string> {
  const model = opts.model ?? selectClaudeModel("default");
  const outputConfig: Record<string, unknown> = {};
  if (opts.effort) outputConfig.effort = opts.effort;
  if (opts.outputSchema) {
    outputConfig.format = { type: "json_schema", schema: opts.outputSchema };
  }
  const response = await requestClaude(
    {
      model,
      max_tokens: Math.max(256, Math.min(opts.maxTokens ?? 1800, 16_000)),
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
      ...(Object.keys(outputConfig).length ? { output_config: outputConfig } : {}),
    },
    opts.timeoutMs ?? 60_000,
    opts.route,
    opts.retries,
  );

  const parts = response?.content ?? [];
  const text = parts
    .map((part: any) => (part?.type === "text" ? part.text : ""))
    .join("")
    .trim();

  const stopReason: unknown = response?.stop_reason;
  if (stopReason === "refusal") {
    console.error("Claude declined request", { route: opts.route, model });
    throw new AnthropicGatewayError(422, `Claude declined to answer for ${opts.route}.`, "refusal");
  }
  if (stopReason === "max_tokens") {
    console.error("Claude output truncated at max_tokens", {
      route: opts.route,
      model,
      maxTokens: opts.maxTokens,
      outputTokens: response?.usage?.output_tokens,
    });
    // Truncated structured output is never valid; free-text callers keep the
    // partial text (existing behavior) but the truncation is now logged.
    if (opts.outputSchema) {
      throw new AnthropicGatewayError(
        502,
        `Claude output for ${opts.route} was cut off before completion.`,
        "max_tokens",
      );
    }
  }

  if (!text) {
    throw new AnthropicGatewayError(
      502,
      `Claude returned empty output for ${opts.route}.`,
      "empty_response",
    );
  }

  return text;
}

export async function claudeJsonPrompt<T>(opts: {
  route: string;
  system: string;
  user: string;
  fallback: T;
  model?: string;
  maxTokens?: number;
}): Promise<T> {
  const text = await claudeTextPrompt({
    route: opts.route,
    system: `${opts.system}\n\nReturn ONLY valid JSON matching the requested schema. Do not wrap in markdown fences. Do not add prose before or after the JSON.`,
    user: opts.user,
    model: opts.model,
    maxTokens: opts.maxTokens,
  });

  const parsed = safeParseJson<T>(text, opts.fallback);
  return parsed ?? opts.fallback;
}
