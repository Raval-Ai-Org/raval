# Mellox Billing v2 implementation plan

Status: phase 1 verified; phase 2 next on `feat/billing-v2`.

## Inputs and baseline

- Authority for prices and feature copy: `docs/pricing/v2/catalog.reference.ts.txt`. The attached “New IMPLEMENTATION_BRIEF.md” only changes agent wording, adds a progress log, and requests an `AGENTS.md` pointer at phase 9; it does not change product requirements.
- The checkout started on `main` with many unrelated, uncommitted edits, including the untracked pricing directory. The new branch carries this working tree. Stage only billing-owned paths in phase commits; never reset or absorb the pre-existing edits.
- The current product uses workspace-scoped plans, budgets and backlink credits. The billing account must become the authoritative owner-level scope while `off` and `shadow` retain today's budget and quota behavior.
- Database tests use `tests/db/`; inspect its PGlite harness. Use a real concurrent PostgreSQL check in phase 9 because PGlite cannot prove concurrent holds.

## Code map

| Concern | Current paths and callers | Planned change |
|---|---|---|
| Legacy plan reads | `src/server/plans.ts` defines `normalizePlanId`, `getPlanLimits`, `monthlyImages`, `monthlyVideos`, `monthlyPosts`, `geoMaxPages`, `maxConcurrentExperiments`. Readers: `src/server/ai/budget.ts`, `src/server/ugc/service.server.ts`, `src/server/geo/service.server.ts`, `src/server/fns/geo.ts`, `src/server/experiments/service.server.ts`, `src/lib/socialapi/workspace.server.ts`, `src/app/api/usage/route.ts`, `src/app/api/social/analytics/route.ts`. `src/server/fns/workspaces.ts` also reads `workspaces.plan`. | Replace readers with account entitlements. Keep a temporary legacy shim for `off` and `shadow`. Unknown plans become Free when enforcement is on. |
| Budget and provider metering | `checkBudget` / `enforceBudget` in `src/server/ai/budget.ts`; callers in `src/lib/ai-gateway.server.ts`, `ai-gateway.tool-loop.server.ts`, `openrouter-image.server.ts`, `tavily-gateway.server.ts`, `market-signals-collection.server.ts`, Studio runner, video route, and link service/profile/match. `src/server/ai/metering.ts` records gateway use. | Preserve fail-open budget behavior and model degradation. Switch to `acct:<id>` and catalog safety only in `on`, add `billing_account_id` and `charge_id` to usage events, and remove image/video quantity quotas in `on`. |
| UGC | `src/server/ugc/service.server.ts` reads workspace plan, monthly video quota and `maxConcurrentRenders()` from `src/server/ugc/models.server.ts`; `src/lib/ugc/router.ts` and `src/server/ugc/providers/routed.server.ts` select providers. | Keep AI reservations for concurrency. Use video-meter holds for money, account limits for concurrency, and catalog provider routes/fallbacks. |
| Social profiles and posts | `src/lib/socialapi/workspace.server.ts` provisions `workspace_socialapi` and enforces `socialPostQuota` via `social_usage_events`; `src/lib/socialapi/handlers.ts` connects/selects/disconnects. Entry routes: `src/app/api/sdr/oauth/start`, `social/connect/complete`, `social/connect/select`, `sdr/disconnect`, `sdr/accounts`. `src/app/api/social/analytics` and `/api/usage` show monthly post quotas. | Gate connect at the server and database profile count; keep events as analytics and add daily fair use. A SocialAPI brand can be provisioned before a network is connected, so count active connected profiles, not provisioning rows. Preserve per-network count separately. |
| Backlink money | `src/server/links/credits.server.ts` calls `apply_credit_entry` for top-up, order hold, release, per-line capture and refund; callers are link service, order runner, poller and legacy `src/server/billing/stripe.server.ts`. SQL lives in `20260925090000_link_marketplace.sql` and `20260925090100_link_marketplace_rpcs.sql`. | Add account grants, holds and ledger; migrate paid balances as `any`; wrap `apply_credit_entry` with old-key replay checks, partial captures and explicit finalization. Keep the Stripe webhook for historical replay only. |
| Workspace and seat security | `private.create_workspace_for_user` and `private.guard_workspace_columns` in `20260920090000_canonical_workspaces.sql`; workspaces service in `src/server/workspaces/service.server.ts`; invites in `src/server/fns/workspaces.ts`. | Add `billing_account_id` and frozen/cap columns, extend guarded columns, enforce brand and distinct paid-seat limits under account locks, including direct browser writes allowed by RLS. |
| Paid user entry paths | REST: Studio jobs/ideas/prompt, chat, brand-extract, generate-image/video, ai-generate, social-multi, file-extract, campaign generation, market refresh, GEO scans, UGC concepts/renders, publishing and social connect. Server functions: content regeneration/batch/next post, coach, competitors, analytics insights, GEO fixes/agent, experiments, brand-kit writing analysis and backlink orders. The route registry is `src/server/ai/task-models.ts`. | Put holds at the operation boundary, capture after actual success (including stream completion and async workers), and add a registry coverage test. Background included work stays bounded but is not debited. |
| Feature UI entry paths | `src/app/app/AppShell.tsx` mounts/sidebar-links Studio, AI Visibility, UGC, Marketing Coach, client portal, backlinks and Proof Engine; `src/components/app/AccountMenu.tsx` opens `UsagePanel.tsx`; feature actions live in `src/components/app/StudioRail.tsx`, `ChatPanel.tsx`, `AiVisibilityDialog.tsx`, `MarketingCoachPanel.tsx`, `ClientPortalDialog.tsx`, `ContentCalendar.tsx`, `CommandBar.tsx`, `src/components/app/ugc/`, `src/components/app/geo/`, `src/components/app/competitors/`, `src/components/app/links/`, `src/components/app/experiments/`, and `src/components/studio/`. | Add common entitlements provider, `FeatureGate`, `CostChip`, wallet, and billing modals, then wrap every discoverable entry. Server 402s drive the same modals. |

