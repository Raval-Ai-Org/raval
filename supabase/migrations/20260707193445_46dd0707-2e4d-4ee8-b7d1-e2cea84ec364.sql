CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.is_workspace_member(_workspace_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id = _workspace_id AND user_id = _user_id);
$$;
REVOKE ALL ON FUNCTION private.is_workspace_member(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.is_workspace_member(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
REVOKE ALL ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.touch_updated_at() TO service_role;

CREATE TYPE public.client_status AS ENUM ('active','onboarding','paused');
ALTER TABLE public.workspaces ADD COLUMN client_status public.client_status NOT NULL DEFAULT 'onboarding';

CREATE TABLE public.content_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent text NOT NULL DEFAULT 'spark',
  kind text NOT NULL DEFAULT 'post',
  channel text,
  title text,
  body text,
  hashtags text[] DEFAULT '{}',
  media_url text,
  status text NOT NULL DEFAULT 'draft',
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
CREATE INDEX idx_content_items_workspace_status ON public.content_items(workspace_id, status);
CREATE INDEX idx_content_items_scheduled ON public.content_items(scheduled_at);
CREATE POLICY "Members can view content items" ON public.content_items FOR SELECT TO authenticated USING (private.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "Members can insert content items" ON public.content_items FOR INSERT TO authenticated WITH CHECK (private.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "Members can update content items" ON public.content_items FOR UPDATE TO authenticated USING (private.is_workspace_member(workspace_id, auth.uid())) WITH CHECK (private.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "Members can delete content items" ON public.content_items FOR DELETE TO authenticated USING (private.is_workspace_member(workspace_id, auth.uid()));
CREATE TRIGGER content_items_touch BEFORE UPDATE ON public.content_items FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agent text NOT NULL,
  prompt text NOT NULL,
  status text NOT NULL DEFAULT 'completed',
  output jsonb DEFAULT '{}'::jsonb,
  content_item_id uuid REFERENCES public.content_items(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_runs TO authenticated;
GRANT ALL ON public.agent_runs TO service_role;
ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_agent_runs_workspace_created ON public.agent_runs(workspace_id, created_at DESC);
CREATE POLICY "Members can view agent runs" ON public.agent_runs FOR SELECT TO authenticated USING (private.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "Members can insert agent runs" ON public.agent_runs FOR INSERT TO authenticated WITH CHECK (private.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "No client updates to agent runs" ON public.agent_runs FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY "No client deletes of agent runs" ON public.agent_runs FOR DELETE TO authenticated USING (false);

ALTER TABLE public.approvals ADD COLUMN content_item_id uuid REFERENCES public.content_items(id) ON DELETE CASCADE;
CREATE INDEX idx_approvals_content_item ON public.approvals(content_item_id);

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE TABLE public.scheduled_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  title text NOT NULL,
  task_type text NOT NULL DEFAULT 'social-post',
  channel text,
  agent text NOT NULL DEFAULT 'spark',
  cadence text NOT NULL DEFAULT 'once',
  timezone text NOT NULL DEFAULT 'UTC',
  next_run_at timestamptz NOT NULL,
  last_run_at timestamptz,
  last_run_status text,
  last_run_error text,
  last_content_item_id uuid,
  run_count integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  prompt text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_scheduled_jobs_workspace ON public.scheduled_jobs(workspace_id);
CREATE INDEX idx_scheduled_jobs_due ON public.scheduled_jobs(next_run_at) WHERE active = true;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scheduled_jobs TO authenticated;
GRANT ALL ON public.scheduled_jobs TO service_role;
ALTER TABLE public.scheduled_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members can view scheduled jobs" ON public.scheduled_jobs FOR SELECT TO authenticated USING (private.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "Members can insert scheduled jobs" ON public.scheduled_jobs FOR INSERT TO authenticated WITH CHECK (private.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "Members can update scheduled jobs" ON public.scheduled_jobs FOR UPDATE TO authenticated USING (private.is_workspace_member(workspace_id, auth.uid())) WITH CHECK (private.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "Members can delete scheduled jobs" ON public.scheduled_jobs FOR DELETE TO authenticated USING (private.is_workspace_member(workspace_id, auth.uid()));
CREATE TRIGGER touch_scheduled_jobs_updated BEFORE UPDATE ON public.scheduled_jobs FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.client_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Shared with client',
  slug text NOT NULL UNIQUE,
  token_hash text NOT NULL,
  client_name text,
  client_email text,
  password_hash text,
  expires_at timestamptz,
  allow_comments boolean NOT NULL DEFAULT true,
  allow_approvals boolean NOT NULL DEFAULT true,
  allow_download boolean NOT NULL DEFAULT false,
  branding jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active',
  last_viewed_at timestamptz,
  view_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_client_shares_workspace ON public.client_shares(workspace_id, created_at DESC);
CREATE INDEX idx_client_shares_slug ON public.client_shares(slug);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_shares TO authenticated;
GRANT ALL ON public.client_shares TO service_role;
ALTER TABLE public.client_shares ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members manage workspace shares" ON public.client_shares FOR ALL TO authenticated USING (private.is_workspace_member(workspace_id, auth.uid())) WITH CHECK (private.is_workspace_member(workspace_id, auth.uid()));
CREATE TRIGGER trg_client_shares_updated_at BEFORE UPDATE ON public.client_shares FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.client_share_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id uuid NOT NULL REFERENCES public.client_shares(id) ON DELETE CASCADE,
  kind text NOT NULL,
  ref_id uuid,
  title text,
  description text,
  position integer NOT NULL DEFAULT 0,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  visible boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_client_share_items_share ON public.client_share_items(share_id, position);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_share_items TO authenticated;
GRANT ALL ON public.client_share_items TO service_role;
ALTER TABLE public.client_share_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members manage share items" ON public.client_share_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.client_shares s WHERE s.id = share_id AND private.is_workspace_member(s.workspace_id, auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.client_shares s WHERE s.id = share_id AND private.is_workspace_member(s.workspace_id, auth.uid())));

CREATE TABLE public.client_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id uuid NOT NULL REFERENCES public.client_shares(id) ON DELETE CASCADE,
  item_id uuid REFERENCES public.client_share_items(id) ON DELETE SET NULL,
  kind text NOT NULL,
  body text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_name text,
  actor_email text,
  marketer_decision text NOT NULL DEFAULT 'pending',
  marketer_decided_at timestamptz,
  marketer_decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_client_events_share ON public.client_events(share_id, created_at DESC);
CREATE INDEX idx_client_events_pending ON public.client_events(share_id, marketer_decision);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_events TO authenticated;
GRANT ALL ON public.client_events TO service_role;
ALTER TABLE public.client_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read events" ON public.client_events FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.client_shares s WHERE s.id = share_id AND private.is_workspace_member(s.workspace_id, auth.uid())));
CREATE POLICY "Members update events" ON public.client_events FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.client_shares s WHERE s.id = share_id AND private.is_workspace_member(s.workspace_id, auth.uid()))) WITH CHECK (EXISTS (SELECT 1 FROM public.client_shares s WHERE s.id = share_id AND private.is_workspace_member(s.workspace_id, auth.uid())));
CREATE POLICY "Members delete events" ON public.client_events FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.client_shares s WHERE s.id = share_id AND private.is_workspace_member(s.workspace_id, auth.uid())));
CREATE POLICY "Members insert events" ON public.client_events FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.client_shares cs JOIN public.workspace_members wm ON wm.workspace_id = cs.workspace_id WHERE cs.id = client_events.share_id AND wm.user_id = auth.uid()));

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
CREATE INDEX geo_audit_runs_ws_created_idx ON public.geo_audit_runs (workspace_id, created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.geo_audit_runs TO authenticated;
GRANT ALL ON public.geo_audit_runs TO service_role;
ALTER TABLE public.geo_audit_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Workspace members read geo_audit_runs" ON public.geo_audit_runs FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = geo_audit_runs.workspace_id AND wm.user_id = auth.uid()));
CREATE POLICY "Workspace members insert geo_audit_runs" ON public.geo_audit_runs FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = geo_audit_runs.workspace_id AND wm.user_id = auth.uid()));

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
CREATE INDEX memory_insights_ws_idx ON public.memory_insights (workspace_id, created_at DESC);
CREATE UNIQUE INDEX memory_insights_ws_body_idx ON public.memory_insights (workspace_id, lower(body));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.memory_insights TO authenticated;
GRANT ALL ON public.memory_insights TO service_role;
ALTER TABLE public.memory_insights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Workspace members read memory_insights" ON public.memory_insights FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = memory_insights.workspace_id AND wm.user_id = auth.uid()));
CREATE POLICY "Workspace members write memory_insights" ON public.memory_insights FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = memory_insights.workspace_id AND wm.user_id = auth.uid()));
CREATE POLICY "Workspace members update memory_insights" ON public.memory_insights FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = memory_insights.workspace_id AND wm.user_id = auth.uid()));
CREATE POLICY "Workspace members delete memory_insights" ON public.memory_insights FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = memory_insights.workspace_id AND wm.user_id = auth.uid()));
CREATE TRIGGER memory_insights_touch BEFORE UPDATE ON public.memory_insights FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.content_items REPLICA IDENTITY FULL;
ALTER TABLE public.approvals REPLICA IDENTITY FULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'content_items') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.content_items;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'approvals') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.approvals;
  END IF;
