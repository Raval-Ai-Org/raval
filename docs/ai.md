# AI and model reference

## Gateways and routing

General text calls use the OpenRouter gateway in `src/lib/ai-gateway.server.ts`.
Anthropic direct calls use `src/lib/anthropic-gateway.server.ts`. The native
routing plan in `src/server/ai/text-routes.server.ts` resolves `chat`,
`extraction`, and `agent` candidates from `AI_TEXT_ROUTE_*` variables, with
explicit provider/model fallbacks. `FEATURE_FLAG_UNIFIED_GATEWAY_ENABLED` can
revert to direct single-provider behavior.

The implementation's default model choices are code-owned and may change;
current examples include OpenRouter chat/extraction/fast models and Anthropic
Claude models. Do not treat model names in old docs as a promise. The chat route
accepts allow-listed ids, not arbitrary model names.

## Prompt and context safety

Prompt fragments live under `src/lib/ai/prompts`. Chat removes client-supplied
system turns, sanitizes input, summarizes older history, and fences workspace
context as untrusted data. Brand identity is loaded from the verified workspace
at request time. Provider gateways centralize metering, cache behavior, and
error handling.

## Paid calls and controls

`src/server/ai/metering.ts`, `budget.ts`, reservations, and plan helpers track
estimated spend, calls, cached calls, image/video counts, and social posts.
Rate limits are applied by the route kernel. Usage is exposed by `/api/usage`.
A provider call must not bypass the gateway or budget path.

## AI-related systems

- Brand extraction and memory extraction
- Marketing chat and generation
- GEO answer probes, behind a feature flag
- GEO coding agent, with repository ownership, read-before-plan, approval, and verification boundaries
- KIE image/video generation
- Studio and UGC model routing
- Promptfoo evaluations under `evals/`

TODO: publish a model-by-task matrix generated from the gateway constants and
route configuration; this guide intentionally avoids inventing a stable model
catalog.
