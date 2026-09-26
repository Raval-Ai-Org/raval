# Billing v2 progress

- **Branch:** `feat/billing-v2`
- **Current phase:** 3 — enforcement, next
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

## Next

1. Wire section 7 and 10b paid entry points through server holds, including completion-time capture for streams, Studio media, UGC renders, schedules and agents.
2. Enforce account brand, seat, profile, included-work and frozen limits, remove the monthly post quota, add route coverage and manual shadow/on checks, then run the full phase 3 gate and commit.

## Open questions and risks

- **ASK ZAIN before production backfill:** which existing accounts receive comps and whether the proposed grandfathering rule is approved. This does not block local phase work.
- Production database and Paddle production are untouched.
- Many unrelated files were already modified on `main` when this branch was created. Do not stage or discard them as part of billing work.
- The migration refuses to backfill live legacy holds, since moving a partially held backlink balance would risk double spending. Its production precondition needs review against real data before application.
- Teammates can still read legacy `workspaces.owner_id` under existing workspace grants. The new `billing_account_id` is hidden from nonowners; owner-id privacy needs further enforcement work.
- PGlite covers function behavior and RLS but cannot prove concurrent holds. Run the real PostgreSQL concurrency test in phase 9.
- Studio image and video jobs currently return 503 if an account override enables enforcement `on`; phase 3 must replace this guard with persistent async holds and completion-time capture before anyone is switched on.
- Tracked prompt usage is zero until the new tracked-prompt feature arrives in phase 7. The entitlement shape already includes it.
