-- Competitor Intelligence (Firecrawl + Claude): a multi-page AI-driven crawl
-- and synthesis of a competitor's positioning, strengths, weaknesses, target
-- audience and content themes — distinct from competitor_watches (a
-- regex-based snapshot-diff alerting feature with no AI). Part of the
-- Firecrawl/Mastra/Helicone/Promptfoo/Trigger.dev/LiteLLM integration
-- initiative (docs/adr/0017-firecrawl-web-intelligence.md).
--
-- Runs inline within the request in this migration's companion code
-- (src/server/research/competitor-intel.server.ts); a later phase moves
-- execution onto Trigger.dev without changing this table's shape. No
-- lease/claim columns — nothing polls this table yet.
--
-- Members read; the service role writes. Idempotent and non-destructive.

CREATE TABLE IF NOT EXISTS public.competitor_intelligence_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  competitor_url text NOT NULL,
  status text NOT NULL DEFAULT 'running',
  pages_crawled jsonb NOT NULL DEFAULT '[]'::jsonb,
  result jsonb,
  error text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT competitor_intelligence_runs_status_check
    CHECK (status IN ('running', 'succeeded', 'failed')),
  CONSTRAINT competitor_intelligence_runs_url_length
    CHECK (char_length(competitor_url) <= 2048),
  CONSTRAINT competitor_intelligence_runs_error_length
    CHECK (error IS NULL OR char_length(error) <= 2000)
);

CREATE INDEX IF NOT EXISTS competitor_intelligence_runs_workspace_idx
  ON public.competitor_intelligence_runs (workspace_id, created_at DESC);

-- ── Row-level security ────────────────────────────────────────────────────
ALTER TABLE public.competitor_intelligence_runs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.competitor_intelligence_runs FROM anon, authenticated;
GRANT SELECT ON public.competitor_intelligence_runs TO authenticated;
GRANT ALL ON public.competitor_intelligence_runs TO service_role;

DROP POLICY IF EXISTS "Workspace members read competitor intel runs" ON public.competitor_intelligence_runs;
CREATE POLICY "Workspace members read competitor intel runs"
  ON public.competitor_intelligence_runs FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP TRIGGER IF EXISTS competitor_intelligence_runs_touch_updated_at ON public.competitor_intelligence_runs;
CREATE TRIGGER competitor_intelligence_runs_touch_updated_at
  BEFORE UPDATE ON public.competitor_intelligence_runs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
