# ADR-0019: Mastra as the workflow graph only, never the model layer

- **Status**: Accepted
- **Date**: 2026-09-17
- **Context sources**: Firecrawl/Mastra/Helicone/Promptfoo/Trigger.dev/LiteLLM
  integration initiative, phase 5 of 5 (follows ADR-0015–0018)

## Context

`src/lib/anthropic-gateway.server.ts`'s `claudeToolLoop()` already implements
a generic, budget/turn/deadline-governed, checkpointable, parallel-tool
agent loop, and `src/server/geo/agents/` builds a full staged pipeline on top
of it (investigate → plan → implement → review → validate → correct) with
its own leased Postgres state machine, GitHub connector auth, and
fix-proposal/PR workflow. It is mature, deeply product-specific, and
Anthropic-only. The product goal is Mastra for "multi-step AI workflows":
Competitor Intelligence, a GEO/AEO audit workflow, campaign generation, and a
Marketing Coach workflow.

## Decision

**Mastra supplies only the workflow graph — step sequencing, per-step
retries, and observability — never a model call.** Every step in every
workflow registered in `src/server/workflows/mastra.server.ts` is a thin
wrapper around this codebase's own gateways
(`claudeJsonPrompt`/`firecrawl-gateway.server.ts`). Mastra's own `@ai-sdk/*`
model-provider integrations (its `Agent` class, `.agent()` workflow steps)
are never used — adopting them would silently bypass `checkBudget`,
`recordUsage`, and the Helicone logging every other call site gets for free.
`claudeToolLoop` remains reserved for the GEO coding agent's tool-use loop;
it is not reused as a general step-graph mechanism, so this codebase doesn't
end up maintaining two competing orchestration idioms.

**Three workflows shipped, one deferred:**

- **`competitor-intelligence.workflow.ts`** — the crawl and synthesis stages
  of `src/server/research/competitor-intel.server.ts` (ADR-0017), split into
  two independently-retried Mastra steps
  (`crawlCompetitorPages`/`synthesizeCompetitorProfile`) instead of one
  opaque call. `startCompetitorIntelRun()`'s inline path and the Trigger.dev
  task both still call the plain `runCompetitorIntel()` composition directly
  (no change, no new import cycle); the Mastra-wrapped version is used by the
  GEO/AEO audit workflow below as a genuine **nested workflow** — a real
  Mastra feature — rather than existing as unused parallel code.
- **`geo-aeo-audit.workflow.ts`** — sequences an **existing, already-completed**
  GEO scan (read-only, via `supabaseAdmin` + `presentScan()`) with a
  per-competitor call into the nested competitor-intelligence workflow.
  Deliberately does **not** touch `src/server/geo/agents/**` or
  `scan-runner.server.ts` — creating or driving a scan stays entirely the
  existing leased/cron-driven system's job. A single competitor's crawl
  failure doesn't fail the whole audit; it's reported per-entry.
- **`campaign-generation.workflow.ts`** — new functionality (no prior feature
  existed): gathers the workspace's stored Brand DNA, then a single grounded
  Claude call produces a campaign brief with per-channel content ideas.
  Deliberately scoped to a brief, not a full campaign-management feature with
  its own storage/CRUD/UI — that would be a separate, larger product
  decision this initiative doesn't make. The result is returned directly by
  the server function, not persisted to a new table.
- **Marketing Coach workflow — deferred, not shipped.** `getCoachBriefing()`
  (`src/server/fns/coach.ts`) is a single ~300-line `createServerFn` handler
  fusing eight parallel RLS-scoped Supabase reads, cached multi-source
  research, and a Claude synthesis call, with no separable pure function to
  wrap. Extracting one would be a real refactor of a live, tested, complex
  feature purely to support a flag that — per the initiative's own
  instructions — would ship **off by default**, i.e. zero behavior change
  until someone turns it on. That trade (real regression risk today for a
  hypothetical future toggle) isn't worth making in this pass; wrapping it is
  legitimate future work once there's an actual reason to flip the flag on.

**Workspace authorization is checked once, at the calling server function**
(`src/server/fns/geo-aeo-audit.ts`, `campaign-generation.ts`,
`competitor-intel.ts`), before any workflow runs — matching every other
service layer in this codebase ("thin fn layer checks access, service layer
trusts the caller"). Workflow steps read via `supabaseAdmin`, scoped to the
`workspaceId` the caller already verified, not via a per-request RLS client
threaded through Mastra's schema-validated step boundaries.

**No Mastra storage is configured.** These workflows are short,
complete-in-one-call pipelines with no suspend/resume needs; each workflow's
actual result is persisted into this app's own Supabase tables by its own
service layer (`competitor_intelligence_runs`), not by Mastra. Studio
visualization and cross-restart run resumption are consequently unavailable
— an accepted trade-off, since durability for genuinely long-running work is
Trigger.dev's job (ADR-0018), not Mastra's.

**`@mastra/core` required bumping `zod` from `^3.24.2` to `^3.25.76`**
(zod's peer requirement is `^3.25.0 || ^4.0.0`, and 3.25.76 is the latest
3.x release — zod's v3 line tops out there). Verified safe by running the
full existing test suite, typecheck and build before and after the bump,
with the codebase's few hundred existing zod schemas unaffected.

## Consequences

- Every AI call inside a Mastra step is still budget-checked, metered, and
  (when configured) logged to Helicone — no side channel exists.
- The GEO coding agent's tool-loop pipeline is completely untouched; nothing
  in `src/server/geo/agents/**` was read-only-referenced or modified by this
  phase beyond a read-only scan lookup.
- Marketing Coach keeps its exact current behavior, unconditionally — there
  is no flag to accidentally leave on with unreviewed new code behind it.
- Campaign Generation ships as a brief-only workflow; if campaign
  persistence/UI is wanted later, that's new schema and product work, not a
  retrofit of this file.
