# Billing v2 progress

- **Branch:** local `master` (the user requested the feature branch be merged locally; no push)
- **Current phase:** 3 — enforcement, in progress
- **Delivery priority:** end-to-end billing UI and server flow before more backend-only routes, per the user's latest direction.
- **Last verified phase:** 2 — engine

## Landed

- Read repository instructions, implementation brief, catalog and section 0 source files.
- Mapped legacy plan/budget readers, backlink ledger callers, SocialAPI connect paths, major paid routes and feature UI entries.
- Wrote `docs/billing/PLAN.md` and ADR-0027 before code changes.
- Created the requested branch while preserving the checkout's pre-existing uncommitted changes.
- Added the typed pricing catalog, account-owned billing schema, grants, balances, holds, charges, account meters, append-only ledger, legacy backlink wrapper, and shadow/event tables.
- Added account migration and meter database tests plus catalog invariant tests.
- Phase 1 gate passed: typecheck, lint, 157 test files / 1,579 tests, build, and db:verify (82 migrations, 56 reapplied cleanly, 118 public tables with RLS).
- Phase 1 committed as `a4aefa5` (`feat(billing): add account wallet foundation`).
- Added server account and entitlement resolution, typed meter calls, success-only `runMetered`, structured 402 errors, account budget safety scope, usage/charge attribution, and protected teammate reads.
- Added first-access Free grants, recurring grant logic, annual rollover, the five-minute billing hook, shadow events, and entitlement/wallet GET routes.
- Studio social jobs now log a 12-credit would-charge in shadow mode without a hold. Unit, route and database tests cover this path, budget mode selection, 402 mapping, account attribution and grant window maths.
- Phase 2 gate passed: typecheck, lint, 162 test files / 1,604 tests, build, and db:verify (84 migrations, 58 reapplied cleanly, 118 public tables with RLS).
- Phase 3 checkpoint committed as `9a915d4` (`wip(billing): checkpoint phase 3 enforcement wiring`). This is not the phase completion commit.

## Phase 3 work in progress

- Added success-only holds to Studio ideas and prompts, file extraction, image generation, social generation and chat; chat uses deferred holds that settle after the stream and supports separate Flash and Pro message meters with Pro overage behavior.
- Added account-level brand and seat checks, including transactional database enforcement at brand creation, invite acceptance and paid-role promotion. Added PGlite tests for brand and seat limits.
- Removed the legacy monthly social post quota. Connected SocialAPI profiles now determine the publishing limit; posting has a daily fair-use ceiling instead of a monthly plan quota.
- Studio image and video jobs now link the hold before provider work starts, then settle on completion, failure or cancellation. Billing cron advances and reconciles jobs when the browser closes.
- UGC renders now hold Video Credits before their workers can claim work. The database readiness flag prevents early claims; terminal webhooks and billing cron reconcile capture or release. Added worker and database claim tests.
- Brand DNA reserves one free scan per account and domain, charges catalog credits for later scans, and withholds the final streamed result until billing succeeds. Campaign briefs and the synchronous Studio video route now use server holds and success-only capture.
- Long AI generation now charges the Standard article action on Workhorse, and uses the Premium model and action only for accounts entitled to premium articles.
- SocialAPI OAuth now reserves a brand-level profile slot under an account lock before provider work. Callback and selection refresh the reservation and activate it on success; disconnect releases an empty brand's slot. PGlite tests cover account capacity and same-brand reuse.
- Manual Market Brain refresh now uses a success-only hold. Cached, pending, and failed results release it; the follow-up intelligence request checks the feature without a second charge. UGC concept generation and on-demand analytics insight refresh now use success-only holds, with browser idempotency keys on these paths.
- Added a route coverage test for the model registry against paid catalog actions and included work. It passes. A shared feature check now protects included Market Brain analysis in enforcement-on mode.
- Added a live account wallet pill and Plan & billing panel with five catalog plans, monthly/annual prices, shared balances, and clear 402 upgrade, balance, limit and frozen-brand messages. Authenticated REST fetches now emit billing events on structured 402 and balance headers. UGC extraction and notes check the UGC feature; included feature checks log would-blocks in shadow mode.
- After the UI slice, typecheck, production build, db:verify (89 migrations, 121 RLS tables), changed-file lint, and focused event/feature tests (7 tests) passed. The full test suite and manual UI pass remain unverified for this checkpoint.
- Focused Studio, UGC, metering, brand, seat, social profile, and database migration checks passed. The full test suite passed before the latest SocialAPI slot change (167 files, 1,620 tests); focused SocialAPI tests, typecheck and changed-file lint passed after it. Full lint passed with 450 warnings, build passed, and db:verify replayed 89 migrations. The complete Phase 3 gate and manual shadow/on pass have **not** run, so Phase 3 is not complete.

## Next

1. Build the Paddle checkout, webhook and subscription flow behind the new UI; replace the legacy Stripe pack-only checkout route without touching Paddle production.
2. Complete remaining paid paths and client FeatureGate/CostChip coverage, then run full tests and manual shadow/on checks. Continue lifecycle, included work, admin and launch hardening against the brief's acceptance criteria.

## Open questions and risks

- **ASK ZAIN before production backfill:** which existing accounts receive comps and whether the proposed grandfathering rule is approved. This does not block local phase work.
- Production database and Paddle production are untouched.
- Many unrelated files were already modified on `main` when this branch was created. Do not stage or discard them as part of billing work.
- The migration refuses to backfill live legacy holds, since moving a partially held backlink balance would risk double spending. Its production precondition needs review against real data before application.
- Teammates can still read legacy `workspaces.owner_id` under existing workspace grants. The new `billing_account_id` is hidden from nonowners; owner-id privacy needs further enforcement work.
- PGlite covers function behavior and RLS but cannot prove concurrent holds. Run the real PostgreSQL concurrency test in phase 9.
- The Phase 3 enforcement map remains incomplete. Keep `BILLING_ENFORCEMENT=off` outside local tests until every paid entry path and background-work rule is gated.
- The latest full gate passed typecheck and lint (450 existing warnings), then found two billing-only labels missing from the task-model registry. Those labels were added to its non-model list; the focused registry and Market Brain tests now pass (20 tests). The full test suite, build, and db:verify have not been rerun after that fix, so no new phase gate is claimed.
- UGC pricing currently caps actual-provider-cost capture at the quoted hold; phase 7 provider routing must make the quoted Video Credits cover the chosen provider and fallback.
- A failed or abandoned OAuth attempt holds a SocialAPI profile slot for up to 35 minutes; the next phase should expose this pending state in billing UI and operator diagnostics.
- The Brand DNA stream holds its final result until capture, but a persistent recovery path is still needed if the capture RPC is unavailable after provider work succeeds.
- Tracked prompt usage is zero until the new tracked-prompt feature arrives in phase 7. The entitlement shape already includes it.
