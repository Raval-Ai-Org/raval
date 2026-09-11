# ADR-0008: AI metering, spend ceilings, guardrails and the CSP trade-off

- **Status**: Accepted
- **Date**: 2026-09-12
- **Context sources**: Evolve proposal v2.0 (workstreams B, D, E, G), Unified
  Forensic Audit 2026-09-11

## Context

AI calls were unmetered (a console token log), capped by a flat 1 200-token
limit that silently truncated batch generation, cached per process, and
parsed with silent fallbacks that saved template posts as if they were real.
There were no spend limits per workspace. Scraped pages and brand context were
labelled "authoritative" in prompts. Output reached client portals unchecked.

## Decisions

**Metering.** Every provider call (OpenRouter, Anthropic, KIE, DataForSEO)
records actual usage through `record_ai_usage()` into `ai_usage_events` plus an
atomic `ai_usage_daily` rollup. Cost uses provider-reported cost where
available (OpenRouter `usage.cost`) and `src/server/ai/pricing.ts` otherwise
(env-overridable). Calls are attributed to the workspace from the request
scope, which the route kernel sets only after verifying membership.

**Budgets.** Plans (`src/server/plans.ts`) carry daily/monthly USD ceilings and
monthly image/video quotas. `checkBudget` returns ok / warn (≥ 80%) / degrade /
block. Text degrades to a cheap model with a 1 000-token cap rather than
failing; images and video return 429. The check fails open on a metering
outage (an outage should not take generation down) and is cached for 30 s.

**Output quality.** Per-task token budgets replace the flat cap. Truncation is
detected (`finish_reason=length`, `stop_reason=max_tokens`), recorded, never
cached, and surfaced — streaming chat appends a truncation marker and the UI
offers "Continue". Structured output is validated with zod with one repair
attempt; failure is an error (502), not a silent fallback.

**Shared cache.** Redis when `REDIS_URL` is set, in-process LRU otherwise; keys
include the tenant and, for images, the reference assets. `regenerate` bypasses
the cache.

**Guardrails** (`src/server/guardrails/`). Untrusted text (crawls, search
snippets, attachments, brand context) is neutralised and fenced in
`<untrusted_data>` under a standing rule not to follow instructions inside it;
an injection detector logs hits. Content shared to a client portal is checked
for PII (Luhn-checked cards, phones, emails, IBAN), profanity, unsubstantiated
or medical/financial claims and the brand's "don't" list; images are moderated
and **fail closed** (unverifiable = needs acknowledgement). Blocking findings
require an explicit "share anyway". Events go to `guardrail_events`.

**CSP without nonces.** `next.config.ts` sends a strict CSP (`object-src
'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, an explicit
`connect-src` allow-list) but keeps `script-src 'self' 'unsafe-inline'`.
Per-request nonces would force every route, including the static marketing
pages, to render dynamically. The residual XSS risk is mitigated by React's
escaping, the absence of `dangerouslySetInnerHTML` on user content, and the
connect-src allow-list limiting exfiltration. Revisit if a nonce-compatible
static rendering path lands in Next.js.

## Consequences

- Spend is visible per workspace (Plan & usage panel, `/api/usage`) and
  bounded; ops-watch alerts on anomalies.
- A metering outage degrades to "unbounded for 30 s windows", by design.
- Failures that used to be hidden (truncation, parse errors) are now visible
  to users and in `guardrail_events` — expect a short-term rise in reported
  errors that reflects reality.
