-- Server-owned Standard Google Trends task/cache records.
CREATE TABLE public.market_trend_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_key text NOT NULL UNIQUE,
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

CREATE INDEX market_trend_collections_lookup_idx
  ON public.market_trend_collections (request_key, status, updated_at DESC);

ALTER TABLE public.market_trend_collections ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.market_trend_collections TO service_role;

CREATE TRIGGER market_trend_collections_touch
  BEFORE UPDATE ON public.market_trend_collections
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
