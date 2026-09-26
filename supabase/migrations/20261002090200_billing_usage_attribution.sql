-- Account attribution and charge correlation for provider cost monitoring.
-- Keep the legacy workspace and user rollups for off/shadow mode; add an
-- account rollup for enforcement-on safety ceilings.
ALTER TABLE public.ai_usage_events ADD COLUMN IF NOT EXISTS billing_account_id uuid REFERENCES public.billing_accounts(id);
ALTER TABLE public.ai_usage_events ADD COLUMN IF NOT EXISTS charge_id uuid;
CREATE INDEX IF NOT EXISTS ai_usage_events_account_created_idx ON public.ai_usage_events(billing_account_id, created_at DESC);

-- Members may inspect their brand's provider usage, but the owner wallet id
-- and internal charge correlation are server-only data.
REVOKE SELECT ON public.ai_usage_events FROM authenticated;
GRANT SELECT (id,created_at,workspace_id,user_id,route,provider,model,kind,
  input_tokens,output_tokens,units,cached,truncated,est_cost_usd,saved_usd,
  latency_ms,status,run_id,request_id) ON public.ai_usage_events TO authenticated;

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
  v_units integer := coalesce((p_event ->> 'units')::integer, 0);
  v_cost numeric := coalesce((p_event ->> 'est_cost_usd')::numeric, 0);
  v_saved numeric := coalesce((p_event ->> 'saved_usd')::numeric, 0);
  v_day date := (now() AT TIME ZONE 'utc')::date;
  v_scope text;
BEGIN
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
    latency_ms, status, run_id, request_id, billing_account_id, charge_id
  ) VALUES (
    v_ws, v_user,
    coalesce(p_event ->> 'route', 'unknown'),
    coalesce(p_event ->> 'provider', 'unknown'),
    coalesce(p_event ->> 'model', 'unknown'),
    v_kind, v_in, v_out, v_units, v_cached, v_truncated, v_cost, v_saved,
    nullif(p_event ->> 'latency_ms', '')::integer,
    v_status,
    nullif(p_event ->> 'run_id', '')::uuid,
    p_event ->> 'request_id', v_acct, v_charge
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
      truncated_calls, error_calls, input_tokens, output_tokens, images,
      videos, cost_usd, saved_usd, updated_at
    ) VALUES (
      v_day, v_scope,
      CASE WHEN v_scope LIKE 'ws:%' THEN v_ws END,
      CASE WHEN v_scope LIKE 'user:%' THEN v_user END,
      1,
      CASE WHEN v_cached THEN 1 ELSE 0 END,
      CASE WHEN v_truncated THEN 1 ELSE 0 END,
      CASE WHEN v_status = 'error' THEN 1 ELSE 0 END,
      v_in, v_out,
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
      images = d.images + excluded.images,
      videos = d.videos + excluded.videos,
      cost_usd = d.cost_usd + excluded.cost_usd,
      saved_usd = d.saved_usd + excluded.saved_usd,
      updated_at = now();
  END LOOP;

  RETURN v_id;
END;
$$;
