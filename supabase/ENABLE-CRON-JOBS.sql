-- =============================================================================
-- ENABLE THE APP'S SCHEDULED JOBS
-- =============================================================================
--
-- ⚠️  Run this MANUALLY in the Supabase SQL Editor, once per environment.
--     It is deliberately NOT in supabase/migrations/ because it needs a real
--     deployment URL and the live CRON_SECRET, neither of which belongs in a
--     committed file.
--
-- WHY THIS EXISTS
-- ---------------
-- Nothing currently schedules the app's cron hooks. The original
-- `competitor-watch-scan` job (migration 20260709194553) pointed at a stale
-- preview URL and authenticated with an `apikey` header, while the hooks
-- require `x-cron-secret`; it was unscheduled in 20260903000000 and never
-- replaced. Until this script is run:
--
--   * scheduled content never publishes   (/api/public/hooks/run-schedules)
--   * Market Brain collections never run  (same hook)
--   * competitor alerts are never created (/api/public/hooks/competitor-watch)
--   * publications can sit stuck in `publishing` (/api/public/hooks/sdr-reconcile)
--
-- PREREQUISITES
-- -------------
--   1. The app is deployed at a public HTTPS origin.
--   2. `CRON_SECRET` is set in the app's environment, 16+ characters
--      (32+ recommended). The hooks return 503 below 16.
--   3. Migration 20260911000100_add_app_hook_caller.sql has been applied.
--
-- =============================================================================


-- -----------------------------------------------------------------------------
-- STEP 1 — Store the origin and secret in Vault.
--
-- Replace BOTH values below. Do not commit this file with real values filled in.
-- Re-running with the same name errors; use STEP 1b to rotate instead.
-- -----------------------------------------------------------------------------

SELECT vault.create_secret(
  'https://REPLACE_WITH_YOUR_APP_ORIGIN',   -- e.g. https://app.mellox.ai (no trailing path)
  'mellox_app_base_url',
  'Public origin of the Mellox AI app, used by public.call_app_hook'
);

SELECT vault.create_secret(
  'REPLACE_WITH_YOUR_CRON_SECRET',          -- must equal the app's CRON_SECRET env var
  'mellox_cron_secret',
  'Shared secret for the x-cron-secret header on /api/public/hooks/*'
);


-- -----------------------------------------------------------------------------
-- STEP 1b — Rotating either value later (run instead of STEP 1).
-- -----------------------------------------------------------------------------
--
-- SELECT vault.update_secret(
--   (SELECT id FROM vault.secrets WHERE name = 'mellox_cron_secret'),
--   'NEW_SECRET_VALUE'
-- );


-- -----------------------------------------------------------------------------
-- STEP 2 — Verify before scheduling anything.
--
-- Expect a bigint request id, not an error. Then confirm delivery in
-- net._http_response (status_code should be 200, not 401/503).
-- -----------------------------------------------------------------------------

-- SELECT public.call_app_hook('/api/public/hooks/run-schedules');
--
-- SELECT id, status_code, content, created
-- FROM net._http_response
-- ORDER BY created DESC
-- LIMIT 5;
--
--   200 → good.
--   401 → mellox_cron_secret does not match the app's CRON_SECRET.
--   503 → CRON_SECRET unset or under 16 chars on the app side.
--   000 / timeout → mellox_app_base_url is unreachable from Supabase.


-- -----------------------------------------------------------------------------
-- STEP 3 — Schedule the jobs. Idempotent: unschedules an existing job first.
-- -----------------------------------------------------------------------------

DO $$
DECLARE
  v_job record;
BEGIN
  FOR v_job IN
    SELECT * FROM (VALUES
      -- Drives due scheduled_jobs AND due Market Brain collections. The handler
      -- caps each sweep at 25 + 25, so a one-minute cadence is intentional.
      ('mellox-run-schedules',   '* * * * *',    '/api/public/hooks/run-schedules'),
      -- Scans competitor_watches whose last_checked_at is stale (max 40/run).
      ('mellox-competitor-watch','*/30 * * * *', '/api/public/hooks/competitor-watch'),
      -- Resolves publications stuck in publishing/pending against SDR job
      -- status. Harmless while FEATURE_FLAG_SDR_ENABLED is off — no rows match.
      ('mellox-sdr-reconcile',   '*/5 * * * *',  '/api/public/hooks/sdr-reconcile')
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
END $$;


-- -----------------------------------------------------------------------------
-- STEP 4 — Confirm, and check back after a few minutes.
-- -----------------------------------------------------------------------------

SELECT jobid, jobname, schedule, active, command
FROM cron.job
WHERE jobname LIKE 'mellox-%'
ORDER BY jobname;

-- Recent run outcomes:
--
-- SELECT j.jobname, d.status, d.return_message, d.start_time
-- FROM cron.job_run_details d
-- JOIN cron.job j USING (jobid)
-- WHERE j.jobname LIKE 'mellox-%'
-- ORDER BY d.start_time DESC
-- LIMIT 20;


-- -----------------------------------------------------------------------------
-- ROLLBACK — stop every job without dropping the Vault secrets.
-- -----------------------------------------------------------------------------
--
-- SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname LIKE 'mellox-%';
