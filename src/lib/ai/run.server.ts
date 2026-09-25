// High-level AI entry-points. Every route/server-fn that needs a
// structured response or a tool call goes through here — one place to
// tune caching, token caps, models, and telemetry. Usage metering happens in
// the gateway (src/lib/ai-gateway.server.ts) for every call.

import "server-only";
import type { ZodType, ZodTypeDef } from "zod";
import { chatCompletion, AiGatewayError, type TokenTask } from "@/lib/ai-gateway.server";
import { logGuardrailEvent } from "@/server/guardrails/events";
import { AiOutputError, parseStructured, runStructured } from "@/server/ai/structured";
import { humanizeText } from "./humanize-text";
import { safeParseJson } from "./json";

export { AiGatewayError, AiOutputError };

type Common = {
  /** Metering route; the model plan comes from src/server/ai/task-models.ts. */
  route: string;
  system: string;
  user: string;
  /** Parsing an external source: extraction-scale budgets, faithful text. */
  extraction?: boolean;
  /** Apply the route's escalation rule. */
  escalate?: boolean;
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
  const isExtraction = opts.extraction === true;
  const json = await chatCompletion({
    route: opts.route,
    messages,
    response_format: { type: "json_object" as const },
    max_tokens: overrides.maxTokens,
    temperature: opts.temperature,
    cacheTtlMs: opts.cacheTtlMs,
    // The repair attempt must never be answered from the cache.
    noCache: opts.noCache || overrides.repair,
    regenerate: opts.regenerate && !overrides.repair,
    escalate: opts.escalate,
    task: isExtraction ? "extraction" : (opts.task ?? "generate"),
  });
  const raw = String(json?.choices?.[0]?.message?.content ?? "");
  return {
    // Em dash is the clearest "AI voice" tell in generated prose; strip it
    // here so every runStructuredPrompt/runJsonPrompt caller gets clean
    // output for free. Skipped for extraction: that's parsing an external
    // source's own text (a scraped page, an uploaded file), not generating
    // new copy, so it must stay faithful to what the source actually says.
    // Safe for JSON responses too — only touches string content, not syntax.
    text: isExtraction ? raw : humanizeText(raw),
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
 * the model chose not to call the tool. tool_choice is "auto" (Claude Opus 5.5
 * rejects forced tool use), so the system prompt must ask for the call.
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
      {
        role: "system",
        content: `${opts.system}\n\nAnswer by calling the \`${opts.name}\` tool.`,
      },
      { role: "user", content: opts.user },
    ],
    tools: [tool],
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
