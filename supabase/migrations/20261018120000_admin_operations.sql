-- Mellox admin panel, phase 3: system health, AI usage and emergency switches.
--
-- Same rules as the foundation migration: service-role only, a change and its
-- audit row in one transaction, idempotent. Reads are narrow functions over
-- tables that already exist (cron_heartbeats, studio_jobs, ai_usage_events);
-- nothing here copies or invents data.

/* ───────────────────────── emergency switches ───────────────────────── */

-- A row exists per switch; `engaged = true` means the area is stopped. The app
-- reads this table (src/server/platform/switches.server.ts) at the one place
-- each area spends money. A missing row or an unreadable table means "running".
CREATE TABLE IF NOT EXISTS public.platform_switches (
  key        text PRIMARY KEY
    CONSTRAINT platform_switches_key_check CHECK (key IN ('ai_text', 'ai_image', 'ai_video', 'ai_search')),
  engaged    boolean NOT NULL DEFAULT false,
  reason     text CONSTRAINT platform_switches_reason_len CHECK (reason IS NULL OR char_length(reason) <= 500),
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.platform_switches (key)
  VALUES ('ai_text'), ('ai_image'), ('ai_video'), ('ai_search')
  ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.platform_switches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_switches FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.platform_switches TO service_role;

CREATE OR REPLACE FUNCTION public.admin_switch_set(
  p_actor uuid,
  p_actor_role text,
  p_key text,
  p_engaged boolean,
  p_reason text,
  p_request_id text,
  p_ip text,
  p_user_agent text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_before boolean;
BEGIN
  IF char_length(btrim(coalesce(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'A reason of at least 10 characters is required.' USING ERRCODE = '22023';
  END IF;

  SELECT engaged INTO v_before FROM public.platform_switches WHERE key = p_key FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such switch.' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.platform_switches
     SET engaged = p_engaged, reason = btrim(p_reason), changed_by = p_actor, changed_at = now()
   WHERE key = p_key;

  PERFORM private.admin_audit_write(
    p_actor, p_actor_role,
    CASE WHEN p_engaged THEN 'switch.engaged' ELSE 'switch.released' END,
    'switch', p_key, NULL,
    jsonb_build_object('engaged', v_before), jsonb_build_object('engaged', p_engaged),
    p_reason, p_request_id, p_ip, p_user_agent);

  RETURN jsonb_build_object('key', p_key, 'engaged', p_engaged);
END;
$$;

/* ───────────────────────────── health ───────────────────────────── */

CREATE OR REPLACE FUNCTION public.admin_health()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'generated_at', now(),
    'cron', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'job', h.job,
        'expected_interval_seconds', h.expected_interval_seconds,
        'last_started_at', h.last_started_at,
        'last_succeeded_at', h.last_succeeded_at,
        'last_failed_at', h.last_failed_at,
        'failure_count', h.failure_count,
        'run_count', h.run_count,
        'last_duration_ms', h.last_duration_ms,
        'last_error', left(h.last_error, 300)
      ) ORDER BY h.job)
      FROM public.cron_heartbeats h), '[]'::jsonb),
    'studio', jsonb_build_object(
      'queued',    (SELECT count(*) FROM public.studio_jobs WHERE status = 'queued'),
      'running',   (SELECT count(*) FROM public.studio_jobs WHERE status = 'running'),
      'failed_24h', (SELECT count(*) FROM public.studio_jobs
                      WHERE status = 'failed' AND updated_at > now() - interval '24 hours'),
      'stuck',     (SELECT count(*) FROM public.studio_jobs
                      WHERE status = 'running' AND lease_until IS NOT NULL
                        AND lease_until < now() - interval '10 minutes')
    ),
    'recent_failures', coalesce((
      SELECT jsonb_agg(f ORDER BY f.updated_at DESC) FROM (
        SELECT j.id, j.type, j.stage, j.workspace_id, j.updated_at,
               left(coalesce(j.error ->> 'message', j.error ->> 'category', ''), 200) AS message
        FROM public.studio_jobs j
        WHERE j.status = 'failed'
        ORDER BY j.updated_at DESC
        LIMIT 10) f), '[]'::jsonb)
  );
