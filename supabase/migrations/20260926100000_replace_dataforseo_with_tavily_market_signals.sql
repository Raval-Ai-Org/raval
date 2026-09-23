-- Market Brain now collects its evidence via Tavily web search
-- (src/server/research/market-signals.server.ts) instead of Google Trends via
-- DataForSEO, which is removed from the product entirely. Google Trends
-- returned a numeric search-interest index; Tavily returns web sources, so
-- market_trend_collections.normalized_result changes shape from a trends
-- time series to a list of {title, url, snippet, publishedDate}. Rows written
-- in the old shape are not readable by the new code, so this clears them —
-- both tables are provider caches (see 20260911090000's header), never user
-- data, and a cleared cache just means the next scan collects fresh evidence.
--
-- Idempotent: safe to replay against a database that already applied it.

TRUNCATE TABLE public.market_trend_collections CASCADE;

ALTER TABLE public.market_trend_collections
  DROP COLUMN IF EXISTS dataforseo_task_id,
  DROP COLUMN IF EXISTS date_from,
  DROP COLUMN IF EXISTS date_to,
  DROP COLUMN IF EXISTS time_range,
  DROP COLUMN IF EXISTS last_polled_at,
  DROP COLUMN IF EXISTS language,
  ALTER COLUMN provider SET DEFAULT 'tavily';

UPDATE public.market_trend_collections SET provider = 'tavily' WHERE provider = 'dataforseo';
