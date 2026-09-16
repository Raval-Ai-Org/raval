-- AI usage reservations: hold plan allowance before an expensive asynchronous
-- provider task starts, then capture it (record the usage) when the task
-- delivers, or release it when the task fails.
--
-- Why: budgets (src/server/ai/budget.ts) read metered spend and count a render
-- only when it is recorded — after it finishes. Several renders started at the
-- same time all passed the check, and a failed render never needed a refund
-- because nothing was held. A reservation closes both gaps:
--
--   reserve_ai_usage()               serialised per scope (advisory lock): quota,
--                                    spend ceilings and concurrent holds are
--                                    checked against metered usage PLUS live
--                                    holds, and the hold is inserted atomically.
--   capture_ai_usage_reservation()   held → captured and record_ai_usage() in the
--                                    same transaction: usage is recorded once.
--   release_ai_usage_reservation()   held → released (failure, cancel).
--   release_expired_ai_usage_reservations()  sweeper for abandoned holds.
--
-- ai_usage_summary() now adds live holds, so every budget check in the product
-- (Studio, chat images, …) sees allowance that is already spoken for.
-- Members read their workspace's holds; only the service role writes.
-- Idempotent and non-destructive.

CREATE TABLE IF NOT EXISTS public.ai_usage_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_key text NOT NULL,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('image', 'video')),
  units integer NOT NULL DEFAULT 1 CHECK (units BETWEEN 1 AND 100),
  est_cost_usd numeric(12, 6) NOT NULL DEFAULT 0 CHECK (est_cost_usd >= 0),
  captured_cost_usd numeric(12, 6),
  provider text NOT NULL,
  model text NOT NULL,
  route text NOT NULL,
  source text NOT NULL,
  source_id text NOT NULL,
  state text NOT NULL DEFAULT 'held' CHECK (state IN ('held', 'captured', 'released')),
  release_reason text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  captured_at timestamptz,
  released_at timestamptz,
  CONSTRAINT ai_usage_reservations_source_unique UNIQUE (source, source_id),
  CONSTRAINT ai_usage_reservations_reason_length
    CHECK (release_reason IS NULL OR char_length(release_reason) <= 200)
);

CREATE INDEX IF NOT EXISTS ai_usage_reservations_live_idx
  ON public.ai_usage_reservations (scope_key, expires_at)
  WHERE state = 'held';
CREATE INDEX IF NOT EXISTS ai_usage_reservations_workspace_idx
  ON public.ai_usage_reservations (workspace_id, created_at DESC);

ALTER TABLE public.ai_usage_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_usage_reservations FROM anon, authenticated;
GRANT SELECT ON public.ai_usage_reservations TO authenticated;
GRANT ALL ON public.ai_usage_reservations TO service_role;

DROP POLICY IF EXISTS "Members read workspace AI reservations" ON public.ai_usage_reservations;
CREATE POLICY "Members read workspace AI reservations" ON public.ai_usage_reservations
  FOR SELECT TO authenticated
  USING (
    (workspace_id IS NOT NULL AND private.is_workspace_member(workspace_id, auth.uid()))
    OR (workspace_id IS NULL AND user_id = auth.uid())
  );

