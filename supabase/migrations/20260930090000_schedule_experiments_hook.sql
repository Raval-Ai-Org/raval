-- Proof Engine worker schedule (ADR-0024 §5).
--
-- pg_cron calls /api/public/hooks/experiments every five minutes: it syncs
-- Mellox experiment pull requests, then advances due experiment_jobs rows
-- (live checks, daily metric pulls, analysis, contamination checks). Live
-- checks retry every 15 minutes, so five is frequent enough. Idempotent.

DO $$
DECLARE
  v_ready boolean;
BEGIN
  IF to_regnamespace('cron') IS NULL OR to_regclass('vault.decrypted_secrets') IS NULL THEN
    RAISE NOTICE 'pg_cron or Vault unavailable — mellox-experiments not scheduled';
    RETURN;
  END IF;

  SELECT count(*) = 2 INTO v_ready
    FROM vault.decrypted_secrets
   WHERE name IN ('mellox_app_base_url', 'mellox_cron_secret')
     AND coalesce(decrypted_secret, '') <> '';

  IF NOT v_ready THEN
    RAISE NOTICE 'Vault secrets missing — mellox-experiments not scheduled';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mellox-experiments') THEN
    PERFORM cron.unschedule('mellox-experiments');
  END IF;
  PERFORM cron.schedule(
    'mellox-experiments',
    '*/5 * * * *',
    format('SELECT public.call_app_hook(%L);', '/api/public/hooks/experiments')
  );
END;
$$;
