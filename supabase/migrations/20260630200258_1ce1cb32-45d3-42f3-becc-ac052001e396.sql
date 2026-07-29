-- 1. geo_audit_runs ---------------------------------------------------------
CREATE TABLE public.geo_audit_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  url text,
  score integer NOT NULL,
  subscores jsonb NOT NULL DEFAULT '{}'::jsonb,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX geo_audit_runs_ws_created_idx
  ON public.geo_audit_runs (workspace_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.geo_audit_runs TO authenticated;
GRANT ALL ON public.geo_audit_runs TO service_role;

ALTER TABLE public.geo_audit_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Workspace members read geo_audit_runs"
  ON public.geo_audit_runs FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = geo_audit_runs.workspace_id
      AND wm.user_id = auth.uid()
  ));

CREATE POLICY "Workspace members insert geo_audit_runs"
  ON public.geo_audit_runs FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = geo_audit_runs.workspace_id
      AND wm.user_id = auth.uid()
  ));

-- 2. memory_insights --------------------------------------------------------
CREATE TABLE public.memory_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'insight',
  body text NOT NULL,
  source_label text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX memory_insights_ws_idx
  ON public.memory_insights (workspace_id, created_at DESC);

CREATE UNIQUE INDEX memory_insights_ws_body_idx
  ON public.memory_insights (workspace_id, lower(body));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.memory_insights TO authenticated;
GRANT ALL ON public.memory_insights TO service_role;

ALTER TABLE public.memory_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Workspace members read memory_insights"
  ON public.memory_insights FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = memory_insights.workspace_id
      AND wm.user_id = auth.uid()
  ));

CREATE POLICY "Workspace members write memory_insights"
  ON public.memory_insights FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = memory_insights.workspace_id
      AND wm.user_id = auth.uid()
  ));

CREATE POLICY "Workspace members update memory_insights"
  ON public.memory_insights FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = memory_insights.workspace_id
      AND wm.user_id = auth.uid()
  ));

CREATE POLICY "Workspace members delete memory_insights"
  ON public.memory_insights FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = memory_insights.workspace_id
      AND wm.user_id = auth.uid()
  ));

CREATE TRIGGER memory_insights_touch
  BEFORE UPDATE ON public.memory_insights
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 3. Realtime publication ---------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'content_items'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.content_items;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'approvals'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.approvals;
  END IF;
END$$;

ALTER TABLE public.content_items REPLICA IDENTITY FULL;
ALTER TABLE public.approvals REPLICA IDENTITY FULL;