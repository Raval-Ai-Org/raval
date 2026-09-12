// High-level AI entry-points. Every route/server-fn that needs a
// structured response or a tool call goes through here — one place to
// tune caching, token caps, models, and telemetry. Usage metering happens in
// the gateway (src/lib/ai-gateway.server.ts) for every call.

import "server-only";
import type { ZodType, ZodTypeDef } from "zod";
import {
  chatCompletion,
  extractionCompletion,
  EXTRACTION_MODEL,
  AiGatewayError,
  type TokenTask,
} from "@/lib/ai-gateway.server";
import { logGuardrailEvent } from "@/server/guardrails/events";
import { AiOutputError, parseStructured, runStructured } from "@/server/ai/structured";
import { safeParseJson } from "./json";

export { AiGatewayError, AiOutputError };

type Common = {
  route: string;
  system: string;
  user: string;
  /** Which model to route to. Default: chat model. */
  model?: string;
  extraction?: boolean;
  maxTokens?: number;
  temperature?: number;
  cacheTtlMs?: number;
  noCache?: boolean;
  /** User asked for a new take — bypass the cached answer. */
  regenerate?: boolean;
  task?: TokenTask;
};

export type RunJsonOpts<T> = Common & { fallback: T };

async function callJson(
  opts: Common,
  overrides: { maxTokens: number; repair: boolean; system: string; user: string },
): Promise<{ text: string; truncated: boolean }> {
  const messages = [
    { role: "system" as const, content: overrides.system },
    { role: "user" as const, content: overrides.user },
  ];
  const isExtraction = opts.extraction || opts.model === EXTRACTION_MODEL;
  const common = {
    messages,
    response_format: { type: "json_object" as const },
    max_tokens: overrides.maxTokens,
    temperature: opts.temperature,
    cacheTtlMs: opts.cacheTtlMs,
    // The repair attempt must never be answered from the cache.
    noCache: opts.noCache || overrides.repair,
    regenerate: opts.regenerate && !overrides.repair,
    route: opts.route,
  };
  const json = isExtraction
    ? await extractionCompletion(common)
    : await chatCompletion({ ...common, model: opts.model, task: opts.task ?? "generate" });
  return {
    text: String(json?.choices?.[0]?.message?.content ?? ""),
    truncated: json?._truncated === true,
  };
}

/**
 * Structured-JSON prompt validated against `schema`. One repair attempt, then
 * AiOutputError (502). Use this wherever an unusable answer must not be
 * mistaken for a real one.
 */
export async function runStructuredPrompt<T>(
  opts: Common & { schema: ZodType<T, ZodTypeDef, unknown> },
): Promise<T> {
  const maxTokens = opts.maxTokens ?? 1200;
  return runStructured({
    route: opts.route,
    system: opts.system,
    user: opts.user,
    schema: opts.schema,
    maxTokens,
    maxRepairTokens: Math.min(maxTokens * 2, 6000),
    call: (args) => callJson(opts, args),
  });
}

/**
 * Structured-JSON prompt for callers with a genuinely safe default (UI hints,
 * optional enrichment). A parse failure gets one repair attempt; if that also
 * fails the fallback is returned AND a `parse_failure` guardrail event is
 * recorded — never silently. Provider errors still throw.
 */
export async function runJsonPrompt<T>(opts: RunJsonOpts<T>): Promise<T> {
  const maxTokens = opts.maxTokens ?? 1200;
  const first = await callJson(opts, {
    maxTokens,
    repair: false,
    system: opts.system,
    user: opts.user,
  });
  const sentinel = Symbol("unparsed");
  const parsed = safeParseJson<T | typeof sentinel>(first.text, sentinel);
  if (parsed !== sentinel && parsed != null) return parsed as T;

  try {
    const second = await callJson(opts, {
      maxTokens: first.truncated ? Math.min(maxTokens * 2, 6000) : maxTokens,
      repair: true,
      system: opts.system,
      user: `${opts.user}\n\n## Correction required\n${
        first.truncated
          ? "Your previous answer was cut off. Answer again, more concisely, as complete valid JSON."
          : "Your previous answer was not valid JSON. Answer again with STRICT valid JSON only."
      }`,
    });
    const repaired = safeParseJson<T | typeof sentinel>(second.text, sentinel);
    if (repaired !== sentinel && repaired != null) return repaired as T;
  } catch (e) {
    if (e instanceof AiGatewayError) throw e;
  }

  logGuardrailEvent({
    kind: "parse_failure",
    severity: "warn",
    route: opts.route,
    detail: { fallbackUsed: true, truncated: first.truncated },
  });
  return opts.fallback;
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
    route: opts.route,
  });
  const call = json?.choices?.[0]?.message?.tool_calls?.[0];
  const argsStr = call?.function?.arguments ?? "";
  if (!argsStr) return null;
  const parsed = safeParseJson<T | null>(argsStr, null);
  if (parsed == null) {
    logGuardrailEvent({
      kind: "parse_failure",
      severity: "warn",
      route: opts.route,
      detail: { tool: opts.name },
    });
  }
  return parsed;
}

export { parseStructured };
