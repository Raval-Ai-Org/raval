# ADR-0018: Trigger.dev for new workflows only, never the existing ones

- **Status**: Accepted
- **Date**: 2026-09-17
- **Context sources**: Firecrawl/Mastra/Helicone/Promptfoo/Trigger.dev/LiteLLM
  integration initiative, phase 4 of 5 (follows ADR-0015–0017)

## Context

CLAUDE.md documents "no queue service" as an enforced convention: every
background job (GEO scans, KIE/UGC video polling, scheduled social posts,
competitor-watch sweeps, the GEO coding agent's runs) is a Postgres row with
`lease_until`/`locked_by`, claimed via a `SECURITY DEFINER` `SKIP LOCKED` RPC,
advanced by a `pg_cron` hook plus Next's `after()` plus a status-read
watchdog. It is mature, idempotent (unique `idempotency_key` columns,
compare-and-set transitions), and cost-reservation-aware
(`ai_usage_reservations`). The product goal is to bring in Trigger.dev for
durable background jobs — but PR 3's Competitor Intelligence feature
currently runs synchronously inline within one request, with no lease table,
no cron sweep, and therefore no backstop if the process dies mid-crawl.

## Decision

**Trigger.dev is additive only.** It is introduced to back the one workflow
that has no existing job infrastructure to migrate (Competitor Intelligence)
and any future genuinely-new long-running workflow. It is a hard rule, not
just a starting point, that new Trigger.dev tasks never import
`runner.server.ts`, `scan-runner.server.ts`, or any existing `claim_*` RPC —
zero shared code with GEO scans, UGC renders, scheduled posts, or the GEO
coding agent, by construction. Migrating any of those onto Trigger.dev would
be a separate, explicit decision this ADR does not make.

- **`src/server/trigger/client.server.ts`** is the one file that imports
  `@trigger.dev/sdk`. `triggerTask(taskId, payload, idempotencyKey)` wraps
  `tasks.trigger()`, always passing an explicit `idempotencyKeys.create(key,
  { scope: "global" })` — v4.3.1+ changed a raw string key's default scope
  from "global" to "run", and this client wants a stable, caller-chosen key
  that survives retries and de-dupes a repeated user action, matching the
  `idempotency_key` discipline every existing job table already has.
  `triggerEnabled()` (off unless both `TRIGGER_API_URL` and
  `TRIGGER_SECRET_KEY` are set) and a `setTriggerCaller()` test seam follow
  the same shape as every other gateway in this codebase.
- **`src/trigger/competitor-intel-run.ts`** is a thin adapter: its `run()`
  calls the exact same plain functions
  (`runCompetitorIntel`/`persistCompetitorIntelOutcome`) the inline fallback
  uses, so the business logic is unit-tested without a running Trigger.dev
  instance, matching how `geo-coding-agent.ts`'s stage functions are already
  separated from `runner.server.ts`'s persistence/orchestration layer.
- **`startCompetitorIntelRun()` branches on `triggerEnabled()`**: when
  configured, it inserts the run row, enqueues the task, and returns
  immediately in `"running"` status (the client polls `getCompetitorIntelRun`
  for completion). When not configured — the default — it runs the crawl and
  synthesis inline exactly as PR 3 shipped it, and this function doesn't
  return until the outcome is persisted. **If the enqueue call itself fails**
  (Trigger.dev configured but unreachable), it falls through to the inline
  path rather than leaving the row stuck `"running"` forever with no backstop
  — there is intentionally no cron sweep for this table, since Trigger.dev
  owns retry/durability once a task is successfully enqueued.
- **Self-hosted via Trigger.dev's own, unmodified Docker Compose** from a
  sibling checkout (`docs/self-hosted-integrations.md`), the same pattern as
  Firecrawl (ADR-0017) — its stack (webapp, Postgres, Redis, a supervisor,
  ClickHouse, Electric, a Docker socket proxy, a registry, object storage) is
  the heaviest of the three self-hosted services in this initiative and
  already wires itself together correctly.
- **No new CI/CD deploy step in this pass.** `npx trigger.dev deploy` against
  the self-hosted registry is a genuinely new pipeline distinct from the
  existing Dockerfile/Railway flow; wiring it into `.github/workflows/ci.yml`
  is real follow-up work, documented as a known gap rather than rushed.

## Consequences

- Zero regression risk to any existing background job — none of them are
  touched, imported, or reachable from any new Trigger.dev code path.
- Competitor Intelligence gains real durability (retries, a backstop against
  a crashed process) once Trigger.dev is configured, while remaining fully
  functional — just synchronous — without it.
- The `trigger.dev` CLI (devDependency only, never bundled into the
  production Next.js standalone output) currently pulls in a transitive
  critical `tar` vulnerability through its own dependency chain
  (`c12`/`giget`). It is dev-tooling only and excluded from this repo's CI
  security gate (`npm audit --omit=dev`), but is worth monitoring for an
  upstream fix.
- Deploying a task code change still requires a manual `trigger.dev deploy`
  step until CI/CD is wired up — a real operational gap, not hidden by this
  ADR.
