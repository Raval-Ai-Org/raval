# Billing v2 progress

- **Branch:** `feat/billing-v2`
- **Current phase:** 2 — engine, next
- **Last verified phase:** 1 — foundation

## Landed

- Read repository instructions, implementation brief, catalog and section 0 source files.
- Mapped legacy plan/budget readers, backlink ledger callers, SocialAPI connect paths, major paid routes and feature UI entries.
- Wrote `docs/billing/PLAN.md` and ADR-0027 before code changes.
- Created the requested branch while preserving the checkout's pre-existing uncommitted changes.
- Added the typed pricing catalog, account-owned billing schema, grants, balances, holds, charges, account meters, append-only ledger, legacy backlink wrapper, and shadow/event tables.
- Added account migration and meter database tests plus catalog invariant tests.
- Phase 1 gate passed: typecheck, lint, 157 test files / 1,579 tests, build, and db:verify (82 migrations, 56 reapplied cleanly, 118 public tables with RLS).

## Next

1. Build account and entitlement resolution, server meter operations, structured 402 errors, grants and sweeper, usage attribution, budgets, shadow logging, and entitlement/wallet reads.
2. Verify the Studio shadow charge end to end, run the full phase 2 gate, update this file, and commit.

## Open questions and risks

- **ASK ZAIN before production backfill:** which existing accounts receive comps and whether the proposed grandfathering rule is approved. This does not block local phase work.
- Production database and Paddle production are untouched.
- Many unrelated files were already modified on `main` when this branch was created. Do not stage or discard them as part of billing work.
- The migration refuses to backfill live legacy holds, since moving a partially held backlink balance would risk double spending. Its production precondition needs review against real data before application.
- Teammates can still read legacy `workspaces.owner_id` under existing workspace grants. The new `billing_account_id` is hidden from nonowners; owner-id privacy needs further enforcement work.
- PGlite covers function behavior and RLS but cannot prove concurrent holds. Run the real PostgreSQL concurrency test in phase 9.
