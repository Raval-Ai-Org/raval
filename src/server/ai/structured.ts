// structured.ts — structured model output with validation and one repair retry
// (proposal workstreams C + D: "Parse-failure surfacing" and "Structured-output
// validation with retry, replacing the silent fallback").
//
// The old runJsonPrompt returned a caller-supplied fallback whenever the model's
// JSON did not parse, so a failed extraction looked like a thin answer and
// batch generation saved template posts as real content. runStructured instead:
//   1. parses and validates against a zod schema;
//   2. on failure, re-asks ONCE (bypassing the cache) with the validation error
//      and a larger output budget if the first answer was truncated;
//   3. if that also fails, logs a `parse_failure` guardrail event and throws
//      AiOutputError (HTTP 502) — the caller surfaces a real error.
import "server-only";
import type { ZodType, ZodTypeDef } from "zod";
import { UpstreamError } from "@/server/upstream";
import { logGuardrailEvent } from "@/server/guardrails/events";
import { extractFirstJsonObject, stripJsonFences } from "@/lib/ai/json";

export class AiOutputError extends UpstreamError {
  constructor(message: string, code: "parse_failure" | "truncated" | "empty" = "parse_failure") {
    super(502, message, { provider: "model", code });
    this.name = "AiOutputError";
  }
}

export type ModelCall = (args: {
  system: string;
  user: string;
  maxTokens: number;
  /** true on the repair attempt: callers must bypass any response cache. */
  repair: boolean;
}) => Promise<{ text: string; truncated: boolean }>;

export type RunStructuredOpts<T> = {
  route: string;
  system: string;
  user: string;
  schema: ZodType<T, ZodTypeDef, unknown>;
  maxTokens: number;
  /** Ceiling for the repair attempt's output budget. Default: 2× maxTokens. */
  maxRepairTokens?: number;
  call: ModelCall;
};

export type ParseOutcome<T> = { ok: true; value: T } | { ok: false; error: string };

/** Parse model text into T. Tolerates ```json fences and leading prose. */
export function parseStructured<T>(
  raw: string,
  schema: ZodType<T, ZodTypeDef, unknown>,
): ParseOutcome<T> {
  const text = raw.trim();
  if (!text) return { ok: false, error: "empty response" };
  let json: unknown;
  try {
    json = JSON.parse(stripJsonFences(text));
  } catch {
    const inner = extractFirstJsonObject(text);
    if (!inner) return { ok: false, error: "response is not JSON" };
    try {
      json = JSON.parse(inner);
    } catch (e) {
      return { ok: false, error: `invalid JSON: ${e instanceof Error ? e.message : String(e)}` };
    }
  }
  const result = schema.safeParse(json);
  if (result.success) return { ok: true, value: result.data };
  const issue = result.error.issues[0];
  const where = issue?.path.length ? issue.path.join(".") : "(root)";
  return { ok: false, error: `schema mismatch at ${where}: ${issue?.message ?? "invalid"}` };
}

export async function runStructured<T>(opts: RunStructuredOpts<T>): Promise<T> {
  const first = await opts.call({
    system: opts.system,
    user: opts.user,
    maxTokens: opts.maxTokens,
    repair: false,
  });
  const parsed = parseStructured(first.text, opts.schema);
  if (parsed.ok) return parsed.value;

  const repairTokens = first.truncated
    ? Math.min(opts.maxRepairTokens ?? opts.maxTokens * 2, opts.maxTokens * 2)
    : opts.maxTokens;
  const repairUser = [
    opts.user,
    "",
    "## Correction required",
    first.truncated
      ? "Your previous answer was cut off before it finished. Answer again, more concisely, as complete valid JSON."
      : `Your previous answer could not be used (${parsed.error}). Answer again with STRICT valid JSON that matches the requested schema exactly. No prose, no markdown fences.`,
  ].join("\n");
  const second = await opts.call({
    system: opts.system,
    user: repairUser,
    maxTokens: repairTokens,
    repair: true,
  });
  const repaired = parseStructured(second.text, opts.schema);
  if (repaired.ok) return repaired.value;

  logGuardrailEvent({
    kind: "parse_failure",
    severity: "warn",
    route: opts.route,
    detail: {
      firstError: parsed.error,
      repairError: repaired.error,
      truncated: first.truncated || second.truncated,
    },
  });
  throw new AiOutputError(
    second.truncated || first.truncated
      ? "The AI response was cut off before it finished. Please try again with a shorter request."
      : "The AI returned a response we couldn't use. Please try again.",
    second.truncated || first.truncated ? "truncated" : "parse_failure",
  );
}
