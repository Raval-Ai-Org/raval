-- Schedule the backlink run hook.
--
-- Every 2 minutes: claim queued backlink runs and advance leased ones. A run is
-- a short stage machine (six DataForSEO calls plus scoring), so the common case
-- is "nothing to claim" — the interval only has to be short enough that a run
-- started from the browser feels immediate when after() could not finish it.
--
-- Guarded on pg_cron + the Vault secrets used by public.call_app_hook; when
-- they are missing this is a no-op with a NOTICE (see supabase/ENABLE-CRON-JOBS.sql).

DO $$
DECLARE
  v_ready boolean;
BEGIN
  IF to_regnamespace('cron') IS NULL OR to_regclass('vault.decrypted_secrets') IS NULL THEN
    RAISE NOTICE 'pg_cron or Vault unavailable — mellox-backlink-runs not scheduled';
    RETURN;
  END IF;

  SELECT count(*) = 2 INTO v_ready
    FROM vault.decrypted_secrets
   WHERE name IN ('mellox_app_base_url', 'mellox_cron_secret')
     AND coalesce(decrypted_secret, '') <> '';

  IF NOT v_ready THEN
    RAISE NOTICE 'Vault secrets missing — mellox-backlink-runs not scheduled';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mellox-backlink-runs') THEN
    PERFORM cron.unschedule('mellox-backlink-runs');
  END IF;
  PERFORM cron.schedule(
    'mellox-backlink-runs',
    '*/2 * * * *',
    format('SELECT public.call_app_hook(%L);', '/api/public/hooks/backlink-runs')
  );
END;
$$;
