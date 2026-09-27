# Mellox account billing rollout (v2.3)

## Current state

The USD catalog matches the attached v2.3 workbook. The checked-in workbook differs only in the description of the extra-brand add-on. Plan, pack, and eligible add-on Checkout flows use Stripe prices mapped on the server. Purchases remain disabled until a signed webhook has processed successfully in the matching Stripe mode and every available catalog price is mapped.

Daily tracking, daily Market Brain, AI Overviews, and custom white-label domains are not sold yet. Their add-ons remain in the catalog as planning entries because the corresponding recurring work or domain setup is incomplete. The available add-ons are extra brand, weekly prompts, Pro messages, and extra seat.

## Staging gate

1. Replay all migrations in staging and run `npm run db:verify`. The legacy backlink migration intentionally aborts when historical holds are live; reconcile those orders before applying it.
2. Run `npm run billing:stripe-sync` to review USD prices, then `npm run billing:stripe-sync -- --apply` with Stripe test and Supabase staging credentials. The script validates existing Stripe prices and writes only missing mappings.
3. Configure `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` for the same mode. Deliver a benign signed Stripe event to `/api/public/hooks/stripe`. Check `/api/admin/billing` for `providerHealth.webhook_verified_at`. Set `BILLING_ADMIN_USER_IDS` to explicit trusted user UUIDs; absent configuration denies all admin access.
4. Exercise test-mode trial, monthly and annual plan, all pack types, add-on increases, scheduled decrease, pause, resume, cancellation, payment failure, refund and dispute. Verify account balances, grants, debt, capacity recovery and duplicate webhook behavior after each. No production Stripe mutation is part of this repository change.
5. Run the full application gate: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run db:verify`. Run concurrent meter holds against a real staging PostgreSQL instance; the in-process PGlite suite does not prove concurrent transactions.

## Enforcement sequence

1. Start with `BILLING_ENFORCEMENT=shadow`. Review `GET /api/admin/billing` for would-block events, failed webhooks, expired holds, debt, margin attribution and payment totals. Reconcile payments with Stripe before advancing.
2. Set one test account's `enforcement_override` to `on` through `POST /api/admin/billing/enforcement` with an operation UUID and reason. The server reconciles brand and seat capacity immediately and writes an append-only audit. Verify every paid path, read-only frozen brands, seat downgrade and restoration, streams, background jobs and multi-brand wallet sharing.
3. Set `BILLING_ENFORCEMENT=on` only after the reports and payment reconciliation agree. The billing cron sweeps existing accounts for brand and seat capacity; entitlement reads reconcile an unchecked account before access. Existing data remains retained while excess brands become read-only and excess paid roles become viewers.

The admin adjustment endpoint accepts a fixed operation UUID, account UUID, amount and reason. Grants are AI-only and cannot create backlink-eligible value. Clawbacks target an existing grant, can create debt, and both operations are recorded in an append-only adjustment audit and the meter ledger.

## Unverified external gates

Stripe credentials, webhook delivery, price mappings, test-mode purchases, production payment reconciliation and a real PostgreSQL concurrency run require the later Stripe setup and a staging database. Keep purchases unavailable and global enforcement off until these gates pass.
