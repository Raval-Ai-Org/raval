-- Production-safe Market Brain schema built against the live workspace model.
--
-- CONVERGENT: this migration must succeed on two starting states —
--   (a) a database that never applied 20260910070000 / 20260910080000
--       (tables absent) → create them workspace-scoped;
--   (b) a database that did apply them (global `request_key UNIQUE`, no
--       workspace_id) → alter them into the workspace-scoped shape.
-- Its first version used plain CREATE TABLE and failed on (b), which made the
-- migration baseline unreplayable. Both tables are caches of provider results,
-- so rows that cannot be attributed to a workspace are safely discarded.

CREATE TABLE IF NOT EXISTS public.market_trend_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
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
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- (b) upgrade path: add the workspace scope + provider to the older shape.
ALTER TABLE public.market_trend_collections
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'dataforseo';

-- Unattributable cache rows (and their derived analyses, via CASCADE) go.
DELETE FROM public.market_trend_collections WHERE workspace_id IS NULL;
ALTER TABLE public.market_trend_collections ALTER COLUMN workspace_id SET NOT NULL;

-- The older shape had a global UNIQUE (request_key); the key is per workspace.
ALTER TABLE public.market_trend_collections
  DROP CONSTRAINT IF EXISTS market_trend_collections_request_key_key;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'market_trend_collections_workspace_request_key_key'
       AND conrelid = 'public.market_trend_collections'::regclass
  ) THEN
    ALTER TABLE public.market_trend_collections
      ADD CONSTRAINT market_trend_collections_workspace_request_key_key
      UNIQUE (workspace_id, request_key);
  END IF;
END
$$;

DROP INDEX IF EXISTS public.market_trend_collections_lookup_idx;
CREATE INDEX IF NOT EXISTS market_trend_collections_workspace_status_idx
  ON public.market_trend_collections (workspace_id, status, updated_at DESC);

ALTER TABLE public.market_trend_collections ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.market_trend_collections TO service_role;

CREATE TABLE IF NOT EXISTS public.market_intelligence_cache (
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

DROP INDEX IF EXISTS public.market_intelligence_cache_lookup_idx;
CREATE INDEX IF NOT EXISTS market_intelligence_cache_workspace_collection_idx
  ON public.market_intelligence_cache (workspace_id, collection_id, analysis_type);

ALTER TABLE public.market_intelligence_cache ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.market_intelligence_cache TO service_role;

DO $$
BEGIN
  IF to_regprocedure('public.touch_updated_at()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS market_trend_collections_touch ON public.market_trend_collections;
    CREATE TRIGGER market_trend_collections_touch
      BEFORE UPDATE ON public.market_trend_collections
      FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
    DROP TRIGGER IF EXISTS market_intelligence_cache_touch ON public.market_intelligence_cache;
    CREATE TRIGGER market_intelligence_cache_touch
      BEFORE UPDATE ON public.market_intelligence_cache
      FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
END
$$;
