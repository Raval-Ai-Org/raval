// High-level AI entry-points. Every route/server-fn that needs a
// structured response or a tool call goes through here — one place to
// tune caching, token caps, models, and telemetry.

import {
  chatCompletion,
  extractionCompletion,
  EXTRACTION_MODEL,
  AiGatewayError,
} from "@/lib/ai-gateway.server";
import { safeParseJson } from "./json";
import { logAiCall } from "./token-log.server";

export { AiGatewayError };

export type RunJsonOpts<T> = {
  route: string;
  system: string;
  user: string;
  fallback: T;
  /** Which model to route to. Default: chat model. */
  model?: string;
  extraction?: boolean;
  maxTokens?: number;
  temperature?: number;
  cacheTtlMs?: number;
  noCache?: boolean;
};

/** Structured-JSON prompt. Always returns a value; falls back on parse errors. */
export async function runJsonPrompt<T>(opts: RunJsonOpts<T>): Promise<T> {
  const messages = [
    { role: "system" as const, content: opts.system },
    { role: "user" as const, content: opts.user },
  ];
  const isExtraction = opts.extraction || opts.model === EXTRACTION_MODEL;
  const inputChars = opts.system.length + opts.user.length;

  try {
    const json = isExtraction
      ? await extractionCompletion({
          messages,
          response_format: { type: "json_object" },
          max_tokens: opts.maxTokens,
          temperature: opts.temperature,
          cacheTtlMs: opts.cacheTtlMs,
          noCache: opts.noCache,
        })
      : await chatCompletion({
          model: opts.model,
          messages,
          response_format: { type: "json_object" },
          max_tokens: opts.maxTokens,
          temperature: opts.temperature,
          cacheTtlMs: opts.cacheTtlMs,
          noCache: opts.noCache,
        });

    const raw = json?.choices?.[0]?.message?.content ?? "";
    const output = String(raw);
    logAiCall({
      route: opts.route,
      model: opts.model ?? (isExtraction ? EXTRACTION_MODEL : "qwen/qwen3-max"),
      inputChars,
      outputChars: output.length,
      cached: json?._cached === true,
    });
    return safeParseJson<T>(output, opts.fallback);
  } catch (e) {
    // Callers see AiGatewayError so they can return 429/402 correctly.
    if (e instanceof AiGatewayError) throw e;
    console.error(`[ai/runJsonPrompt] ${opts.route} failed`, e);
    return opts.fallback;
  }
}

export type RunToolOpts = {
  route: string;
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  noCache?: boolean;
};

/**
 * Tool-calling entry point. Returns the parsed tool arguments or null when
 * the model chose not to call the tool.
 */
export async function runTool<T>(opts: RunToolOpts): Promise<T | null> {
  const tool = {
    type: "function" as const,
    function: {
      name: opts.name,
      description: opts.description,
      parameters: opts.parameters,
    },
  };
  const inputChars = opts.system.length + opts.user.length;
  const json = await chatCompletion({
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    tools: [tool],
    tool_choice: { type: "function", function: { name: opts.name } },
    max_tokens: opts.maxTokens,
    temperature: opts.temperature,
    noCache: opts.noCache,
  });
  const call = json?.choices?.[0]?.message?.tool_calls?.[0];
  const argsStr = call?.function?.arguments ?? "";
  logAiCall({
    route: opts.route,
    model: "qwen/qwen3-max",
    inputChars,
    outputChars: String(argsStr).length,
    cached: false,
    toolCall: true,
  });
  if (!argsStr) return null;
  return safeParseJson<T | null>(argsStr, null);
}
