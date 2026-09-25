# ADR-0027: Account billing, grants and credits

- **Status:** proposed for Billing v2
- **Date:** 2026-09-26
- **Source:** `docs/pricing/v2/IMPLEMENTATION_BRIEF.md`, `catalog.reference.ts.txt`, and the existing billing, workspace and AI metering code

## Context

Plans, AI safety budgets, image/video quotas and backlink credit balances currently live per workspace. A workspace is one brand, while a customer may own several brands and invite teammates. Social publishing currently counts posts; the target commercial model counts connected SocialAPI profiles. Stripe top-ups exist for backlinks, but a Pakistani merchant needs Paddle Billing for new purchases.

## Decisions

1. One lazily created billing account per owner user. Every workspace points to the owner's account. Verified editors and admins spend that account's wallet inside the brand; viewers cannot start paid work. Owners alone buy, change plans and set caps. Teammates see balances and their brand's history without account ids, other brand names or the full ledger.
2. The browser-safe catalog is the source for Free, Starter, Growth, Agency and Scale prices, features, limits and action charges. Annual plans cost ten monthly payments per year, with allowances granted monthly. Unknown plans resolve to Free in the new system.
3. Four integer meters: credits; video units (100 per VC, never funded by general credits); Pro messages; Flash messages. Money is priced on the server from catalog keys, never request amounts.
4. Balances consist of source-attributed grants with optional expiry and `any` or `ai_only` restriction. Backlinks consume `any` only. Consumption uses earliest expiry, then `ai_only` before nonexpiring `any`. Refund shortfalls become meter debt; later grants clear debt before usable balance grows.
5. Every paid action holds before spending and captures only after success, or releases on failure. Holds allocate specific grants, support partial captures and explicit finalization, use action-specific TTLs, and reject replayed action keys without rerunning work. Live async work protects its hold from premature sweeping. Both balances and ledgers change atomically under an account/meter lock; ledgers are immutable and keys come from stable ids.
6. Annual unused plan credits and video units may roll into the next window once, capped at one month's allowance. Monthly plans do not roll. Upgrades and add-on increases take effect immediately with prorated difference grants; downgrades, reductions and cancellation take effect at period end. Pause is a $9 read-only state, limited to six months; past-due access lasts seven days with grants withheld.
7. Preserve the existing fail-open AI budget as a separate circuit breaker. Enforcement `off` and `shadow` keep workspace budgets/quotas. `shadow` logs decisions but does not charge or block features. `on` uses `acct:<id>` and catalog safety ceilings plus pack spend. Backlink holds, grants and Paddle money events are always real in all modes.
8. Paddle Billing owns new subscriptions, trials, add-ons, packs, invoices, tax, dunning and portal access. The legacy Stripe path remains for historical webhook replay only. Signed Paddle webhooks use a persisted inbox and resolve the account through server-created checkout intents, customer ids and mapped price ids. No browser callback grants value.
9. Social publishing limits active connected profiles, one brand per profile, with unlimited posts subject to fair use. `social_usage_events` remains for analytics. Connected networks are counted separately. All feature entries stay visible, with server 402 enforcement and the same upgrade/limit UI.
10. Keep brand, seat, social, included-work and frozen-state limits at the trusted boundary. Brand and seat limits need database protection because some RLS policies permit direct client writes. Frozen brands retain data and are read-only.
11. New tables have RLS and service-role-only money writes. Account owner reads their own details; non-owner reads are reduced to brand-scoped projections. Immutable ledger rows do not foreign-key to deletable auth users.
12. Production rollout starts in shadow for three to seven days, then a founder account override, then global on only after review. Production database and Paddle production mutations require Zain's approval.

## Existing-code adaptations and open decisions

- `workspaces.plan` and `src/server/plans.ts` are in active use, including UGC, GEO, Proof Engine, social analytics and `/api/usage`. Keep a compatibility path until these readers move; legacy `off`/`shadow` behavior must not squeeze existing users into Free limits.
- `workspace_socialapi` is provisioned before a network is connected. Profile usage therefore comes from active connected provider profiles, not every provisioning row. The former monthly post quota becomes daily fair use plus event analytics.
- `apply_credit_entry` is a single workspace ledger mutation today, including partial line captures. The account wrapper must check historical keys first and preserve those outcomes; migration will refuse a live order when exact hold reconstruction cannot be proved.
- The foundation migration uses a service-role-only `meter_rollover(jsonb)` wrapper rather than the brief's two-argument signature because the catalog allowance cap must come from the server's typed catalog, not duplicated in SQL. It expires only the previous plan grant and creates one capped rollover grant; earlier rollover grants cannot roll again.
- The old append-only backlink ledger also had `order_id` and `line_id` `ON DELETE SET NULL` foreign keys, in addition to `actor`. All three are removed so deleting a referenced row cannot attempt an update to a money record.
- Existing backlink holds are deliberately not reconstructed automatically. The migration fails if any workspace credit balance has `held > 0`; an operator must settle or explicitly migrate that hold before applying to a populated database. This is stricter than checking link-order status, because the old balance is the financial truth.
- The source brief asks for ADR-0027; 0027 is free, although the code references ADR-0026 without a file currently present.
- The checkout began with many unrelated uncommitted edits. Billing commits will stage paths explicitly. This is a repository-state adaptation, not a product change.
- **ASK ZAIN before production backfill/launch:** confirm the grandfathering/comp list and rule. No production backfill is authorized by this ADR.

## Consequences

Account-level pooling makes multi-brand usage and teammate spend consistent, but requires strict account resolution and privacy projections at every API. Immutable grants and allocations make refunds, expiry, rollover and replay auditable. Shadow mode allows comparison against actual costs before charging begins; no phase is launch-ready until full tests and Paddle sandbox verification complete.
