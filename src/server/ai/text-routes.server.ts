// text-routes.server.ts — env-configured text-model routing table (the
// "LiteLLM" role, built natively instead of running LiteLLM's Python-only
// proxy as a separate service). Generalizes the config-driven candidate/
// fallback pattern src/lib/model-router.server.ts already proves out for KIE
// images (routeImageModel()) to text completions.
//
// Every kind resolves to a primary candidate plus zero or more fallback
// candidates, each an explicit {provider, model} pair so a fallback can cross
// providers (e.g. OpenRouter down -> Anthropic direct). Unconfigured, a kind
// resolves to exactly the caller-supplied default and zero fallbacks, so an
// unconfigured deployment behaves exactly as it did before this file existed.
import "server-only";

export type TextProvider = "openrouter" | "anthropic";
export type TextRouteKind = "chat" | "extraction" | "agent";

export type RouteCandidate = { provider: TextProvider; model: string };

export type TextRoutePlan = {
  primary: RouteCandidate;
  fallbacks: RouteCandidate[];
};

function parseProvider(raw: string | undefined): TextProvider | undefined {
  const value = raw?.trim().toLowerCase();
  return value === "openrouter" || value === "anthropic" ? value : undefined;
}

/** "anthropic:claude-sonnet-5" -> {provider, model}. Ignores an unparsable entry. */
function parseCandidate(raw: string): RouteCandidate | undefined {
  const separator = raw.indexOf(":");
  if (separator < 0) return undefined;
  const provider = parseProvider(raw.slice(0, separator));
  const model = raw.slice(separator + 1).trim();
  return provider && model ? { provider, model } : undefined;
}

function envCandidateList(name: string): RouteCandidate[] {
  const value = process.env[name]?.trim();
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map(parseCandidate)
    .filter((candidate): candidate is RouteCandidate => Boolean(candidate));
}

function candidateKey(candidate: RouteCandidate): string {
  return `${candidate.provider}:${candidate.model}`;
}

/**
 * Resolve the routing plan for one text-call kind from
 * AI_TEXT_ROUTE_<KIND>_PROVIDER / _MODEL / _FALLBACKS. `fallback` is the
 * kind's existing hardcoded default (today's gateway behavior) and is used
 * verbatim when nothing is configured.
 */
export function resolveTextRoute(kind: TextRouteKind, fallback: RouteCandidate): TextRoutePlan {
  const prefix = `AI_TEXT_ROUTE_${kind.toUpperCase()}`;
  const provider = parseProvider(process.env[`${prefix}_PROVIDER`]) ?? fallback.provider;
  const model = process.env[`${prefix}_MODEL`]?.trim() || fallback.model;
  const primary: RouteCandidate = { provider, model };

  const configuredFallbacks = envCandidateList(`${prefix}_FALLBACKS`);
  const seen = new Set([candidateKey(primary)]);
  const fallbacks: RouteCandidate[] = [];
  for (const candidate of configuredFallbacks) {
    const key = candidateKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    fallbacks.push(candidate);
  }
  return { primary, fallbacks };
}

/** Kill switch: "false" reverts every kind to its direct, single-provider call. */
export function unifiedGatewayEnabled(): boolean {
  return (
    (process.env.FEATURE_FLAG_UNIFIED_GATEWAY_ENABLED ?? "true").trim().toLowerCase() !== "false"
  );
}
