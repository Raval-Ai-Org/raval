# Deferred: `competitor-watch-scan` pg_cron job (migration 20260709194553)

> **Status: DEFERRED — do NOT apply until the app has a real production deployment URL.**
> The original migration file `supabase/migrations/20260709194553_bb8d43fe-2f5e-48cb-9c77-8042cb96e8be.sql`
> is left **unchanged** and is **excluded** from the final-state apply set in
> `apply_migrations_cli.py` / `apply_migrations_via_cli.py`.

## Why it is deferred

1. **Stale target.** The SQL points at `https://raval6.lovable.app/api/public/hooks/competitor-watch`,
   the old Lovable app, which will not exist for the new Raval deployment.
2. **No production URL yet.** Raval is not deployed (no Vercel URL). We must not invent a
   URL, and must not put a placeholder into production SQL that could accidentally fire.
3. **Incompatible auth contract.** The job sends an `apikey` header. The current app hook
   (`src/routes/api/public/hooks/competitor-watch.ts`) requires a dedicated
   **`x-cron-secret`** header equal to the `CRON_SECRET` env var (it explicitly never falls
   back to the publishable/service-role key). As written, the job would be rejected (401).
4. **Not required to build the schema.** `competitor_watches` / `competitor_alerts` tables
   are created by `20260709194343` and exist without this job. The cron only triggers the
   background scan that *populates* alerts.

## What the original SQL does

- Ensures `pg_cron` and `pg_net` extensions.
- Creates (and re-schedules) a pg_cron job named `competitor-watch-scan`, every 30 min.
- Each run: `SELECT net.http_post(url := '<app>/api/public/hooks/competitor-watch', headers := {...}, body := '{}')` — an **HTTP POST** with `Content-Type: application/json`, an `apikey` header, and an empty JSON body.

## The hook it must call

Route: `POST /api/public/hooks/competitor-watch`
- Requires header `x-cron-secret` == `process.env.CRON_SECRET` (length ≥ 16).
- Returns 401 without a matching secret; 503 if `CRON_SECRET` is unset/too short.

## Required before this can be applied

Fill in **real** values (do not guess / do not commit placeholders):
1. `CRON_SECRET` — a long random string (32+ chars) set as an env var on the deployed app
   (and in `.env` for local cron testing). This must match what the hook checks.
2. `APP_BASE_URL` — the real deployed production origin, e.g. `https://<vercel-domain>`.
3. Replace the stale `apikey` header with the correct `x-cron-secret` header (or reconcile
   the hook contract). The publishable key is not a valid hook credential.

## Procedure to apply later (after deployment)

1. Confirm the app is deployed and `CRON_SECRET` is configured on the environment.
2. Verify the hook: `curl -X POST https://<app>/api/public/hooks/competitor-watch -H 'x-cron-secret: <CRON_SECRET>' -d '{}'` returns `{"ok":true,...}`.
3. Create a NEW migration (e.g. `supabase/migrations/<timestamp>_enable_competitor_watch_cron.sql`)
   containing the corrected SQL below, then apply it via the linked Supabase CLI.
4. Do not edit the original `20260709194553` file.

```sql
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'competitor-watch-scan') THEN
    PERFORM cron.unschedule('competitor-watch-scan');
  END IF;
END $$;

SELECT cron.schedule(
  'competitor-watch-scan',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url := 'REPLACE_WITH_REAL_APP_BASE_URL/api/public/hooks/competitor-watch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'REPLACE_WITH_REAL_CRON_SECRET'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

> ⚠️ **Never apply this until `REPLACE_WITH_*` placeholders are filled with real values.**
