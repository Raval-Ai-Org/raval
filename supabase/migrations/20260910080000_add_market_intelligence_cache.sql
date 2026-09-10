-- Cached, server-generated intelligence derived from completed market trend collections.
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

CREATE INDEX market_intelligence_cache_lookup_idx
  ON public.market_intelligence_cache (workspace_id, collection_id, analysis_type);

ALTER TABLE public.market_intelligence_cache ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.market_intelligence_cache TO service_role;

CREATE TRIGGER market_intelligence_cache_touch
  BEFORE UPDATE ON public.market_intelligence_cache
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
