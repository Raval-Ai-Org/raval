// model-gateway.server.ts — unified text-completion entry point that adds
// cross-provider fallback on top of the existing OpenRouter and Anthropic
// gateways (src/lib/ai-gateway.server.ts, src/lib/anthropic-gateway.server.ts).
//
// This is additive: nothing here replaces those gateways or their call sites.
// It delegates every actual call to them, so budget checks (checkBudget),
// caching, in-flight dedupe and usage metering (recordUsage) all keep working
// exactly as they do today — this file only decides WHICH candidate to call
// and whether a failure is safe to retry on a different one.
import "server-only";
import {
  chatCompletion,
  CHAT_MODEL,
  EXTRACTION_MODEL,
  type ChatMessage,
} from "@/lib/ai-gateway.server";
import { claudeTextCompletion, selectClaudeModel } from "@/lib/anthropic-gateway.server";
import {
  resolveTextRoute,
  unifiedGatewayEnabled,
  type RouteCandidate,
  type TextProvider,
  type TextRouteKind,
  type TextRoutePlan,
} from "@/server/ai/text-routes.server";
import { UpstreamError } from "@/server/upstream";

export type UnifiedTextOpts = {
  kind: TextRouteKind;
  /** Metering route label, e.g. "coach.briefing". */
  route: string;
  system: string;
  user: string;
  maxTokens?: number;
};

export type UnifiedTextResult = {
  text: string;
  provider: TextProvider;
  model: string;
  truncated: boolean;
  degraded: boolean;
};

type ProviderCaller = (
  candidate: RouteCandidate,
  opts: UnifiedTextOpts,
) => Promise<UnifiedTextResult>;

async function callOpenRouter(
  candidate: RouteCandidate,
  opts: UnifiedTextOpts,
): Promise<UnifiedTextResult> {
  const messages: ChatMessage[] = [
    { role: "system", content: opts.system },
    { role: "user", content: opts.user },
  ];
  const json = await chatCompletion({
    model: candidate.model,
    messages,
    max_tokens: opts.maxTokens,
    task: opts.kind === "extraction" ? "extraction" : "chat",
    route: opts.route,
    _extraction: opts.kind === "extraction",
  });
  const content = json?.choices?.[0]?.message?.content;
  return {
    text: typeof content === "string" ? content : "",
    provider: "openrouter",
    model: json?._model ?? candidate.model,
    truncated: Boolean(json?._truncated),
    degraded: Boolean(json?._degraded),
  };
}

async function callAnthropic(
  candidate: RouteCandidate,
  opts: UnifiedTextOpts,
): Promise<UnifiedTextResult> {
  const result = await claudeTextCompletion({
    route: opts.route,
    system: opts.system,
    user: opts.user,
    model: candidate.model,
    maxTokens: opts.maxTokens,
  });
  return {
    text: result.text,
    provider: "anthropic",
    model: result.model,
    truncated: result.truncated,
    degraded: result.degraded,
  };
}

const defaultCallers: Record<TextProvider, ProviderCaller> = {
  openrouter: callOpenRouter,
  anthropic: callAnthropic,
};

let providerCallers: Record<TextProvider, ProviderCaller> = { ...defaultCallers };

/** Tests inject fake provider callers instead of hitting the network. Pass null to reset. */
export function setUnifiedProviderCallers(
  next: Partial<Record<TextProvider, ProviderCaller>> | null,
): void {
  providerCallers = next ? { ...defaultCallers, ...next } : { ...defaultCallers };
}

// Anthropic sets this code when the model DID generate content but the reply
// couldn't be parsed — that call may already be billed, so it must surface to
// the caller rather than being retried on a different provider.
const NON_FAILOVER_CODES = new Set(["malformed_response"]);

/**
 * Whether a failure is safe to retry on the next candidate. Safe cases are
 * ones where this candidate never produced billable output: the provider
 * wasn't configured/authenticated, was rate-limited or out of credits, or was
 * unreachable/overloaded. Anything else (e.g. a malformed-but-generated
 * reply) is surfaced instead of silently retried, since a second attempt
 * could pay for the same output twice.
 */
export function isFailoverSafe(error: unknown): boolean {
  if (!(error instanceof UpstreamError)) return false;
  if (error.code && NON_FAILOVER_CODES.has(error.code)) return false;
  return [401, 402, 403, 429, 500, 502, 503, 504, 529].includes(error.status);
}

function defaultCandidateFor(kind: TextRouteKind): RouteCandidate {
  switch (kind) {
    case "agent":
      return { provider: "anthropic", model: selectClaudeModel("default") };
    case "extraction":
      return { provider: "openrouter", model: EXTRACTION_MODEL };
    case "chat":
    default:
      return { provider: "openrouter", model: CHAT_MODEL };
  }
}

/** The resolved routing plan for a kind, for introspection/diagnostics. */
export function routeText(kind: TextRouteKind): TextRoutePlan {
  return resolveTextRoute(kind, defaultCandidateFor(kind));
}

/**
 * Unified, cross-provider-fallback text completion. Streaming is explicitly
 * out of scope here (see chatCompletionStream in ai-gateway.server.ts) —
 * fallback only ever applies to a call that fails before any output reaches
 * the caller.
 */
export async function unifiedChatCompletion(opts: UnifiedTextOpts): Promise<UnifiedTextResult> {
  const defaultCandidate = defaultCandidateFor(opts.kind);
  if (!unifiedGatewayEnabled()) {
    return providerCallers[defaultCandidate.provider](defaultCandidate, opts);
  }

  const plan = resolveTextRoute(opts.kind, defaultCandidate);
  const candidates = [plan.primary, ...plan.fallbacks];

  let lastError: unknown;
  for (let index = 0; index < candidates.length; index++) {
    const candidate = candidates[index];
    try {
      return await providerCallers[candidate.provider](candidate, opts);
    } catch (error) {
      lastError = error;
      const isLastCandidate = index === candidates.length - 1;
      if (isLastCandidate || !isFailoverSafe(error)) throw error;
      const next = candidates[index + 1];
      console.warn("[model-gateway] falling over to next candidate", {
        route: opts.route,
        from: `${candidate.provider}:${candidate.model}`,
        to: `${next.provider}:${next.model}`,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  // Unreachable — the loop above always returns or throws — but keeps the
  // function's return type honest for the type checker.
  throw lastError;
}
