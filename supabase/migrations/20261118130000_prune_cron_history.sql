-- Keep the operational logs from filling the database.
--
-- pg_cron writes one cron.job_run_details row per run (13 jobs, ~6,200 rows a
-- day) and never deletes them: by 2026-11-18 that table was 103 MB, more than
-- all product data together. Nothing in Mellox reads it (health is
-- cron_heartbeats), so keep seven days for debugging.
--
-- Also: rate-limit windows (longest is one hour) older than a day, which the
-- in-function 1-in-1000 sweep leaves for weeks at low traffic, and agent step
-- detail older than 60 days. agent_runs rows stay (findings and action
-- requests point at them); only their step-by-step detail goes.
--
-- Same function the existing ops-watch hook calls every five minutes, so no
-- new cron job. Every existing clean-up below is unchanged.

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
  v_geo_pages integer;
  v_fix_files integer;
  v_batch_files integer;
  v_cron_runs integer := 0;
  v_rate_limits integer;
  v_agent_steps integer;
BEGIN
  DELETE FROM public.sdr_webhook_events WHERE received_at < now() - interval '30 days';
  GET DIAGNOSTICS v_webhooks = ROW_COUNT;
  DELETE FROM public.guardrail_events WHERE created_at < now() - interval '90 days';
  GET DIAGNOSTICS v_guardrails = ROW_COUNT;
  DELETE FROM public.ai_usage_events WHERE created_at < now() - interval '13 months';
  GET DIAGNOSTICS v_usage = ROW_COUNT;
  UPDATE public.geo_scan_pages
     SET analysis = NULL
   WHERE analysis IS NOT NULL AND created_at < now() - interval '180 days';
  GET DIAGNOSTICS v_geo_pages = ROW_COUNT;
  UPDATE public.geo_fix_proposals
     SET files = coalesce((
           SELECT jsonb_agg(jsonb_build_object('path', f->>'path', 'action', f->>'action'))
             FROM jsonb_array_elements(files) AS f
         ), '[]'::jsonb),
         files_purged_at = now()
   WHERE files_purged_at IS NULL
     AND status IN ('verified', 'not_verified', 'failed', 'discarded', 'stale', 'closed', 'access_lost')
     AND updated_at < now() - interval '30 days';
  GET DIAGNOSTICS v_fix_files = ROW_COUNT;
  UPDATE public.geo_fix_batches
     SET files = coalesce((
           SELECT jsonb_agg(jsonb_build_object('path', f->>'path', 'action', f->>'action'))
             FROM jsonb_array_elements(files) AS f
         ), '[]'::jsonb),
         files_purged_at = now()
   WHERE files_purged_at IS NULL
     AND status IN ('completed', 'closed', 'failed', 'discarded', 'stale', 'access_lost')
     AND updated_at < now() - interval '30 days';
  GET DIAGNOSTICS v_batch_files = ROW_COUNT;

  -- pg_cron's run history (absent where pg_cron isn't installed).
  IF to_regclass('cron.job_run_details') IS NOT NULL THEN
    EXECUTE 'DELETE FROM cron.job_run_details WHERE end_time < now() - interval ''7 days''';
    GET DIAGNOSTICS v_cron_runs = ROW_COUNT;
  END IF;

  DELETE FROM public.api_rate_limits WHERE window_start < now() - interval '1 day';
  GET DIAGNOSTICS v_rate_limits = ROW_COUNT;

  DELETE FROM public.agent_run_steps WHERE created_at < now() - interval '60 days';
  GET DIAGNOSTICS v_agent_steps = ROW_COUNT;

  RETURN jsonb_build_object(
    'sdr_webhook_events', v_webhooks,
    'guardrail_events', v_guardrails,
    'ai_usage_events', v_usage,
    'geo_scan_page_evidence', v_geo_pages,
    'geo_fix_proposal_files', v_fix_files,
    'geo_fix_batch_files', v_batch_files,
    'cron_run_details', v_cron_runs,
    'api_rate_limits', v_rate_limits,
    'agent_run_steps', v_agent_steps
  );
END;
$$;
REVOKE ALL ON FUNCTION public.prune_operational_logs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_operational_logs() TO service_role;
