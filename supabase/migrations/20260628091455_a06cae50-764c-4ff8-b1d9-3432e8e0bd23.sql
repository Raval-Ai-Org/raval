
-- Helper: workspace membership check (security definer to avoid RLS recursion)
CREATE OR REPLACE FUNCTION public.is_workspace_member(_workspace_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = _workspace_id AND user_id = _user_id
  );
$$;

-- content_items: the unified content unit produced by agents
CREATE TABLE public.content_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent text NOT NULL DEFAULT 'spark', -- scout | spark | echo
  kind text NOT NULL DEFAULT 'post',   -- post | brief | email | landing | blog
  channel text,                        -- instagram | x | linkedin | tiktok | youtube | blog | email | web
  title text,
  body text,
  hashtags text[] DEFAULT '{}',
  media_url text,
  status text NOT NULL DEFAULT 'draft', -- draft | pending | approved | rejected | scheduled | published
  scheduled_at timestamptz,
  metrics jsonb DEFAULT '{}'::jsonb,
  meta jsonb DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_items TO authenticated;
GRANT ALL ON public.content_items TO service_role;

ALTER TABLE public.content_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view content items"
  ON public.content_items FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));

CREATE POLICY "Members can insert content items"
  ON public.content_items FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));

CREATE POLICY "Members can update content items"
  ON public.content_items FOR UPDATE TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));

CREATE POLICY "Members can delete content items"
  ON public.content_items FOR DELETE TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));

CREATE INDEX idx_content_items_workspace_status ON public.content_items(workspace_id, status);
CREATE INDEX idx_content_items_scheduled ON public.content_items(scheduled_at);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER content_items_touch
  BEFORE UPDATE ON public.content_items
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- agent_runs: activity log for chat-driven generations
CREATE TABLE public.agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent text NOT NULL,
  prompt text NOT NULL,
  status text NOT NULL DEFAULT 'completed', -- running | completed | failed
  output jsonb DEFAULT '{}'::jsonb,
  content_item_id uuid REFERENCES public.content_items(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_runs TO authenticated;
GRANT ALL ON public.agent_runs TO service_role;

ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view agent runs"
  ON public.agent_runs FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));

CREATE POLICY "Members can insert agent runs"
  ON public.agent_runs FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));

CREATE INDEX idx_agent_runs_workspace_created ON public.agent_runs(workspace_id, created_at DESC);

-- Link approvals to content_items (optional)
ALTER TABLE public.approvals ADD COLUMN IF NOT EXISTS content_item_id uuid REFERENCES public.content_items(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_approvals_content_item ON public.approvals(content_item_id);
