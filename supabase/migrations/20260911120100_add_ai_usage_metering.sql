-- AI usage metering (proposal workstream B).
--
-- Every paid provider call — OpenRouter, Anthropic, KIE image/video,
-- DataForSEO — records one ai_usage_events row: who (workspace, user), where
-- (route), what (provider, model, kind), how much (tokens / units, estimated
-- USD) and how it went (cached, truncated, status, latency). ai_usage_daily is
-- the rollup budgets and dashboards read; public.record_ai_usage() writes both
-- atomically so the rollup can never drift from the events.
--
-- Scope keys in the rollup: 'ws:<uuid>' for workspace-attributed spend and
-- 'user:<uuid>' for every call a user makes (per-user ceilings apply even when
-- no workspace is attributed).

CREATE TABLE IF NOT EXISTS public.ai_usage_events (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  route text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  kind text NOT NULL DEFAULT 'text'
    CHECK (kind IN ('text', 'image', 'video', 'search', 'moderation')),
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  units integer NOT NULL DEFAULT 0,
  cached boolean NOT NULL DEFAULT false,
  truncated boolean NOT NULL DEFAULT false,
  est_cost_usd numeric(12, 6) NOT NULL DEFAULT 0,
  saved_usd numeric(12, 6) NOT NULL DEFAULT 0,
  latency_ms integer,
  status text NOT NULL DEFAULT 'ok'
    CHECK (status IN ('ok', 'error', 'blocked', 'degraded')),
  run_id uuid,
  request_id text
);

CREATE INDEX IF NOT EXISTS ai_usage_events_workspace_idx
  ON public.ai_usage_events (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_events_user_idx
  ON public.ai_usage_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_events_created_idx
  ON public.ai_usage_events (created_at DESC);

CREATE TABLE IF NOT EXISTS public.ai_usage_daily (
  day date NOT NULL,
  scope_key text NOT NULL,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  calls integer NOT NULL DEFAULT 0,
  cached_calls integer NOT NULL DEFAULT 0,
  truncated_calls integer NOT NULL DEFAULT 0,
  error_calls integer NOT NULL DEFAULT 0,
  input_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  images integer NOT NULL DEFAULT 0,
  videos integer NOT NULL DEFAULT 0,
  cost_usd numeric(14, 6) NOT NULL DEFAULT 0,
  saved_usd numeric(14, 6) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, scope_key)
);

CREATE INDEX IF NOT EXISTS ai_usage_daily_workspace_idx
  ON public.ai_usage_daily (workspace_id, day DESC);

ALTER TABLE public.ai_usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_usage_daily ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.ai_usage_events FROM anon, authenticated;
REVOKE ALL ON public.ai_usage_daily FROM anon, authenticated;
GRANT SELECT ON public.ai_usage_events, public.ai_usage_daily TO authenticated;
GRANT ALL ON public.ai_usage_events, public.ai_usage_daily TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.ai_usage_events_id_seq TO service_role;

DROP POLICY IF EXISTS "Members read workspace AI usage" ON public.ai_usage_events;
CREATE POLICY "Members read workspace AI usage" ON public.ai_usage_events
  FOR SELECT TO authenticated
  USING (
    (workspace_id IS NOT NULL AND private.is_workspace_member(workspace_id, auth.uid()))
    OR (workspace_id IS NULL AND user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Members read workspace AI usage rollup" ON public.ai_usage_daily;
CREATE POLICY "Members read workspace AI usage rollup" ON public.ai_usage_daily
  FOR SELECT TO authenticated
  USING (
    (workspace_id IS NOT NULL AND private.is_workspace_member(workspace_id, auth.uid()))
    OR (workspace_id IS NULL AND user_id = auth.uid())
  );

-- Insert one event and fold it into the daily rollup(s), atomically.
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
  INSERT INTO public.ai_usage_events (
    workspace_id, user_id, route, provider, model, kind, input_tokens,
    output_tokens, units, cached, truncated, est_cost_usd, saved_usd,
    latency_ms, status, run_id, request_id
  ) VALUES (
    v_ws, v_user,
    coalesce(p_event ->> 'route', 'unknown'),
    coalesce(p_event ->> 'provider', 'unknown'),
    coalesce(p_event ->> 'model', 'unknown'),
    v_kind, v_in, v_out, v_units, v_cached, v_truncated, v_cost, v_saved,
    nullif(p_event ->> 'latency_ms', '')::integer,
    v_status,
    nullif(p_event ->> 'run_id', '')::uuid,
    p_event ->> 'request_id'
  )
  RETURNING id INTO v_id;

  FOREACH v_scope IN ARRAY ARRAY[
    CASE WHEN v_ws IS NOT NULL THEN 'ws:' || v_ws::text END,
    CASE WHEN v_user IS NOT NULL THEN 'user:' || v_user::text END
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

REVOKE ALL ON FUNCTION public.record_ai_usage(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_ai_usage(jsonb) TO service_role;

-- Today + this-month totals for one scope ("ws:<uuid>" or "user:<uuid>"), in
-- one round trip. Service role only; the budget module calls it before metered
-- requests (and caches the answer briefly).
CREATE OR REPLACE FUNCTION public.ai_usage_summary(p_scope_key text)
RETURNS TABLE (
  today_cost_usd numeric,
  month_cost_usd numeric,
  month_images bigint,
  month_videos bigint,
  month_calls bigint,
  month_cached_calls bigint,
  month_saved_usd numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(sum(cost_usd) FILTER (WHERE day = (now() AT TIME ZONE 'utc')::date), 0),
         coalesce(sum(cost_usd), 0),
         coalesce(sum(images), 0),
         coalesce(sum(videos), 0),
         coalesce(sum(calls), 0),
         coalesce(sum(cached_calls), 0),
         coalesce(sum(saved_usd), 0)
    FROM public.ai_usage_daily
   WHERE scope_key = p_scope_key
     AND day >= date_trunc('month', now() AT TIME ZONE 'utc')::date;
$$;

REVOKE ALL ON FUNCTION public.ai_usage_summary(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_usage_summary(text) TO service_role;