END $$;

-- Replace handle_new_user with idempotent version
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_ws uuid; display_name text; avatar text;
BEGIN
  display_name := COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1), 'New user');
  avatar := COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture');
  INSERT INTO public.profiles (id, name, avatar_url) VALUES (NEW.id, display_name, avatar)
  ON CONFLICT (id) DO UPDATE SET name = COALESCE(EXCLUDED.name, public.profiles.name), avatar_url = COALESCE(EXCLUDED.avatar_url, public.profiles.avatar_url);
  SELECT wm.workspace_id INTO new_ws FROM public.workspace_members wm WHERE wm.user_id = NEW.id ORDER BY wm.created_at ASC LIMIT 1;
  IF new_ws IS NULL THEN
    INSERT INTO public.workspaces (owner_id, name) VALUES (NEW.id, 'My Workspace') RETURNING id INTO new_ws;
    INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES (new_ws, NEW.id, 'owner') ON CONFLICT (workspace_id, user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Update policies to use private helper
DROP POLICY IF EXISTS workspaces_select_members ON public.workspaces;
CREATE POLICY workspaces_select_members ON public.workspaces FOR SELECT TO authenticated USING (private.is_workspace_member(id, auth.uid()));
DROP POLICY IF EXISTS members_select_self_workspace ON public.workspace_members;
CREATE POLICY members_select_self_workspace ON public.workspace_members FOR SELECT TO authenticated USING (private.is_workspace_member(workspace_id, auth.uid()));
DROP POLICY IF EXISTS chat_select_members ON public.chat_messages;
CREATE POLICY chat_select_members ON public.chat_messages FOR SELECT TO authenticated USING (private.is_workspace_member(workspace_id, auth.uid()));
DROP POLICY IF EXISTS chat_insert_members ON public.chat_messages;
CREATE POLICY chat_insert_members ON public.chat_messages FOR INSERT TO authenticated WITH CHECK (private.is_workspace_member(workspace_id, auth.uid()));
DROP POLICY IF EXISTS approvals_select_members ON public.approvals;
CREATE POLICY approvals_select_members ON public.approvals FOR SELECT TO authenticated USING (private.is_workspace_member(workspace_id, auth.uid()));
DROP POLICY IF EXISTS approvals_insert_members ON public.approvals;
CREATE POLICY approvals_insert_members ON public.approvals FOR INSERT TO authenticated WITH CHECK (private.is_workspace_member(workspace_id, auth.uid()));
DROP POLICY IF EXISTS audit_select_members ON public.audit_logs;
CREATE POLICY audit_select_members ON public.audit_logs FOR SELECT TO authenticated USING (private.is_workspace_member(workspace_id, auth.uid()));
