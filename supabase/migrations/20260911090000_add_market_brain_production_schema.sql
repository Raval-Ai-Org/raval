-- Production-safe Market Brain schema built against the live workspace model.
CREATE TABLE public.market_trend_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  request_key text NOT NULL,
  provider text NOT NULL DEFAULT 'dataforseo',
  keywords text[] NOT NULL,
  location text,
  language text,
  date_from date,
  date_to date,
  time_range text,
  dataforseo_task_id text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'failed')),
  normalized_result jsonb,
  provider_error jsonb,
  requested_at timestamptz NOT NULL DEFAULT now(),
  last_polled_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT market_trend_collections_workspace_request_key_key
    UNIQUE (workspace_id, request_key)
);

CREATE INDEX market_trend_collections_workspace_status_idx
  ON public.market_trend_collections (workspace_id, status, updated_at DESC);

ALTER TABLE public.market_trend_collections ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.market_trend_collections TO service_role;

CREATE TABLE public.market_intelligence_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  collection_id uuid NOT NULL REFERENCES public.market_trend_collections(id) ON DELETE CASCADE,
  analysis_key text NOT NULL UNIQUE,
  analysis_type text NOT NULL DEFAULT 'market_strategy',
  context_fingerprint text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX market_intelligence_cache_workspace_collection_idx
  ON public.market_intelligence_cache (workspace_id, collection_id, analysis_type);

ALTER TABLE public.market_intelligence_cache ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.market_intelligence_cache TO service_role;

DO $$
BEGIN
  IF to_regprocedure('public.touch_updated_at()') IS NOT NULL THEN
    CREATE TRIGGER market_trend_collections_touch
      BEFORE UPDATE ON public.market_trend_collections
      FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
    CREATE TRIGGER market_intelligence_cache_touch
      BEFORE UPDATE ON public.market_intelligence_cache
      FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
END
$$;
