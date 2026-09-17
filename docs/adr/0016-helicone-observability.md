# ADR-0016: Helicone as a fire-and-forget observability sink, not a proxy

- **Status**: Accepted
- **Date**: 2026-09-17
- **Context sources**: Firecrawl/Mastra/Helicone/Promptfoo/Trigger.dev/LiteLLM
  integration initiative, phase 2 of 5 (follows ADR-0015)

## Context

Every AI call in this codebase already goes through one owned pipeline —
`checkBudget` → cache → dedupe → provider → `recordUsage()` — ending in a
single Postgres sink (`public.record_ai_usage`, ADR-0008). The product goal
is LLM observability (token/cost/latency/error/provider tracking) via
Helicone, self-hosted.

Helicone's default integration mode proxies the actual LLM call through its
gateway (swap the provider base URL for Helicone's). That would put a
brand-new, not-yet-operationally-proven self-hosted service directly in the
critical path of every paid, budget-checked request — a Helicone outage
would then mean an AI outage. Helicone also offers "custom logging": call the
provider directly as today, then separately POST a copy of the completed
call's metadata to Helicone afterward. As of this writing, self-hosted
Helicone's own docs describe Jawn (its backend) as no longer proxying LLM
traffic at all — self-hosted deployments point applications at Jawn only for
logging/API purposes, reinforcing that custom/async logging is the
self-hosted integration path, not proxying.

## Decision

Integrate as a second, independent sink on the exact same event
`recordUsage()` already writes to Postgres:

- `src/server/observability/helicone.server.ts`'s `logToHelicone(row)` POSTs
  to `{HELICONE_BASE_URL}/custom/v1/log` (Helicone's documented custom-logging
  contract: `{providerRequest, providerResponse, timing}`, Bearer auth) using
  raw `fetch` with a 5s timeout — matching this codebase's convention of zero
  AI/observability SDK packages rather than `@helicone/async`/`@helicone/helpers`.
- **Centralized in `recordUsage()` itself** (`src/server/ai/metering.ts`),
  not duplicated at each of the ~19 individual `recordUsage(...)` call sites
  across `ai-gateway.server.ts`, `anthropic-gateway.server.ts` and
  `kie-gateway.server.ts`. Every existing and future call site gets Helicone
  visibility automatically, with far less risk of an inconsistent or missed
  call site than hand-adding a second call everywhere.
- Token usage and cost are read from the same row `record_ai_usage` receives
  — Helicone never computes its own cost figure independently; Mellox's own
  metering/budget system stays the single source of truth for spend
  decisions. Model/provider/route/workspace/cost/status are also sent as
  `Helicone-Property-*` custom properties for filtering in Helicone's
  dashboard.
- **Prompt/completion bodies are never sent by default**
  (`HELICONE_LOG_PROMPTS=false`) — only metadata. Turning it on additionally
  embeds the real request/response JSON.
- Fire-and-forget, exactly like `recordUsage()`'s existing Postgres sink:
  never awaited by the caller, every failure caught and logged, nothing ever
  thrown. `heliconeEnabled()` (off unless `HELICONE_BASE_URL` is set) is
  checked before any network call is attempted.
- Self-hosted via a sibling checkout of Helicone's own repository plus a new
  `docker-compose.integrations.yml`, rather than vendoring Helicone's
  Docker Compose definition into this repository (see
  `docs/self-hosted-integrations.md`) — that definition is Helicone's own and
  would otherwise drift out of date inside this codebase.

## Consequences

- A Helicone outage, misconfiguration, or simply not running it at all has
  zero effect on any AI call — verified by unit tests asserting a rejected
  transport never throws and the Postgres sink still succeeds independently.
- Observability data is a step behind real-time relative to true proxying
  (logged after the call completes, not measured by Helicone as it happens)
  — an accepted trade-off for keeping Helicone out of the request's critical
  path.
- If per-request request/response inspection in Helicone's UI becomes a firm
  requirement, that's `HELICONE_LOG_PROMPTS=true` — a config change, not a
  code change.
