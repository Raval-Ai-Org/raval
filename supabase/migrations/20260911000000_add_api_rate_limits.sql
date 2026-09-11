-- Fixed-window rate limiting for the metered AI endpoints.
--
-- Why Postgres and not an in-process Map: the app runs as a Railway standalone
-- Docker service that can scale to more than one instance, and module-level
-- counters reset on every deploy. A counter that a user can clear by waiting
-- for a redeploy is not a spend control. This table is the shared store.
--
-- Written ONLY by the service role (src/server/rate-limit.ts via supabaseAdmin).
-- No user-facing client ever reads or writes it.

CREATE TABLE IF NOT EXISTS public.api_rate_limits (
  bucket_key text NOT NULL,
  window_start timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket_key, window_start)
);

-- Supports the opportunistic sweep of expired windows below.
CREATE INDEX IF NOT EXISTS api_rate_limits_window_idx
  ON public.api_rate_limits(window_start);

ALTER TABLE public.api_rate_limits ENABLE ROW LEVEL SECURITY;

-- Deliberately no policies: RLS with zero policies denies every authenticated
-- and anonymous request. Only the service role (which bypasses RLS) can touch
-- it. Revoke the default grants so a future `GRANT ... TO authenticated` on the
-- schema cannot accidentally expose it.
REVOKE ALL ON public.api_rate_limits FROM anon, authenticated;

-- Atomically consume `p_cost` from a fixed window and report whether the caller
-- is still under the limit. One round trip, and the INSERT ... ON CONFLICT makes
-- concurrent requests from the same user serialize on the primary key rather
-- than racing a read-then-write.
--
-- The counter is incremented even when the request is denied. That is
-- intentional: a client that keeps hammering keeps its window pinned, so abuse
-- does not get a free retry the instant it crosses the threshold.
CREATE OR REPLACE FUNCTION public.consume_rate_limit(
  p_bucket_key text,
  p_window_seconds integer,
  p_limit integer,
  p_cost integer DEFAULT 1
)
RETURNS TABLE (allowed boolean, current_count integer, reset_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_window_start timestamptz;
  v_count integer;
BEGIN
  IF p_window_seconds IS NULL OR p_window_seconds <= 0 THEN
    RAISE EXCEPTION 'p_window_seconds must be positive';
  END IF;

  -- Truncate now() down to the start of its window.
  v_window_start := to_timestamp(
    floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds
  );

  INSERT INTO public.api_rate_limits AS l (bucket_key, window_start, request_count, updated_at)
  VALUES (p_bucket_key, v_window_start, GREATEST(p_cost, 0), now())
  ON CONFLICT (bucket_key, window_start)
  DO UPDATE SET
    request_count = l.request_count + GREATEST(p_cost, 0),
    updated_at = now()
  RETURNING l.request_count INTO v_count;

  -- Opportunistic GC (~1 call in 1000) so expired windows do not accumulate.
  -- Cheaper than a dedicated cron row and self-healing under any traffic level.
  IF random() < 0.001 THEN
    DELETE FROM public.api_rate_limits
    WHERE window_start < now() - interval '1 day';
  END IF;

  RETURN QUERY SELECT
    v_count <= p_limit,
    v_count,
    v_window_start + make_interval(secs => p_window_seconds);
END;
$$;

REVOKE ALL ON FUNCTION public.consume_rate_limit(text, integer, integer, integer)
  FROM anon, authenticated, public;