## Ordered execution

Each phase ends with `npm run typecheck && npm run lint && npm test && npm run build && npm run db:verify`, a `PROGRESS.md` update, and a commit containing only that phase's files. Do not claim a check passed unless it ran.

1. **Foundation:** move catalog, create account/meter/ledger/hold/event schema and SQL functions, protect workspace columns, migrate existing backlink balances safely, add database tests. Keep enforcement off.
2. **Engine:** account and entitlement resolution, typed meter operations, `runMetered`, structured 402 errors, grants and sweeper, account usage attribution and budget scope, shadow logging, wallet and entitlement reads.
3. **Enforcement:** connect all paid paths and included-work limits, account brand/seat/profile limits, frozen behavior, chat meters, and route coverage.
4. **Experience:** provider, locks/prices/modals, global 402 handling, plan and billing surface, onboarding, landing page pricing, accessibility and end-to-end checks.
5. **Paddle:** verify current official API documentation, sync script, server-only API adapter, checkout/changes/packs/add-ons/portal/trials, signed webhook inbox and reconciliation; test the sandbox flow.
6. **Lifecycle:** grants and rollover at renewals, scheduled changes, grace, pause, refunds and debt, comps, notifications and email with dedupe.
7. **Included work and cost:** video provider routing, tracked prompts, schedules, Monday briefing, competitors cadence and model cost fixes.
8. **Admin and monitoring:** guarded audited console, margins, capacity/fallback alerts, shadow report and webhook replay.
9. **Hardening:** full tests, live sandbox and concurrent PostgreSQL holds, security/performance review, docs/runbook and legal drafts. Production migrations and enforcement switch require explicit approval.

## Verification and migration gates

- Replay migrations locally or on staging only. Check idempotency and RLS; no production database or Paddle production mutation in this branch.
- The historical backlink ledger is append-only. Refuse migration when an order is non-terminal unless its live hold can be reproduced exactly; record the actual decision in ADR-0027.
- Manual shadow/on checks must cover streams, async jobs, failure release, multi-brand account sharing, viewer denial, teammate privacy, and owner-only purchase.
- Before merge ask Zain to choose grandfathered accounts and approve the comp rule; ask separately before merge itself. Record any unavailable sandbox credentials or services as unverified, not green.

## Phase notes

- Planning: code map and ADR written before implementation.
- Phase 1: typed catalog, owner account link and protected workspace column, account grant/hold/charge/ledger schema, SQL meter operations, old backlink wrapper, balance backfill, signup grant, and database/catalog tests. Live legacy holds abort the migration for manual resolution. Gate passed: typecheck, lint, 1,579 tests across 157 files, build, db:verify (82 migrations, 56 idempotent replays, 118 public RLS tables). The working tree's unrelated edits remain unstaged.
