# Scheduled jobs — status and how to enable them

> **Superseded procedure.** This file previously covered only the
> `competitor-watch-scan` job. The problem is broader: **no cron job is
> scheduled at all**, and three separate features depend on one. The enable
> procedure now lives in **[`ENABLE-CRON-JOBS.sql`](./ENABLE-CRON-JOBS.sql)**.

## Current state

`cron.job` is empty of app jobs. The original `competitor-watch-scan`
(migration `20260709194553`) was unscheduled by `20260903000000` and never
replaced, because it had two defects:

1. **Stale target** — it pointed at an old preview deployment URL.
2. **Wrong auth** — it sent an `apikey` header, but every hook in
   `src/app/api/public/hooks/*` requires `x-cron-secret` equal to
   `CRON_SECRET` and explicitly never falls back to the publishable or
   service-role key. As written it would have been rejected with 401.

The original migration file is left unchanged.

## What is silently not running

| Hook                                 | Feature that stops working                                                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/api/public/hooks/run-schedules`    | **Scheduled content never publishes**, and Market Brain collections are never refreshed (`runDueScheduledJobs` + `runDueMarketBrainCollections`) |
| `/api/public/hooks/competitor-watch` | Competitor alerts are never generated (`runDueCompetitorScans`)                                                                                  |
| `/api/public/hooks/sdr-reconcile`    | Publications can sit stuck in `publishing`/`pending` with no sweep to resolve them                                                               |

`run-schedules` is the one that matters most: a user can schedule a post in the
calendar, see it accepted, and it will never go out.

## How it is enabled now

Two pieces, split so that no secret or environment URL is ever committed:

1. **`migrations/20260911000100_add_app_hook_caller.sql`** — creates
   `public.call_app_hook(path)`, which reads the app origin and cron secret
   from Supabase Vault at call time and POSTs with the correct
   `x-cron-secret` header. Safe to apply everywhere: it schedules nothing, and
   raises a clear error if the Vault entries are absent.

2. **`ENABLE-CRON-JOBS.sql`** — run manually in the SQL Editor, once per
   environment. Creates the two Vault secrets, verifies one call end to end,
   then schedules all three jobs.

Because the secret is read from Vault on every run, rotating `CRON_SECRET` is a
`vault.update_secret` call — the jobs do not need rescheduling.

## Prerequisites

1. The app is deployed at a public HTTPS origin reachable from Supabase.
2. `CRON_SECRET` is set in the app environment, 16+ characters (the hooks
   return 503 below that; 32+ recommended).
3. Migration `20260911000100` has been applied.
