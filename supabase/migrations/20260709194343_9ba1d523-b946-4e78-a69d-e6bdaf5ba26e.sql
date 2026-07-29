
-- Competitor watch: URLs to monitor per workspace + detected alerts

CREATE TABLE public.competitor_watches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  name TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_snapshot JSONB,
  last_checked_at TIMESTAMPTZ,
  last_error TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, url)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.competitor_watches TO authenticated;
GRANT ALL ON public.competitor_watches TO service_role;
ALTER TABLE public.competitor_watches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members read watches" ON public.competitor_watches
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "members insert watches" ON public.competitor_watches
  FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "members update watches" ON public.competitor_watches
  FOR UPDATE TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "members delete watches" ON public.competitor_watches
  FOR DELETE TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));

CREATE INDEX competitor_watches_ws_idx ON public.competitor_watches(workspace_id);
CREATE INDEX competitor_watches_enabled_idx ON public.competitor_watches(enabled, last_checked_at);

CREATE TRIGGER competitor_watches_touch
  BEFORE UPDATE ON public.competitor_watches
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.competitor_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  watch_id UUID NOT NULL REFERENCES public.competitor_watches(id) ON DELETE CASCADE,
  kind TEXT NOT NULL, -- 'new_page' | 'promotion' | 'positioning' | 'title' | 'cta'
  severity TEXT NOT NULL DEFAULT 'info', -- 'info' | 'warning' | 'critical'
  title TEXT NOT NULL,
  detail TEXT,
  before_value TEXT,
  after_value TEXT,
  source_url TEXT,
  read_at TIMESTAMPTZ,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.competitor_alerts TO authenticated;
GRANT ALL ON public.competitor_alerts TO service_role;
ALTER TABLE public.competitor_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members read alerts" ON public.competitor_alerts
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "members update alerts" ON public.competitor_alerts
  FOR UPDATE TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "members delete alerts" ON public.competitor_alerts
  FOR DELETE TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));
-- Inserts happen from server-side cron with service_role; no INSERT policy needed for authenticated.

CREATE INDEX competitor_alerts_ws_idx ON public.competitor_alerts(workspace_id, detected_at DESC);
CREATE INDEX competitor_alerts_unread_idx ON public.competitor_alerts(workspace_id) WHERE read_at IS NULL;
