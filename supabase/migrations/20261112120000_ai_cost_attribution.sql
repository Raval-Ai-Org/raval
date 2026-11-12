-- AI cost attribution: every provider call can be added up per piece made.
--
-- 1. ai_usage_events keeps the workflow a call belonged to (a Studio job, a
--    UGC render…) and the prompt-cache / reasoning token counts OpenRouter
--    returns, so the prompt cache's effect is a measured figure.
-- 2. record_ai_usage() stores them (same function, three more fields).
-- 3. admin_cost_per_output(days) answers "what does one accepted piece cost?"
--    from stored rows only: spend per workflow, on failed workflows, per
--    finished and per accepted piece, by stage, and prompt-cache read share.
--
-- Idempotent: safe to replay (npm run db:verify).

ALTER TABLE public.ai_usage_events ADD COLUMN IF NOT EXISTS workflow_kind text;
ALTER TABLE public.ai_usage_events ADD COLUMN IF NOT EXISTS workflow_id uuid;
ALTER TABLE public.ai_usage_events ADD COLUMN IF NOT EXISTS workflow_stage text;
ALTER TABLE public.ai_usage_events ADD COLUMN IF NOT EXISTS cached_input_tokens integer NOT NULL DEFAULT 0;
ALTER TABLE public.ai_usage_events ADD COLUMN IF NOT EXISTS cache_write_tokens integer NOT NULL DEFAULT 0;
ALTER TABLE public.ai_usage_events ADD COLUMN IF NOT EXISTS reasoning_tokens integer NOT NULL DEFAULT 0;

ALTER TABLE public.ai_usage_daily ADD COLUMN IF NOT EXISTS cached_input_tokens bigint NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS ai_usage_events_workflow_idx
  ON public.ai_usage_events (workflow_kind, workflow_id)
  WHERE workflow_id IS NOT NULL;

-- Members may read the new token counts for their brand (not the workflow
-- correlation, which is for staff reporting).
GRANT SELECT (cached_input_tokens, cache_write_tokens, reasoning_tokens)
  ON public.ai_usage_events TO authenticated;