$$;

/* ───────────────────────────── usage ───────────────────────────── */

CREATE OR REPLACE FUNCTION public.admin_usage(p_days int)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH win AS (
    SELECT now() - make_interval(days => least(greatest(coalesce(p_days, 7), 1), 90)) AS since
  ),
  ev AS (
    SELECT e.* FROM public.ai_usage_events e, win WHERE e.created_at >= win.since
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'since', (SELECT since FROM win),
    'totals', (SELECT jsonb_build_object(
        'calls', count(*),
        'cost_usd', coalesce(sum(est_cost_usd), 0),
        'saved_usd', coalesce(sum(saved_usd), 0),
        'errors', count(*) FILTER (WHERE status = 'error'),
        'cached', count(*) FILTER (WHERE cached),
        'input_tokens', coalesce(sum(input_tokens), 0),
        'output_tokens', coalesce(sum(output_tokens), 0)) FROM ev),
    'by_day', coalesce((
      SELECT jsonb_agg(d ORDER BY d.day) FROM (
        SELECT (created_at AT TIME ZONE 'UTC')::date AS day,
               count(*) AS calls, coalesce(sum(est_cost_usd), 0) AS cost_usd,
               count(*) FILTER (WHERE status = 'error') AS errors
        FROM ev GROUP BY 1) d), '[]'::jsonb),
    'by_kind', coalesce((
      SELECT jsonb_agg(k ORDER BY k.cost_usd DESC) FROM (
        SELECT kind, count(*) AS calls, coalesce(sum(est_cost_usd), 0) AS cost_usd
        FROM ev GROUP BY kind) k), '[]'::jsonb),
    'by_model', coalesce((
      SELECT jsonb_agg(m ORDER BY m.cost_usd DESC) FROM (
        SELECT provider, model, count(*) AS calls,
               coalesce(sum(est_cost_usd), 0) AS cost_usd,
               count(*) FILTER (WHERE status = 'error') AS errors,
               coalesce(round(avg(latency_ms) FILTER (WHERE latency_ms IS NOT NULL)), NULL) AS avg_latency_ms
        FROM ev GROUP BY provider, model
        ORDER BY sum(est_cost_usd) DESC NULLS LAST LIMIT 20) m), '[]'::jsonb),
    'by_route', coalesce((
      SELECT jsonb_agg(r ORDER BY r.cost_usd DESC) FROM (
        SELECT route, count(*) AS calls, coalesce(sum(est_cost_usd), 0) AS cost_usd,
               count(*) FILTER (WHERE status = 'error') AS errors
        FROM ev GROUP BY route
        ORDER BY sum(est_cost_usd) DESC NULLS LAST LIMIT 20) r), '[]'::jsonb),
    'top_workspaces', coalesce((
      SELECT jsonb_agg(w ORDER BY w.cost_usd DESC) FROM (
        SELECT ev.workspace_id, ws.name, count(*) AS calls,
               coalesce(sum(ev.est_cost_usd), 0) AS cost_usd
        FROM ev LEFT JOIN public.workspaces ws ON ws.id = ev.workspace_id
        WHERE ev.workspace_id IS NOT NULL
        GROUP BY ev.workspace_id, ws.name
        ORDER BY sum(ev.est_cost_usd) DESC NULLS LAST LIMIT 10) w), '[]'::jsonb)
  );
$$;

/* ─────────────────────── who may call the functions ─────────────────────── */

REVOKE ALL ON FUNCTION
  public.admin_switch_set(uuid, text, text, boolean, text, text, text, text),
  public.admin_health(),
  public.admin_usage(int)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.admin_switch_set(uuid, text, text, boolean, text, text, text, text),
  public.admin_health(),
  public.admin_usage(int)
  TO service_role;
