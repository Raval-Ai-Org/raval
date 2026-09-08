import { safeParseJson } from "@/lib/ai/json";

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

export class AnthropicGatewayError extends Error {
  status: number;
  code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "AnthropicGatewayError";
    this.status = status;
    this.code = code;
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

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new AnthropicGatewayError(504, timeoutMessage, "timeout");
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new AnthropicGatewayError(
      502,
      `Claude request failed while contacting the API: ${message.slice(0, 200)}`,
      "network_error",
    );
  } finally {
    clearTimeout(timer);
  }
}

async function requestClaude(
  payload: Record<string, unknown>,
  timeoutMs = 60_000,
  route = "unknown",
): Promise<any> {
  const apiKey = getAnthropicKey();
  const url = "https://api.anthropic.com/v1/messages";

  let lastError: unknown;
  const retries = 2;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchWithTimeout(
        url,
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
        timeoutMs,
        "Claude did not respond in time. Please retry.",
      );

      if (!res.ok) {
        const raw = await res.text().catch(() => "");
        const message = raw.slice(0, 300);
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
        if (isRetryableStatus(status) && attempt < retries) {
          const delayMs = 500 * Math.pow(2, attempt);
          await sleep(delayMs);
          continue;
        }
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
          message || "Claude request failed.",
          "provider_error",
        );
      }

      let json: any;
      try {
        json = await res.json();
      } catch {
        throw new AnthropicGatewayError(
          502,
          "Claude returned malformed JSON.",
          "malformed_response",
        );
      }

      if (!json?.content || !Array.isArray(json.content)) {
        throw new AnthropicGatewayError(
          502,
          "Claude returned an unexpected response shape.",
          "malformed_response",
        );
      }

      return json;
    } catch (error) {
      lastError = error;
      if (error instanceof AnthropicGatewayError && !isRetryableStatus(error.status)) {
        throw error;
      }
      if (attempt >= retries) {
        throw error instanceof AnthropicGatewayError
          ? error
          : new AnthropicGatewayError(502, "Claude request failed unexpectedly.", "provider_error");
      }
      await sleep(500 * Math.pow(2, attempt));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new AnthropicGatewayError(502, "Claude request failed unexpectedly.", "provider_error");
}

export async function claudeTextPrompt(opts: {
  route: string;
  system: string;
  user: string;
  model?: string;
  maxTokens?: number;
}): Promise<string> {
  const model = opts.model ?? selectClaudeModel("default");
  const response = await requestClaude(
    {
      model,
      max_tokens: Math.max(256, Math.min(opts.maxTokens ?? 1800, 8192)),
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
    },
    60_000,
    opts.route,
  );

  const parts = response?.content ?? [];
  const text = parts
    .map((part: any) => (part?.type === "text" ? part.text : ""))
    .join("")
    .trim();

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