CREATE OR REPLACE FUNCTION public.record_ai_usage(p_event jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id bigint;
  v_ws uuid := nullif(p_event ->> 'workspace_id', '')::uuid;
  v_user uuid := nullif(p_event ->> 'user_id', '')::uuid;
  v_acct uuid := nullif(p_event ->> 'billing_account_id', '')::uuid;
  v_charge uuid := nullif(p_event ->> 'charge_id', '')::uuid;
  v_kind text := coalesce(p_event ->> 'kind', 'text');
  v_cached boolean := coalesce((p_event ->> 'cached')::boolean, false);
  v_truncated boolean := coalesce((p_event ->> 'truncated')::boolean, false);
  v_status text := coalesce(p_event ->> 'status', 'ok');
  v_in integer := coalesce((p_event ->> 'input_tokens')::integer, 0);
  v_out integer := coalesce((p_event ->> 'output_tokens')::integer, 0);
  v_cached_in integer := coalesce((p_event ->> 'cached_input_tokens')::integer, 0);
  v_cache_write integer := coalesce((p_event ->> 'cache_write_tokens')::integer, 0);
  v_reasoning integer := coalesce((p_event ->> 'reasoning_tokens')::integer, 0);
  v_units integer := coalesce((p_event ->> 'units')::integer, 0);
  v_cost numeric := coalesce((p_event ->> 'est_cost_usd')::numeric, 0);
  v_saved numeric := coalesce((p_event ->> 'saved_usd')::numeric, 0);
  v_wf_kind text := nullif(p_event ->> 'workflow_kind', '');
  v_wf_id uuid;
  v_day date := (now() AT TIME ZONE 'utc')::date;
  v_scope text;
BEGIN
  -- A malformed workflow id is dropped, never a reason to lose the usage row.
  BEGIN
    v_wf_id := nullif(p_event ->> 'workflow_id', '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_wf_id := NULL;
  END;
  -- The workspace link is authoritative even if a caller supplied an account.
  IF v_ws IS NOT NULL THEN
    SELECT billing_account_id INTO v_acct FROM public.workspaces WHERE id=v_ws;
  END IF;
  IF v_acct IS NULL AND v_user IS NOT NULL THEN
    SELECT id INTO v_acct FROM public.billing_accounts WHERE owner_user_id=v_user;
  END IF;
  INSERT INTO public.ai_usage_events (
    workspace_id, user_id, route, provider, model, kind, input_tokens,
    output_tokens, units, cached, truncated, est_cost_usd, saved_usd,
    latency_ms, status, run_id, request_id, billing_account_id, charge_id,
    workflow_kind, workflow_id, workflow_stage,
    cached_input_tokens, cache_write_tokens, reasoning_tokens
  ) VALUES (
    v_ws, v_user,
    coalesce(p_event ->> 'route', 'unknown'),
    coalesce(p_event ->> 'provider', 'unknown'),
    coalesce(p_event ->> 'model', 'unknown'),
    v_kind, v_in, v_out, v_units, v_cached, v_truncated, v_cost, v_saved,
    nullif(p_event ->> 'latency_ms', '')::integer,
    v_status,
    nullif(p_event ->> 'run_id', '')::uuid,
    p_event ->> 'request_id', v_acct, v_charge,
    CASE WHEN v_wf_id IS NULL THEN NULL ELSE left(v_wf_kind, 40) END,
    v_wf_id,
    CASE WHEN v_wf_id IS NULL THEN NULL ELSE left(nullif(p_event ->> 'workflow_stage', ''), 40) END,
    greatest(v_cached_in, 0), greatest(v_cache_write, 0), greatest(v_reasoning, 0)
  )
  RETURNING id INTO v_id;

  FOREACH v_scope IN ARRAY ARRAY[
    CASE WHEN v_ws IS NOT NULL THEN 'ws:' || v_ws::text END,
    CASE WHEN v_user IS NOT NULL THEN 'user:' || v_user::text END,
    CASE WHEN v_acct IS NOT NULL THEN 'acct:' || v_acct::text END
  ] LOOP
    CONTINUE WHEN v_scope IS NULL;
    INSERT INTO public.ai_usage_daily AS d (
      day, scope_key, workspace_id, user_id, calls, cached_calls,
      truncated_calls, error_calls, input_tokens, output_tokens,
      cached_input_tokens, images, videos, cost_usd, saved_usd, updated_at
    ) VALUES (
      v_day, v_scope,
      CASE WHEN v_scope LIKE 'ws:%' THEN v_ws END,
      CASE WHEN v_scope LIKE 'user:%' THEN v_user END,
      1,
      CASE WHEN v_cached THEN 1 ELSE 0 END,
      CASE WHEN v_truncated THEN 1 ELSE 0 END,
      CASE WHEN v_status = 'error' THEN 1 ELSE 0 END,
      v_in, v_out, greatest(v_cached_in, 0),
      CASE WHEN v_kind = 'image' THEN greatest(v_units, 1) ELSE 0 END,
      CASE WHEN v_kind = 'video' THEN greatest(v_units, 1) ELSE 0 END,
      v_cost, v_saved, now()
    )
    ON CONFLICT (day, scope_key) DO UPDATE SET
      calls = d.calls + 1,
      cached_calls = d.cached_calls + excluded.cached_calls,
      truncated_calls = d.truncated_calls + excluded.truncated_calls,
      error_calls = d.error_calls + excluded.error_calls,
      input_tokens = d.input_tokens + excluded.input_tokens,
      output_tokens = d.output_tokens + excluded.output_tokens,
      cached_input_tokens = d.cached_input_tokens + excluded.cached_input_tokens,
      images = d.images + excluded.images,
      videos = d.videos + excluded.videos,
      cost_usd = d.cost_usd + excluded.cost_usd,
      saved_usd = d.saved_usd + excluded.saved_usd,
      updated_at = now();
  END LOOP;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_ai_usage(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_ai_usage(jsonb) TO service_role;

-- What one piece costs, from stored rows only. Costs are the providers'
-- reported cost per call (an estimate, not an invoice). "Accepted" is a piece
-- whose post a person approved, scheduled or published; spend on failed and
-- abandoned work is included in the cost per accepted piece, because that is
-- what an accepted piece really costs.
CREATE OR REPLACE FUNCTION public.admin_cost_per_output(p_days int)
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
  ),
  wf AS (
    SELECT workflow_kind, workflow_id,
           sum(est_cost_usd) AS cost_usd,
           sum(est_cost_usd) FILTER (WHERE status = 'error') AS error_cost_usd,
           count(*) AS calls,
           count(*) FILTER (WHERE status = 'error') AS error_calls
    FROM ev WHERE workflow_id IS NOT NULL
    GROUP BY workflow_kind, workflow_id
  ),
  studio AS (
    SELECT j.type AS variant,
           (j.parent_job_id IS NOT NULL) AS revision,
           j.status,
           EXISTS (
             SELECT 1 FROM public.content_items ci
             WHERE ci.id = ANY (j.content_item_ids)
               AND ci.status IN ('approved', 'scheduled', 'publishing', 'published')
           ) AS accepted,
           wf.cost_usd, wf.error_cost_usd, wf.calls, wf.error_calls
    FROM wf JOIN public.studio_jobs j ON j.id = wf.workflow_id
    WHERE wf.workflow_kind = 'studio_job'
  ),
  ugc AS (
    SELECT r.model_key AS variant, false AS revision, r.status, (r.status = 'succeeded') AS accepted,
           wf.cost_usd, wf.error_cost_usd, wf.calls, wf.error_calls
    FROM wf JOIN public.ugc_renders r ON r.id = wf.workflow_id
    WHERE wf.workflow_kind = 'ugc_render'
  ),
  pieces AS (
    SELECT 'studio_job'::text AS kind, * FROM studio
    UNION ALL
    SELECT 'ugc_render'::text AS kind, * FROM ugc
  ),
  by_variant AS (
    SELECT kind, variant,
           count(*) AS workflows,
           count(*) FILTER (WHERE status = 'succeeded') AS succeeded,
           count(*) FILTER (WHERE status IN ('failed', 'cancelled')) AS failed,
           count(*) FILTER (WHERE accepted) AS accepted,
           count(*) FILTER (WHERE revision) AS revisions,
           round(sum(cost_usd), 4) AS cost_usd,
           round(coalesce(sum(cost_usd) FILTER (WHERE status IN ('failed', 'cancelled')), 0), 4) AS failed_cost_usd,
           round(coalesce(sum(error_cost_usd), 0), 4) AS error_call_cost_usd,
           round(sum(cost_usd) / nullif(count(*), 0), 4) AS cost_per_workflow_usd,
           round(sum(cost_usd) / nullif(count(*) FILTER (WHERE status = 'succeeded'), 0), 4) AS cost_per_succeeded_usd,
           round(sum(cost_usd) / nullif(count(*) FILTER (WHERE accepted), 0), 4) AS cost_per_accepted_usd
    FROM pieces GROUP BY kind, variant
  ),
  by_stage AS (
    SELECT e.workflow_kind AS workflow, coalesce(e.workflow_stage, 'unstaged') AS stage,
           e.kind AS usage_kind, count(*) AS calls, round(sum(e.est_cost_usd), 4) AS cost_usd
    FROM ev e WHERE e.workflow_id IS NOT NULL
    GROUP BY e.workflow_kind, coalesce(e.workflow_stage, 'unstaged'), e.kind
  ),
  prompt_cache AS (
    SELECT route,
           sum(input_tokens) AS input_tokens,
           sum(cached_input_tokens) AS cached_input_tokens,
           sum(cache_write_tokens) AS cache_write_tokens,
           sum(reasoning_tokens) AS reasoning_tokens,
           round(sum(cached_input_tokens)::numeric / nullif(sum(input_tokens), 0), 4) AS cached_share,
           round(sum(est_cost_usd), 4) AS cost_usd
    FROM ev WHERE kind = 'text' AND provider = 'openrouter' AND NOT cached
    GROUP BY route
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'since', (SELECT since FROM win),
    'totals', (
      SELECT jsonb_build_object(
        'cost_usd', round(coalesce(sum(est_cost_usd), 0), 4),
        'attributed_cost_usd', round(coalesce(sum(est_cost_usd) FILTER (WHERE workflow_id IS NOT NULL), 0), 4),
        'error_cost_usd', round(coalesce(sum(est_cost_usd) FILTER (WHERE status = 'error'), 0), 4),
        'saved_usd', round(coalesce(sum(saved_usd), 0), 4),
        'input_tokens', coalesce(sum(input_tokens), 0),
        'cached_input_tokens', coalesce(sum(cached_input_tokens), 0),
        'reasoning_tokens', coalesce(sum(reasoning_tokens), 0)
      ) FROM ev
    ),
    'by_variant', coalesce((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.cost_usd DESC) FROM by_variant v), '[]'::jsonb),
    'by_stage', coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.cost_usd DESC) FROM by_stage s), '[]'::jsonb),
    'prompt_cache', coalesce((
      SELECT jsonb_agg(to_jsonb(p) ORDER BY p.cost_usd DESC)
      FROM (SELECT * FROM prompt_cache ORDER BY cost_usd DESC LIMIT 40) p
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.admin_cost_per_output(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_cost_per_output(int) TO service_role;
