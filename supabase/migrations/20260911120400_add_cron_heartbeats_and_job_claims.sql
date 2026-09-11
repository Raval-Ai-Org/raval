-- Scheduler operability (proposal workstreams A + G).
--
-- 1. cron_heartbeats — every cron hook records start/success/failure. The
--    readiness probe (/api/health/ready) and the ops-watch job alert when a
--    job has not succeeded within 3× its expected interval ("a run was missed").
-- 2. claim_due_scheduled_jobs() — atomic lease claim with FOR UPDATE SKIP
--    LOCKED on the locked_at/locked_by columns added by 20260910050000 but never
--    used: a one-minute cron cadence with a 120 s hook timeout could otherwise
--    run the same scheduled job twice.
-- 3. prune_operational_logs() — retention for the operational log tables.

CREATE TABLE IF NOT EXISTS public.cron_heartbeats (
  job text PRIMARY KEY,
  expected_interval_seconds integer NOT NULL DEFAULT 60,
  last_started_at timestamptz,
  last_succeeded_at timestamptz,
  last_failed_at timestamptz,
  last_error text,
  last_duration_ms integer,
  last_result jsonb,
  run_count bigint NOT NULL DEFAULT 0,
  failure_count bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cron_heartbeats ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cron_heartbeats FROM anon, authenticated;
GRANT ALL ON public.cron_heartbeats TO service_role;

CREATE OR REPLACE FUNCTION public.claim_due_scheduled_jobs(
  p_max integer DEFAULT 25,
  p_lease_seconds integer DEFAULT 300,
  p_market_brain boolean DEFAULT false,
  p_job_id uuid DEFAULT NULL
)
RETURNS SETOF public.scheduled_jobs
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.scheduled_jobs AS s
     SET locked_at = now(),
         locked_by = gen_random_uuid()
   WHERE s.id IN (
     SELECT j.id
       FROM public.scheduled_jobs j
      WHERE j.active
        AND (CASE WHEN p_market_brain THEN j.task_type = 'market-brain'
                  ELSE j.task_type <> 'market-brain' END)
        AND (p_job_id IS NOT NULL OR j.next_run_at <= now())
        AND (p_job_id IS NULL OR j.id = p_job_id)
        AND (j.locked_at IS NULL OR j.locked_at < now() - make_interval(secs => p_lease_seconds))
      ORDER BY j.next_run_at
      LIMIT greatest(p_max, 0)
      FOR UPDATE SKIP LOCKED
   )
  RETURNING s.*;
$$;

REVOKE ALL ON FUNCTION public.claim_due_scheduled_jobs(integer, integer, boolean, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_scheduled_jobs(integer, integer, boolean, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.prune_operational_logs()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_webhooks integer;
  v_guardrails integer;
  v_usage integer;
BEGIN
  DELETE FROM public.sdr_webhook_events WHERE received_at < now() - interval '30 days';
  GET DIAGNOSTICS v_webhooks = ROW_COUNT;
  DELETE FROM public.guardrail_events WHERE created_at < now() - interval '90 days';
  GET DIAGNOSTICS v_guardrails = ROW_COUNT;
  -- Raw events for 13 months; the daily rollup is kept indefinitely.
  DELETE FROM public.ai_usage_events WHERE created_at < now() - interval '13 months';
  GET DIAGNOSTICS v_usage = ROW_COUNT;
  RETURN jsonb_build_object(
    'sdr_webhook_events', v_webhooks,
    'guardrail_events', v_guardrails,
    'ai_usage_events', v_usage
  );
END;
$$;

REVOKE ALL ON FUNCTION public.prune_operational_logs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_operational_logs() TO service_role;
