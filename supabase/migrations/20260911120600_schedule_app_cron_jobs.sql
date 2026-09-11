-- Scheduler activation (proposal workstream A: "scheduled posts and competitor
-- monitoring wired and firing").
--
-- Idempotently (re)schedules every Mellox cron job through
-- public.call_app_hook(), which reads the app origin and CRON_SECRET from
-- Supabase Vault at call time — no URL or secret in committed SQL.
--
-- GUARDED: jobs are only scheduled once both Vault secrets exist. Pushing this
-- migration to a project whose secrets are not set yet schedules nothing (a
-- NOTICE says so) instead of creating jobs that fail every minute. After
-- setting the secrets, run supabase/ENABLE-CRON-JOBS.sql (same job list) or
-- re-run this file's DO block.

DO $$
DECLARE
  v_job record;
  v_ready boolean;
BEGIN
  IF to_regnamespace('cron') IS NULL OR to_regclass('vault.decrypted_secrets') IS NULL THEN
    RAISE NOTICE 'pg_cron or Vault unavailable — Mellox cron jobs not scheduled';
    RETURN;
  END IF;

  SELECT count(*) = 2 INTO v_ready
    FROM vault.decrypted_secrets
   WHERE name IN ('mellox_app_base_url', 'mellox_cron_secret')
     AND coalesce(decrypted_secret, '') <> '';

  IF NOT v_ready THEN
    RAISE NOTICE 'Vault secrets mellox_app_base_url / mellox_cron_secret not set — cron jobs not scheduled. See docs/OPERATIONS-RUNBOOK.md.';
    RETURN;
  END IF;

  FOR v_job IN
    SELECT * FROM (VALUES
      ('mellox-run-schedules',    '* * * * *',    '/api/public/hooks/run-schedules'),
      ('mellox-competitor-watch', '*/30 * * * *', '/api/public/hooks/competitor-watch'),
      ('mellox-sdr-reconcile',    '*/5 * * * *',  '/api/public/hooks/sdr-reconcile'),
      ('mellox-agents-tick',      '*/15 * * * *', '/api/public/hooks/agents-tick'),
      ('mellox-ops-watch',        '*/5 * * * *',  '/api/public/hooks/ops-watch')
    ) AS t(jobname, schedule, path)
  LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = v_job.jobname) THEN
      PERFORM cron.unschedule(v_job.jobname);
    END IF;
    PERFORM cron.schedule(
      v_job.jobname,
      v_job.schedule,
      format('SELECT public.call_app_hook(%L);', v_job.path)
    );
  END LOOP;
END
$$;
