# Agents, automation, and tools

## Agent control plane

Agent state is represented by run, step, finding, action-request, approval, and
workspace-settings records. Relevant code lives in `src/server/agents` and
`src/server/geo/agents`; API routes live under `/api/agents` and public hooks
advance leased work.

The GEO coding agent is repository-scoped. Ownership is checked before a run,
plans are limited to files read during that run, patches require approval, and
verification is the only path that resolves a GEO finding. Repository writes
are mediated by GitHub connector code and create Mellox branches/PRs rather
than pushing to or merging a base branch.

## Current automation model

Automation in Mellox AI is intentionally bounded. It can schedule work, claim
jobs, read or write controlled repository files, or update provider status, but
it must stay inside the workspace, provider, and approval constraints defined by
server-side code. This is a core product principle: automation extends human
decision-making without removing accountability.

## Automation

Cron/public hooks include agent ticks, GEO scans and agents, scheduled jobs,
UGC renders, analytics sync, competitor watch, operations watch, SDR
reconciliation, and provider webhooks. Claim functions use leases and
`SKIP LOCKED`-style database coordination where implemented. Jobs must be
idempotent because hooks can be retried.

## Tool execution boundary

Read-only repository tools, safe fetching, GitHub API access, and provider
adapters are server-only. Do not expose raw provider responses, credentials,
model reasoning, or arbitrary filesystem writes to the browser.

Deep references: [GEO coding agent ADR](adr/0013-geo-coding-agent-and-repo-ownership.md),
[agent control plane ADR](adr/0007-agent-control-plane.md), and
[fix workflow](adr/0012-geo-fix-pull-requests-and-verification.md).
