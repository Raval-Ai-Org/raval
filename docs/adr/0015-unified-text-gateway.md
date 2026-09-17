# ADR-0015: Unified text gateway (TypeScript-native, not LiteLLM's proxy)

- **Status**: Accepted
- **Date**: 2026-09-17
- **Context sources**: Firecrawl/Mastra/Helicone/Promptfoo/Trigger.dev/LiteLLM
  integration initiative, phase 1 of 5

## Context

Text completions go through two independent, hand-rolled gateways —
`src/lib/ai-gateway.server.ts` (OpenRouter: Qwen/Gemini) and
`src/lib/anthropic-gateway.server.ts` (Anthropic direct) — each with its own
hardcoded model constants and no notion of the other. If OpenRouter is down
there is no failover to Anthropic, or vice versa; a caller must already know
which gateway to call. Image generation does not have this problem:
`src/lib/model-router.server.ts`'s `routeImageModel()` already resolves an
env-configured primary model plus an ordered fallback list scored by
complexity and failure history.

The product goal is a "LiteLLM"-style unified gateway: config-driven
provider/model routing with cross-provider fallback and no hardcoded
provider lock-in. LiteLLM itself is a Python-only project — its unified
gateway is a proxy server with no Node/TypeScript package, so it cannot be
`npm install`ed here. Standing it up as a separate self-hosted service would
add a new runtime, a new network hop in front of every paid, budget-checked
request, and a second deployable service to operate, for a codebase whose
explicit convention is zero AI SDK/proxy dependencies and one owned
`checkBudget → cache → dedupe → provider → metering` pipeline per call.

## Decision

Build the same routing concept natively in TypeScript, generalizing
`routeImageModel()`'s pattern from images to text:

- `src/server/ai/text-routes.server.ts` resolves a `{primary, fallbacks}`
  plan per call "kind" (`chat` | `extraction` | `agent`) from
  `AI_TEXT_ROUTE_<KIND>_PROVIDER` / `_MODEL` / `_FALLBACKS` env vars. Every
  candidate is an explicit `{provider, model}` pair, so a fallback can name a
  *different* provider. Unconfigured, a kind resolves to exactly its existing
  hardcoded default and zero fallbacks — today's behavior, byte-for-byte.
- `src/lib/model-gateway.server.ts`'s `unifiedChatCompletion()` walks the
  resolved candidate list, calling the existing `chatCompletion()`
  (OpenRouter) or `claudeTextCompletion()` (Anthropic) per candidate. It does
  not reimplement budget checks, caching, dedupe or metering — those stay
  entirely inside the two existing gateways, which every candidate call still
  passes through unmodified.
- A failure only advances to the next candidate when `isFailoverSafe()` says
  the failed candidate could not have produced billable output: missing
  configuration, rejected auth, rate-limited, out of credits, or
  unreachable/overloaded (`401/402/403/429/5xx`, matching `UpstreamError`'s
  `status`). A reply that generated content but failed to parse
  (`malformed_response`) is surfaced instead of retried, since a second
  attempt on another provider could pay for the same output twice.
- Streaming (`chatCompletionStream`) is explicitly out of scope for
  cross-provider fallback — only non-streaming calls get it, matching the
  existing gateways' own caution around retrying a call that may already be
  billed.
- `FEATURE_FLAG_UNIFIED_GATEWAY_ENABLED=false` reverts every kind to its
  direct, single-provider call, bypassing this file entirely.

No existing call site is migrated in this phase. This is purely additive
infrastructure that new call sites (later integration phases: Mastra
workflow steps, Firecrawl-fed synthesis) opt into by calling
`unifiedChatCompletion()` instead of a specific gateway directly.

## Consequences

- Text completions get real cross-provider fallback for the first time,
  configurable per deployment via env vars alone — no code change to add a
  fallback provider or change the default model for a call kind.
- No new runtime, service, or deployment surface — this ships as a few
  hundred lines of TypeScript with the same test-seam pattern
  (`setUnifiedProviderCallers()`) as the gateways it wraps.
- The "real" LiteLLM proxy remains unused. If a future need specifically
  requires LiteLLM's own provider catalogue, cost-tracking UI, or virtual-key
  management (rather than just routing/fallback), that would be a new,
  separate decision — not a retrofit of this file.