-- ── Reserve ───────────────────────────────────────────────────────────────
-- p_request: {scope_key, workspace_id?, user_id?, kind, units, est_cost_usd,
--             provider, model, route, source, source_id, ttl_seconds,
--             limits: {daily_usd, monthly_usd, monthly_units}, max_concurrent}
-- Returns {ok, id?, reason?, code?, usage:{…}}. Re-reserving the same
-- (source, source_id) returns the existing hold instead of a second one.
CREATE OR REPLACE FUNCTION public.reserve_ai_usage(p_request jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scope text := p_request ->> 'scope_key';
  v_kind text := p_request ->> 'kind';
  v_units integer := greatest(coalesce((p_request ->> 'units')::integer, 1), 1);
  v_cost numeric := greatest(coalesce((p_request ->> 'est_cost_usd')::numeric, 0), 0);
  v_source text := p_request ->> 'source';
  v_source_id text := p_request ->> 'source_id';
  v_ttl integer := least(greatest(coalesce((p_request ->> 'ttl_seconds')::integer, 7200), 300), 86400);
  v_daily numeric := (p_request -> 'limits' ->> 'daily_usd')::numeric;
  v_monthly numeric := (p_request -> 'limits' ->> 'monthly_usd')::numeric;
  v_quota numeric := (p_request -> 'limits' ->> 'monthly_units')::numeric;
  v_max_concurrent integer := coalesce((p_request ->> 'max_concurrent')::integer, 0);
  v_existing public.ai_usage_reservations%ROWTYPE;
  v_today_cost numeric;
  v_month_cost numeric;
  v_month_units numeric;
  v_held_units numeric;
  v_held_cost numeric;
  v_held_count integer;
  v_id uuid;
  v_usage jsonb;
BEGIN
  IF v_scope IS NULL OR v_kind NOT IN ('image', 'video') OR v_source IS NULL OR v_source_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid', 'reason', 'Invalid reservation request.');
  END IF;

  -- One reservation decision at a time per scope.
  PERFORM pg_advisory_xact_lock(hashtext('ai_usage_reservation:' || v_scope));

  SELECT * INTO v_existing
    FROM public.ai_usage_reservations
   WHERE source = v_source AND source_id = v_source_id;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', v_existing.state <> 'released', 'id', v_existing.id,
      'state', v_existing.state, 'code', CASE WHEN v_existing.state = 'released' THEN 'released' END,
      'reason', CASE WHEN v_existing.state = 'released' THEN 'This reservation was already released.' END);
  END IF;

  SELECT coalesce(sum(cost_usd) FILTER (WHERE day = (now() AT TIME ZONE 'utc')::date), 0),
         coalesce(sum(cost_usd), 0),
         coalesce(sum(CASE WHEN v_kind = 'video' THEN videos ELSE images END), 0)
    INTO v_today_cost, v_month_cost, v_month_units
    FROM public.ai_usage_daily
   WHERE scope_key = v_scope
     AND day >= date_trunc('month', now() AT TIME ZONE 'utc')::date;

  SELECT coalesce(sum(units) FILTER (WHERE kind = v_kind), 0),
         coalesce(sum(est_cost_usd), 0),
         count(*) FILTER (WHERE source = v_source)
    INTO v_held_units, v_held_cost, v_held_count
    FROM public.ai_usage_reservations
   WHERE scope_key = v_scope AND state = 'held' AND expires_at > now();

  v_usage := jsonb_build_object(
    'month_units', v_month_units, 'held_units', v_held_units,
    'today_cost_usd', v_today_cost, 'month_cost_usd', v_month_cost, 'held_cost_usd', v_held_cost,
    'held_count', v_held_count);

  IF v_quota IS NOT NULL AND v_month_units + v_held_units + v_units > v_quota THEN
    RETURN jsonb_build_object('ok', false, 'code', 'quota', 'usage', v_usage,
      'reason', format('Monthly %s quota reached for this plan.', v_kind));
  END IF;
  IF v_monthly IS NOT NULL AND v_month_cost + v_held_cost + v_cost > v_monthly THEN
    RETURN jsonb_build_object('ok', false, 'code', 'spend', 'usage', v_usage,
      'reason', 'AI spend limit reached for this month.');
  END IF;
  IF v_daily IS NOT NULL AND v_today_cost + v_held_cost + v_cost > v_daily THEN
    RETURN jsonb_build_object('ok', false, 'code', 'spend', 'usage', v_usage,
      'reason', 'AI spend limit reached for today.');
  END IF;
  IF v_max_concurrent > 0 AND v_held_count >= v_max_concurrent THEN
    RETURN jsonb_build_object('ok', false, 'code', 'concurrency', 'usage', v_usage,
      'reason', format('%s renders are already in progress. Wait for one to finish.', v_held_count));
  END IF;

  INSERT INTO public.ai_usage_reservations (
    scope_key, workspace_id, user_id, kind, units, est_cost_usd, provider, model, route,
    source, source_id, expires_at
  ) VALUES (
    v_scope,
    nullif(p_request ->> 'workspace_id', '')::uuid,
    nullif(p_request ->> 'user_id', '')::uuid,
    v_kind, v_units, v_cost,
    coalesce(p_request ->> 'provider', 'unknown'),
    coalesce(p_request ->> 'model', 'unknown'),
    coalesce(p_request ->> 'route', 'unknown'),
    v_source, v_source_id,
    now() + make_interval(secs => v_ttl)
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id, 'state', 'held', 'usage', v_usage);
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_ai_usage(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_ai_usage(jsonb) TO service_role;

-- ── Capture ───────────────────────────────────────────────────────────────
-- Records the usage exactly once. A hold the sweeper released only because it
-- expired can still be captured (the render really delivered).
CREATE OR REPLACE FUNCTION public.capture_ai_usage_reservation(
  p_id uuid,
  p_actual_cost_usd numeric DEFAULT NULL,
  p_latency_ms integer DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.ai_usage_reservations%ROWTYPE;
  v_cost numeric;
BEGIN
  UPDATE public.ai_usage_reservations
     SET state = 'captured',
         captured_at = now(),
         captured_cost_usd = coalesce(p_actual_cost_usd, est_cost_usd)
   WHERE id = p_id
     AND (state = 'held' OR (state = 'released' AND release_reason = 'expired'))
  RETURNING * INTO v_row;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  v_cost := coalesce(p_actual_cost_usd, v_row.est_cost_usd);
  PERFORM public.record_ai_usage(jsonb_build_object(
    'workspace_id', v_row.workspace_id,
    'user_id', v_row.user_id,
    'route', v_row.route,
    'provider', v_row.provider,
    'model', v_row.model,
    'kind', v_row.kind,
    'units', v_row.units,
    'est_cost_usd', v_cost,
    'latency_ms', p_latency_ms,
    'status', 'ok',
    'request_id', 'reservation:' || v_row.id::text
  ));
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.capture_ai_usage_reservation(uuid, numeric, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.capture_ai_usage_reservation(uuid, numeric, integer)
  TO service_role;

-- ── Release ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.release_ai_usage_reservation(p_id uuid, p_reason text DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH released AS (
    UPDATE public.ai_usage_reservations
       SET state = 'released', released_at = now(), release_reason = left(p_reason, 200)
     WHERE id = p_id AND state = 'held'
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM released);
$$;

REVOKE ALL ON FUNCTION public.release_ai_usage_reservation(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_ai_usage_reservation(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.release_expired_ai_usage_reservations()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH released AS (
    UPDATE public.ai_usage_reservations
       SET state = 'released', released_at = now(), release_reason = 'expired'
     WHERE state = 'held' AND expires_at <= now()
    RETURNING 1
  )
  SELECT count(*)::integer FROM released;
$$;

REVOKE ALL ON FUNCTION public.release_expired_ai_usage_reservations() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_expired_ai_usage_reservations() TO service_role;

-- ── Budget summary now includes live holds ────────────────────────────────
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
  WITH metered AS (
    SELECT coalesce(sum(cost_usd) FILTER (WHERE day = (now() AT TIME ZONE 'utc')::date), 0) AS today_cost,
           coalesce(sum(cost_usd), 0) AS month_cost,
           coalesce(sum(images), 0) AS images,
           coalesce(sum(videos), 0) AS videos,
           coalesce(sum(calls), 0) AS calls,
           coalesce(sum(cached_calls), 0) AS cached_calls,
           coalesce(sum(saved_usd), 0) AS saved
      FROM public.ai_usage_daily
     WHERE scope_key = p_scope_key
       AND day >= date_trunc('month', now() AT TIME ZONE 'utc')::date
  ), held AS (
    SELECT coalesce(sum(est_cost_usd), 0) AS cost,
           coalesce(sum(units) FILTER (WHERE kind = 'image'), 0) AS images,
           coalesce(sum(units) FILTER (WHERE kind = 'video'), 0) AS videos
      FROM public.ai_usage_reservations
     WHERE scope_key = p_scope_key AND state = 'held' AND expires_at > now()
  )
  SELECT m.today_cost + h.cost,
         m.month_cost + h.cost,
         (m.images + h.images)::bigint,
         (m.videos + h.videos)::bigint,
         m.calls::bigint,
         m.cached_calls::bigint,
         m.saved
    FROM metered m CROSS JOIN held h;
$$;

REVOKE ALL ON FUNCTION public.ai_usage_summary(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_usage_summary(text) TO service_role;
