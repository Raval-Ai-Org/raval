# ADR-0007: Agent control plane before autonomous workers

- **Status**: Accepted
- **Date**: 2026-09-12
- **Context sources**: Evolve proposal v2.0 (workstream C), Unified Forensic
  Audit 2026-09-11 (Stages 2–4), ADR-0006 (route kernel)

## Context

The product described "agents", but in code an agent was a prompt persona and
the only way a model changed state was an action tag in a chat reply
(`[[action:schedule …]]`), which the browser executed directly — including
inserting content with status `scheduled`. Scraped web pages flowed into the
same prompts, so a hostile page could plant an action tag. The audit's verdict
was PARTIAL-GO: build tools, policy, approvals, durable runs and evaluations
**before** any worker acts on its own, and never let a worker publish.

## Decision

A small control plane in `src/server/agents/`:

1. **Typed tool registry** (`registry.ts`). Every tool declares a zod input,
   an effect class (`read` / `draft` / `write` / `external`), a minimum role
   and whether it needs approval. Handlers get a workspace-scoped context only
   — no raw SQL, no credentials. There are no publish, OAuth or credential
   tools.
2. **Policy** (`policy.ts`, `decidePolicy`): allow / require_approval / deny
   from the global kill switch (`AGENTS_DISABLED`), the workspace switch
   (`workspace_agent_settings.agents_paused`), role vs. `minRole`, and effect
   class. Writes and external effects always require approval.
3. **Runtime** (`runtime.ts`): durable `agent_runs` with a state machine,
   every tool call recorded in `agent_run_steps` with redacted arguments,
   budgets (steps, tokens, cost, deadline) and loop detection.
4. **Approvals** (`approvals.ts`): `agent_action_requests` hold the exact
   proposed change, preview and expiry. Approving is compare-and-set on the
   status, re-checks policy and role, then executes with an idempotency key.
5. **Workers**, both bounded:
   - *Distribution Reliability* (read-only): deterministic evidence from
     publications, delivery failures, webhook rejections and heartbeats →
     `agent_findings` using the audit's finding contract. Never mutates
     delivery state.
   - *Content-Fit* (approval-gated): platform limits and guardrail checks →
     a proposed `content.apply_revision` that a human approves.
6. **Chat actions** go through the same idea: navigation tags run; `audit`,
   `save-memory` and `schedule` render as Suggested chips needing Approve, and
   an approved schedule creates a `pending` item, never `scheduled`.
7. **Operations inbox** UI for findings, approvals and runs, plus evaluation
   fixtures in `tests/agents/`.

## Consequences

- Every state change an agent causes is attributable to a run, a step and a
  human approval.
- Adding a tool is a registry entry with a schema and an effect class; policy
  applies automatically.
- Autonomous publishing remains out of scope. Enabling it later would be a
  new effect class and a new ADR, not a flag.
- Workers are deterministic first and model-assisted second: if the model is
  unavailable or over budget, findings still appear with a deterministic
  explanation.
