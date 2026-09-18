-- Unified analytics — read-side aggregates and the GA4 period-users cache.
--
--   analytics_ga4_period_totals   GA4 "users" for an exact date range. Users are
--                                 not additive across days, so a range total is
--                                 fetched from the Data API once and cached here
--                                 (presets at sync time, custom ranges on read).
--   analytics_ga4_dimension_totals(...)  grouped GA4 rows for a range (top N)
--   analytics_gsc_dimension_totals(...)  grouped Search Console rows for a range (top N)
--
-- The two functions are SECURITY INVOKER: they run under the caller's RLS, so a
-- member only ever aggregates their own workspace's rows.
-- Idempotent and non-destructive: safe to re-run.

CREATE TABLE IF NOT EXISTS public.analytics_ga4_period_totals (
  source_id uuid NOT NULL REFERENCES public.analytics_sources(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  date_from date NOT NULL,
  date_to date NOT NULL,
  total_users bigint NOT NULL DEFAULT 0,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, date_from, date_to),
  CONSTRAINT analytics_ga4_period_totals_range_check CHECK (date_from <= date_to)
);

ALTER TABLE public.analytics_ga4_period_totals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.analytics_ga4_period_totals FROM anon, authenticated;
GRANT SELECT ON public.analytics_ga4_period_totals TO authenticated;
GRANT ALL ON public.analytics_ga4_period_totals TO service_role;

DROP POLICY IF EXISTS "Workspace members read ga4 period totals" ON public.analytics_ga4_period_totals;
CREATE POLICY "Workspace members read ga4 period totals"
  ON public.analytics_ga4_period_totals FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP TRIGGER IF EXISTS analytics_ga4_period_totals_workspace_guard ON public.analytics_ga4_period_totals;
CREATE TRIGGER analytics_ga4_period_totals_workspace_guard
  BEFORE INSERT OR UPDATE OF workspace_id, source_id ON public.analytics_ga4_period_totals
  FOR EACH ROW EXECUTE FUNCTION private.analytics_source_workspace_guard();

CREATE OR REPLACE FUNCTION public.analytics_ga4_dimension_totals(
  p_source_id uuid,
  p_dimension text,
  p_from date,
  p_to date,
  p_limit integer DEFAULT 25
)
RETURNS TABLE (
  value text,
  sessions bigint,
  screen_page_views bigint,
  key_events numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT d.value,
         sum(d.sessions)::bigint,
         sum(d.screen_page_views)::bigint,
         sum(d.key_events)
    FROM public.analytics_ga4_dimension_daily d
   WHERE d.source_id = p_source_id
     AND d.dimension = p_dimension
     AND d.date BETWEEN p_from AND p_to
   GROUP BY d.value
   ORDER BY sum(d.sessions) DESC, d.value
   LIMIT least(greatest(p_limit, 1), 200);
$$;

CREATE OR REPLACE FUNCTION public.analytics_gsc_dimension_totals(
  p_source_id uuid,
  p_dimension text,
  p_from date,
  p_to date,
  p_limit integer DEFAULT 25
)
RETURNS TABLE (
  value text,
  clicks bigint,
  impressions bigint,
  position_weighted numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT d.value,
         sum(d.clicks)::bigint,
         sum(d.impressions)::bigint,
         sum(d.position_weighted)
    FROM public.analytics_gsc_dimension_daily d
   WHERE d.source_id = p_source_id
     AND d.dimension = p_dimension
     AND d.date BETWEEN p_from AND p_to
   GROUP BY d.value
   ORDER BY sum(d.clicks) DESC, sum(d.impressions) DESC, d.value
   LIMIT least(greatest(p_limit, 1), 200);
$$;

REVOKE ALL ON FUNCTION public.analytics_ga4_dimension_totals(uuid, text, date, date, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.analytics_gsc_dimension_totals(uuid, text, date, date, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.analytics_ga4_dimension_totals(uuid, text, date, date, integer)
  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.analytics_gsc_dimension_totals(uuid, text, date, date, integer)
  TO authenticated, service_role;
