# AI and model reference

This guide covers AI calls made by the Next.js application under `src/`. The
repository also contains a separate Python FastAPI backend with its own provider
adapters; see the [Python AI Visibility reference](AI_VISIBILITY.md). Do not
assume the two runtimes share credentials or provider policy.

## Provider and routing

Text, vision, tool-use, and image requests go through OpenRouter. The server-side
text gateway is `src/lib/ai-gateway.server.ts`; image requests use
`src/lib/openrouter-image.server.ts`. Claude model IDs such as
`anthropic/claude-opus-5.5` identify models hosted through OpenRouter; Mellox AI
does not call the Anthropic API directly or require `ANTHROPIC_API_KEY`.

Call sites select a metering route, not a model. The route registry in
`src/server/ai/task-models.ts` selects primary and fallback models, reasoning
effort, token limits, and any task-specific escalation or degraded plan.
`AI_MODEL_<ROUTE_KEY>` and `AI_EFFORT_<ROUTE_KEY>` can override a route without
changing code. The authoritative decision and provider details are in
[ADR-0026](adr/0026-openrouter-only-models.md).

Video remains behind the provider interface in `src/server/ugc/providers/` and
may use KIE or OpenRouter according to `VIDEO_PROVIDER` and its fallback
configuration. It is intentionally a separate path from text and image calls.

## Controls and context

Provider calls, budgets, usage accounting, cache behavior, and error mapping are
server-owned. Paid calls must use the gateway and applicable rate-limit path.
Workspace-scoped requests must load brand context only after verifying the
workspace identity and access.

Prompt fragments live under `src/lib/ai/prompts`. Chat removes
client-supplied system turns, sanitizes input, summarizes older history, and
wraps workspace context as untrusted data. GEO answer probes are feature-flagged;
the GEO coding agent is repository-scoped and requires ownership, approval, and
verification.

## Related references

- Environment variables and provider configuration: [configuration](configuration.md)
- Usage, budgets, and cost controls: [analytics and usage](analytics-and-usage.md)
- Gateway implementation: `src/lib/ai-gateway.server.ts`
- Task routing: `src/server/ai/task-models.ts`
- Prompt evaluations: `evals/`
