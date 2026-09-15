# ADR-0013: Mellox GEO Engineer — a coding agent that fixes findings in verified repositories

- Status: Accepted
- Date: 2026-09-17
- Builds on: ADR-0010 (AI Visibility), ADR-0011 (GitHub connector), ADR-0012 (fix PRs and verification)

## Context

ADR-0012's fix workflow was never exercised on a real setup: the GitHub App
was installed but never linked to a workspace, nothing proved a linked
repository actually built the scanned site, and fixes were limited to ~15 rules.
Each fix guessed one target file by path pattern and made a single model call
that could only see that file. Real repositories use dynamic routes, shared SEO
components, metadata helpers and data files, so most findings became "manual".

## Decision

1. **Repository ↔ website ownership is proven before any change.**
   - `src/lib/connectors/ownership.ts` scores the evidence and
     `src/server/connectors/github/ownership.server.ts` collects it.
   - Evidence:
     - GitHub-reported hosting: the Pages API site, or a successful deployment
       status at the host;
     - the repository's homepage field;
     - a Pages CNAME;
     - site URLs in config files;
     - the host written in source;
     - the live page's title, description, headings and distinctive sentences
       found in source.
   - A homepage or Pages site pointing elsewhere counts against the repository.
   - Verdicts:
     - `verified` means GitHub-reported hosting with no contradiction, or a
       strong signal backed by content evidence (≥ 0.3), or confidence ≥ 0.8
       with a strong signal or strong content evidence.
     - Otherwise the verdict is `likely`, `unverified` or `mismatch`.
   - Proposals, approvals, batches and agent runs are refused unless the
     repository is verified for the host, checked within the last 7 days.
   - The verdict, evidence and hints are stored on `workspace_sources`
     (migration `20260917090000_add_source_ownership.sql`).
   - Changing the site or branch resets the verdict.

2. **A tool-using agent replaces one-shot generation.** `src/server/geo/agents/`:
   - `claudeToolLoop` (`anthropic-gateway.server.ts`):
     - meters and budget-checks every turn;
     - uses strict tools and handles parallel tool calls;
     - puts cache breakpoints on the system prompt and the latest turn;
     - enforces caps on turns, cost and wall clock, and supports cancellation;
     - handles refusals, cut-off turns and context overflow.
   - Model: `GEO_AGENT_MODEL`, default `claude-sonnet-5`.
   - Read-only tools (`repo-tools.server.ts`):
     - `list_files`, `search_code`, `read_file`;
     - `get_page_facts`, `get_rule_info`;
     - `inspect_live_page` (the SSRF-guarded fetcher, same host only).
   - Tool limits:
     - Credential paths are never read.
     - Secrets are redacted before anything reaches the model.
     - Regexes are limited to safe patterns.
     - Reads are capped at 300 blobs per run.
   - Stages (`geo-coding-agent.ts`):
     - **investigate → `submit_plan`.** The server rejects a plan that changes
       a file the agent didn't read, touches a path outside `checkRepoPath`,
       exceeds 4 files, or targets a manual-only rule.
     - **The person approves the plan.** Approval is bound to a SHA-256 hash of
       the plan plus the user's inputs.
     - **implement → `submit_patch`.** Exact find/replace edits to the planned
       files; each `find` must match exactly once.
     - **Self-review.** A separate structured call.
     - **Deterministic validation.** The `validate.ts` checks, plus:
       - plan scope;
       - grounding;
       - a deletion cap;
       - imports limited to framework helpers the repository already depends
         on, or local files that exist.
     - **Correction.** At most two rounds, driven by review blockers and failed
       checks.
   - **Grounding** (`fixes/grounding.ts`): new visible text, meta values and
     JSON-LD strings must come from the scanned site text, the file's existing
     text, or facts the user supplied. When a fix needs a fact Mellox doesn't
     have, the agent asks for it (`needs_input`).
   - **Strategies** (`fixes/strategies.ts`): every rule is `deterministic`,
     `agent` or `manual`, with its rescan scope, required inputs, manual steps
     and validation steps. Legal pages, sourcing, hosting/CDN/header changes,
     SPA→SSR migrations and content substance stay manual. A test enforces that
     every rule has a strategy.

3. **Runs are durable leased jobs** (migration
   `20260917090100_add_geo_agent_runs.sql`).
   - Tables:
     - `geo_agent_runs` holds the status machine (`src/lib/geo/agent-state.ts`),
       plan, inputs, files inspected, patch, review, validation, usage and the
       conversation checkpoint.
     - `geo_agent_events` holds the activity log. It stores only summaries of
       real tool calls and transitions, never model reasoning.
   - Execution:
     - Runs are claimed with `claim_geo_agent_runs` (SKIP LOCKED) and advanced
       by `after()` and the `geo-agents` cron hook.
     - Each turn checkpoints the conversation and renews the lease.
     - Status writes are compare-and-set.
   - Access: members read; only the service role writes.
   - Cancel closes Mellox's pull request and deletes its `mellox/` branch.
   - Retry starts a new run, either from investigation or from the approved plan.

4. **The existing proposal → PR → verification chain is reused unchanged.**
   - A validated patch becomes a draft `geo_fix_proposals` row (`agent_run_id`).
   - Approval (exact content hash), the `mellox/` branch, the PR, CI state,
     merge sync and verification rescans are those from ADR-0012.
   - `syncAgentRunFromProposal` mirrors proposal and verification status into
     the run.
   - Only `verify.server.ts` resolves a finding.

5. **Scores explain themselves across nine dimensions** (`src/lib/geo/dimensions.ts`).
   - Dimensions: crawlability, indexability, technical SEO, extractability,
     answer readiness, entity clarity, structured data, authority & trust, and
     AI search readiness, plus overall readiness.
   - All are computed from the rule summaries the server already stores per
     scan, so there is no re-evaluation and no backfill.
   - The legacy overall score and `geo_audit_runs` are unchanged.

6. **Findings carry decisions.**
   - "Mark reviewed" and "ignore with a reason" are new columns on
     `geo_finding_states`; RLS still refuses browser-set `resolved`.
   - State changes go through one bulk RPC.
   - Findings report their fix mode and rescan scope.

## Consequences

- Repository code is sent to Anthropic. An admin must record consent per
  repository (`agent_consent_at`), and checkpoints are purged a day after a run
  leaves the working states.
- Costs are capped at `GEO_AGENT_MAX_COST_USD` (default $1.50 per run) and
  `GEO_AGENT_DAILY_RUNS` (default 20 per workspace), plus the `geo-agent` and
  `geo-agent-action` rate-limit tiers.
- Sites whose repository can't be proven (for example a SPA hosted on a platform
  that reports no deployments, with no homepage field set) stay manual until the
  owner adds a proof. The UI lists what would prove ownership.
- The GitHub App should grant Deployments: read and Pages: read. It should also
  subscribe to `deployment_status` for deployment evidence and preview
  validation. Without them those signals are reported as unavailable, never
  assumed.
