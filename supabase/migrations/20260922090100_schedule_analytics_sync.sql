-- Schedule the analytics sync hook (Google Analytics 4 + Search Console).
--
-- Every 10 minutes: enqueue a daily incremental run for each active source
-- that has not synced yesterday's data, then advance queued/leased runs
-- (initial 180-day backfills resume here after a deploy or time budget yield).
--
-- Guarded on pg_cron + the Vault secrets used by public.call_app_hook; when
-- they are missing this is a no-op with a NOTICE (see supabase/ENABLE-CRON-JOBS.sql).

DO $$
DECLARE
  v_ready boolean;
BEGIN
  IF to_regnamespace('cron') IS NULL OR to_regclass('vault.decrypted_secrets') IS NULL THEN
    RAISE NOTICE 'pg_cron or Vault unavailable — mellox-analytics-sync not scheduled';
    RETURN;
  END IF;

  SELECT count(*) = 2 INTO v_ready
    FROM vault.decrypted_secrets
   WHERE name IN ('mellox_app_base_url', 'mellox_cron_secret')
     AND coalesce(decrypted_secret, '') <> '';

  IF NOT v_ready THEN
    RAISE NOTICE 'Vault secrets missing — mellox-analytics-sync not scheduled';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mellox-analytics-sync') THEN
    PERFORM cron.unschedule('mellox-analytics-sync');
  END IF;
  PERFORM cron.schedule(
    'mellox-analytics-sync',
    '*/10 * * * *',
    format('SELECT public.call_app_hook(%L);', '/api/public/hooks/analytics-sync')
  );
END;
$$;
