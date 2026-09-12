-- Mellox AI consolidated schema baseline — GENERATED, do not edit.
-- Source: supabase/baseline/manifest.txt  ·  node scripts/db-baseline.mjs --write
-- Bootstraps an EMPTY Supabase project (staging / disaster recovery).
-- Requires the Supabase platform schemas (auth, storage, vault) and the
-- pg_cron + pg_net extensions to be enabled first.

-- ═══ 20260707193303_93348393-698b-4f35-ae22-644af74d8942.sql ═══
-- Roles enum
CREATE TYPE public.app_role AS ENUM ('owner','admin','editor','viewer');

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_select_own" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

CREATE TABLE public.workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'My Workspace',
  plan text NOT NULL DEFAULT 'starter',
  brand_voice jsonb NOT NULL DEFAULT '{}'::jsonb,
  website_url text,
  first_prompt text,
  industry text,
  audience text,
  goals text,
  connected_provider text,
  onboarded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspaces TO authenticated;
GRANT ALL ON public.workspaces TO service_role;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.workspace_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL DEFAULT 'owner',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_members TO authenticated;
GRANT ALL ON public.workspace_members TO service_role;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_workspace_member(_workspace_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.workspace_members WHERE workspace_id = _workspace_id AND user_id = _user_id);
$$;

CREATE POLICY "workspaces_select_members" ON public.workspaces FOR SELECT USING (public.is_workspace_member(id, auth.uid()));
CREATE POLICY "workspaces_insert_owner" ON public.workspaces FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "workspaces_update_owner" ON public.workspaces FOR UPDATE USING (auth.uid() = owner_id);
CREATE POLICY workspaces_delete_owner ON public.workspaces FOR DELETE TO authenticated USING (auth.uid() = owner_id);

CREATE POLICY "members_select_self_workspace" ON public.workspace_members FOR SELECT USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY members_insert_by_owner ON public.workspace_members FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_id AND w.owner_id = auth.uid()));
CREATE POLICY members_update_by_owner ON public.workspace_members FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_id AND w.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_id AND w.owner_id = auth.uid()));
CREATE POLICY members_delete_by_owner_or_self ON public.workspace_members FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_id AND w.owner_id = auth.uid()));

CREATE TABLE public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant','system')),
  kind text NOT NULL DEFAULT 'text' CHECK (kind IN ('text','approval','progress','reminder')),
  content text NOT NULL DEFAULT '',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_messages TO authenticated;
GRANT ALL ON public.chat_messages TO service_role;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "chat_select_members" ON public.chat_messages FOR SELECT USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "chat_insert_members" ON public.chat_messages FOR INSERT WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY chat_no_update ON public.chat_messages FOR UPDATE USING (false) WITH CHECK (false);
CREATE POLICY chat_no_delete ON public.chat_messages FOR DELETE USING (false);
CREATE INDEX chat_messages_workspace_created_idx ON public.chat_messages(workspace_id, created_at);

CREATE TABLE public.approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  action text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.approvals TO authenticated;
GRANT ALL ON public.approvals TO service_role;
ALTER TABLE public.approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "approvals_select_members" ON public.approvals FOR SELECT USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "approvals_insert_members" ON public.approvals FOR INSERT WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY approvals_update_privileged ON public.approvals FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = approvals.workspace_id AND wm.user_id = auth.uid() AND wm.role IN ('owner','admin','editor')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = approvals.workspace_id AND wm.user_id = auth.uid() AND wm.role IN ('owner','admin','editor')));
CREATE POLICY approvals_no_delete ON public.approvals FOR DELETE TO authenticated, anon USING (false);

CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_select_members" ON public.audit_logs FOR SELECT USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY audit_no_client_insert ON public.audit_logs FOR INSERT TO authenticated, anon WITH CHECK (false);
CREATE POLICY audit_no_client_delete ON public.audit_logs FOR DELETE TO authenticated, anon USING (false);
CREATE POLICY audit_logs_no_update ON public.audit_logs FOR UPDATE TO authenticated USING (false) WITH CHECK (false);

CREATE TABLE public.workspace_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'editor' CHECK (role IN ('editor','viewer')),
  invited_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token uuid NOT NULL DEFAULT gen_random_uuid(),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, email)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_invites TO authenticated;
GRANT ALL ON public.workspace_invites TO service_role;
ALTER TABLE public.workspace_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY invites_select_owner ON public.workspace_invites FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_invites.workspace_id AND w.owner_id = auth.uid()));
CREATE POLICY invites_insert_owner ON public.workspace_invites FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_id AND w.owner_id = auth.uid()));
CREATE POLICY invites_update_owner ON public.workspace_invites FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_id AND w.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_id AND w.owner_id = auth.uid()));
CREATE POLICY invites_delete_owner ON public.workspace_invites FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_id AND w.owner_id = auth.uid()));

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_ws uuid;
BEGIN
  INSERT INTO public.profiles (id, name, avatar_url)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email,'@',1)), NEW.raw_user_meta_data->>'avatar_url');
  INSERT INTO public.workspaces (owner_id, name) VALUES (NEW.id, 'My Workspace') RETURNING id INTO new_ws;
  INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES (new_ws, NEW.id, 'owner');
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.create_workspace(p_name text, p_website_url text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN RAISE EXCEPTION 'name required'; END IF;
  INSERT INTO public.workspaces (owner_id, name, website_url) VALUES (v_uid, btrim(p_name), NULLIF(btrim(p_website_url), '')) RETURNING id INTO v_id;
  INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES (v_id, v_uid, 'owner') ON CONFLICT (workspace_id, user_id) DO NOTHING;
  RETURN v_id;
END; $$;

CREATE OR REPLACE FUNCTION public.accept_workspace_invite(_token uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_email text := lower(coalesce((auth.jwt()->>'email'),'')); v_inv RECORD;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO v_inv FROM public.workspace_invites WHERE token = _token LIMIT 1;
  IF v_inv IS NULL THEN RAISE EXCEPTION 'invite not found'; END IF;
  IF v_inv.accepted_at IS NOT NULL THEN RETURN v_inv.workspace_id; END IF;
  IF lower(v_inv.email) <> v_email THEN RAISE EXCEPTION 'invite email does not match'; END IF;
  INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES (v_inv.workspace_id, v_uid, v_inv.role::app_role) ON CONFLICT (workspace_id, user_id) DO NOTHING;
  UPDATE public.workspace_invites SET accepted_at = now() WHERE id = v_inv.id;
  RETURN v_inv.workspace_id;
END; $$;

CREATE OR REPLACE FUNCTION public.workspace_member_profiles(_workspace_id uuid)
RETURNS TABLE (user_id uuid, role text, name text, avatar_url text, joined_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT wm.user_id, wm.role::text, p.name, p.avatar_url, wm.created_at
  FROM public.workspace_members wm LEFT JOIN public.profiles p ON p.id = wm.user_id
  WHERE wm.workspace_id = _workspace_id AND public.is_workspace_member(_workspace_id, auth.uid());
$$;

REVOKE ALL ON FUNCTION public.is_workspace_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_workspace_member(uuid, uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_workspace(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_workspace(text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.accept_workspace_invite(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_workspace_invite(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.workspace_member_profiles(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workspace_member_profiles(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- ═══ 20260707193445_46dd0707-2e4d-4ee8-b7d1-e2cea84ec364.sql ═══
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

-- [pglite] extension provided by stubs

-- [pglite] extension provided by stubs


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

-- ═══ 20260709194343_9ba1d523-b946-4e78-a69d-e6bdaf5ba26e.sql ═══
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

-- ═══ 20260709212343_4feb1702-87f2-45f0-9b83-6b92ce93a1e9.sql ═══
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE display_name text; avatar text;
BEGIN
  display_name := COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1), 'New user');
  avatar := COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture');
  INSERT INTO public.profiles (id, name, avatar_url) VALUES (NEW.id, display_name, avatar)
  ON CONFLICT (id) DO UPDATE SET name = COALESCE(EXCLUDED.name, public.profiles.name), avatar_url = COALESCE(EXCLUDED.avatar_url, public.profiles.avatar_url);
  RETURN NEW;
END; $function$;

-- Remove stale auto-created empty workspaces (never onboarded, no website, no chats, no content)
DELETE FROM public.workspaces w
WHERE w.name = 'My Workspace'
  AND w.website_url IS NULL
  AND w.onboarded_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM public.chat_messages c WHERE c.workspace_id = w.id)
  AND NOT EXISTS (SELECT 1 FROM public.content_items ci WHERE ci.workspace_id = w.id)
  AND (SELECT count(*) FROM public.workspace_members m WHERE m.workspace_id = w.id) <= 1;

-- ═══ 20260709213859_80e26c94-28cf-45c1-9383-304df23d4ba5.sql ═══
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS persona text, ADD COLUMN IF NOT EXISTS persona_set_at timestamptz;

-- ═══ 20260710100535_45a3451d-82a0-4499-bc1d-7e2e6260ca0c.sql ═══
-- Atomic, idempotent persona setter. First writer wins; concurrent callers
-- get back the persisted value and never overwrite it.
CREATE OR REPLACE FUNCTION public.set_persona_once(_persona text)
RETURNS TABLE(persona text, persona_set_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF _persona IS NULL OR _persona NOT IN ('agency','founder','professional') THEN
    RAISE EXCEPTION 'invalid persona: %', _persona;
  END IF;

  -- Atomic first-writer-wins: only updates when persona is currently NULL.
  -- The row-level lock inside UPDATE serializes concurrent callers on the
  -- same profile row, so a second concurrent request observes the first
  -- write and its WHERE clause matches zero rows.
  UPDATE public.profiles
     SET persona = _persona,
         persona_set_at = now()
   WHERE id = v_uid
     AND persona IS NULL;

  RETURN QUERY
    SELECT p.persona, p.persona_set_at
      FROM public.profiles p
     WHERE p.id = v_uid;
END;
$$;

REVOKE ALL ON FUNCTION public.set_persona_once(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_persona_once(text) TO authenticated;

-- ═══ 20260712203224_2d6ac297-789e-40b6-9228-e05bdb9dfb39.sql ═══
DROP FUNCTION IF EXISTS public.set_persona_once(text);

CREATE OR REPLACE FUNCTION public.set_persona_once(_persona text)
RETURNS TABLE(persona text, persona_set_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF _persona IS NULL OR _persona NOT IN ('agency','founder','professional') THEN
    RAISE EXCEPTION 'invalid persona: %', _persona;
  END IF;

  UPDATE public.profiles AS p
     SET persona = _persona,
         persona_set_at = now()
   WHERE p.id = v_uid
     AND p.persona IS NULL;

  RETURN QUERY
    SELECT p.persona, p.persona_set_at
      FROM public.profiles p
     WHERE p.id = v_uid;
END;
$$;

REVOKE ALL ON FUNCTION public.set_persona_once(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_persona_once(text) TO authenticated;

-- ═══ 20260712220251_2a14b1a0-8e29-4a9a-bad7-e71064c4ce68.sql ═══
REVOKE EXECUTE ON FUNCTION public.set_persona_once(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.set_persona_once(text) TO authenticated;

-- ═══ 20260718184546_e27386a1-4495-4b68-b399-0a94f1d7702d.sql ═══
CREATE OR REPLACE FUNCTION public.log_audit(
  _workspace_id uuid,
  _action text,
  _entity text DEFAULT NULL,
  _payload jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF _workspace_id IS NULL OR _action IS NULL OR length(btrim(_action)) = 0 THEN
    RAISE EXCEPTION 'workspace_id and action required';
  END IF;
  IF NOT public.is_workspace_member(_workspace_id, v_uid) THEN
    RAISE EXCEPTION 'not a workspace member';
  END IF;

  INSERT INTO public.audit_logs (workspace_id, user_id, action, entity, payload)
  VALUES (_workspace_id, v_uid, _action, _entity, COALESCE(_payload, '{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.log_audit(uuid, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_audit(uuid, text, text, jsonb) TO authenticated;

CREATE INDEX IF NOT EXISTS audit_logs_workspace_created_idx
  ON public.audit_logs (workspace_id, created_at DESC);

-- ═══ 20260718184836_4ff53c1f-ade2-4fe4-88c2-518841d56158.sql ═══
-- Tighten content_items UPDATE: require privileged role (owner/admin/editor).
-- Viewers and non-members cannot approve/reject content.
DROP POLICY IF EXISTS "Members can update content items" ON public.content_items;

CREATE POLICY "content_items_update_privileged"
  ON public.content_items
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = content_items.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role = ANY (ARRAY['owner'::app_role, 'admin'::app_role, 'editor'::app_role])
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = content_items.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role = ANY (ARRAY['owner'::app_role, 'admin'::app_role, 'editor'::app_role])
    )
  );

-- Helper to fetch the caller's role on a workspace (NULL if not a member).
CREATE OR REPLACE FUNCTION public.my_workspace_role(_workspace_id uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role::text FROM public.workspace_members
   WHERE workspace_id = _workspace_id AND user_id = auth.uid()
   LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.my_workspace_role(uuid) TO authenticated;

-- ═══ 20260720095116_ad729590-6b24-416b-8a9f-bf7cd05b7214.sql ═══
REVOKE EXECUTE ON FUNCTION public.log_audit(uuid, text, text, jsonb) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.my_workspace_role(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_audit(uuid, text, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_workspace_role(uuid) TO authenticated, service_role;

-- ═══ 20260809000001_add_workspace_sdr.sql ═══
-- workspace_sdr — per-workspace SDR identity (server-only).
-- FR-014: the user client must NEVER read these credentials. RLS is enabled with
-- NO authenticated policies; only service_role (server fns + provisioning) can
-- access. See specs/001-sdr-integration/data-model.md.
create table if not exists public.workspace_sdr (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  sdr_workspace_id text not null,
  encrypted_api_key text not null,
  webhook_secret text,
  sdr_base_url text not null,
  status text not null default 'provisioning',
  last_provisioned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id)
);

alter table public.workspace_sdr enable row level security;

-- Intentionally NO policies for authenticated/anon: service_role bypasses RLS.
grant all on public.workspace_sdr to service_role;

-- ═══ 20260809000002_add_content_publications.sql ═══
-- content_publications — webhook-driven per-destination delivery mirror (FR-010).
-- Written only by the webhook receiver / server fns (service_role); workspace
-- members may SELECT their own rows. UNIQUE(content_item_id, sdr_target_id) makes
-- webhook application idempotent (FR-021). See data-model.md.
create table if not exists public.content_publications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  sdr_post_id text not null,
  sdr_target_id text not null,
  platform text not null,
  account_id text not null,
  status text not null default 'pending',
  platform_post_id text,
  platform_post_url text,
  error_category text,
  last_error text,
  attempt int not null default 0,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (content_item_id, sdr_target_id)
);

alter table public.content_publications enable row level security;

create policy "publications_select_members"
  on public.content_publications for select
  using (public.is_workspace_member(workspace_id, auth.uid()));

grant select on public.content_publications to authenticated;
grant all on public.content_publications to service_role;

create index publications_content_item_idx on public.content_publications(content_item_id);
create index publications_ws_status_idx on public.content_publications(workspace_id, status);
create index publications_platform_idx on public.content_publications(platform);

-- ═══ 20260809000003_publishing_status_doc.sql ═══
-- content_items.status is a plain TEXT column (NOT a Postgres enum). The
-- 'publishing' value is valid app-side (content.functions.ts StatusEnum, added in
-- US2). This migration only keeps the schema documentation accurate.
comment on column public.content_items.status is
  'draft | pending | approved | rejected | scheduled | publishing | published';

-- ═══ 20260810000001_add_publications_perf_indexes.sql ═══
-- T075 — performance indexes for content_publications hot paths.
--
-- The webhook receiver resolves every delivery row by (sdr_post_id, sdr_target_id)
-- BEFORE verifying the signature (contracts/sdr-webhook.md); the reconcile sweep
-- scans status + updated_at globally. Neither was served by an index, so both ran
-- table scans as content_publications grows. Additive only; no schema change.

create index if not exists publications_sdr_lookup_idx
  on public.content_publications(sdr_post_id, sdr_target_id);

create index if not exists publications_reconcile_idx
  on public.content_publications(status, updated_at);

-- ═══ 20260903000000_disable_legacy_competitor_watch_cron.sql ═══
-- Disable the unsafe legacy competitor-watch job if it exists.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'competitor-watch-scan') THEN
    PERFORM cron.unschedule('competitor-watch-scan');
  END IF;
END $$;

-- ═══ 20260907120000_create_conversations.sql ═══
-- Persistent chat threads. Messages belong to a conversation, not directly to a workspace.
CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  title text NOT NULL DEFAULT 'New chat',
  preview text,
  summary text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_pinned boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES public.conversations(id) ON DELETE CASCADE;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'completed' CHECK (status IN ('sending', 'streaming', 'completed', 'failed', 'cancelled'));
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Preserve legacy history by placing each workspace's existing messages in one thread.
DO $$
DECLARE
  ws record;
  thread_id uuid;
BEGIN
  FOR ws IN SELECT DISTINCT workspace_id FROM public.chat_messages WHERE conversation_id IS NULL LOOP
    INSERT INTO public.conversations (workspace_id, title, created_at, updated_at)
    SELECT ws.workspace_id, 'Previous chat', COALESCE(min(created_at), now()), COALESCE(max(created_at), now())
    FROM public.chat_messages WHERE workspace_id = ws.workspace_id AND conversation_id IS NULL
    RETURNING id INTO thread_id;
    UPDATE public.chat_messages SET conversation_id = thread_id WHERE workspace_id = ws.workspace_id AND conversation_id IS NULL;
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS conversations_workspace_updated_idx
  ON public.conversations(workspace_id, is_pinned DESC, updated_at DESC)
  WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS conversations_workspace_search_idx
  ON public.conversations(workspace_id, title, preview);
CREATE INDEX IF NOT EXISTS chat_messages_conversation_created_idx
  ON public.chat_messages(conversation_id, created_at);

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations TO authenticated;
GRANT ALL ON public.conversations TO service_role;

DROP POLICY IF EXISTS conversations_select_members ON public.conversations;
CREATE POLICY conversations_select_members ON public.conversations FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));
DROP POLICY IF EXISTS conversations_insert_members ON public.conversations;
CREATE POLICY conversations_insert_members ON public.conversations FOR INSERT TO authenticated
  WITH CHECK (private.is_workspace_member(workspace_id, auth.uid()) AND (created_by IS NULL OR created_by = auth.uid()));
DROP POLICY IF EXISTS conversations_update_members ON public.conversations;
CREATE POLICY conversations_update_members ON public.conversations FOR UPDATE TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (private.is_workspace_member(workspace_id, auth.uid()));
DROP POLICY IF EXISTS conversations_delete_members ON public.conversations;
CREATE POLICY conversations_delete_members ON public.conversations FOR DELETE TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS chat_select_members ON public.chat_messages;
CREATE POLICY chat_select_members ON public.chat_messages FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));
DROP POLICY IF EXISTS chat_insert_members ON public.chat_messages;
CREATE POLICY chat_insert_members ON public.chat_messages FOR INSERT TO authenticated
  WITH CHECK (
    public.is_workspace_member(workspace_id, auth.uid())
    AND (user_id IS NULL OR user_id = auth.uid())
    AND (conversation_id IS NULL OR EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id AND c.workspace_id = chat_messages.workspace_id
      AND public.is_workspace_member(c.workspace_id, auth.uid())
    ))
  );
DROP POLICY IF EXISTS chat_no_update ON public.chat_messages;
CREATE POLICY chat_update_own_members ON public.chat_messages FOR UPDATE TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
DROP POLICY IF EXISTS chat_no_delete ON public.chat_messages;
CREATE POLICY chat_delete_members ON public.chat_messages FOR DELETE TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));

CREATE OR REPLACE FUNCTION public.touch_conversation_from_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.conversation_id IS NOT NULL THEN
    UPDATE public.conversations
    SET updated_at = GREATEST(updated_at, NEW.created_at),
        preview = CASE WHEN NEW.role = 'user' THEN left(NEW.content, 180) ELSE preview END
    WHERE id = NEW.conversation_id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS chat_message_touches_conversation ON public.chat_messages;
CREATE TRIGGER chat_message_touches_conversation
  AFTER INSERT ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.touch_conversation_from_message();

-- ═══ 20260907150000_enforce_content_lifecycle.sql ═══
-- Keep the content lifecycle authoritative even for callers that write through
-- Supabase directly instead of the typed server functions.
CREATE OR REPLACE FUNCTION public.enforce_content_item_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'approved'
     AND (
       OLD.title IS DISTINCT FROM NEW.title OR
       OLD.body IS DISTINCT FROM NEW.body OR
       OLD.hashtags IS DISTINCT FROM NEW.hashtags OR
       OLD.channel IS DISTINCT FROM NEW.channel OR
       OLD.media_url IS DISTINCT FROM NEW.media_url OR
       OLD.meta IS DISTINCT FROM NEW.meta
     )
  THEN
    NEW.status := 'draft';
  END IF;

  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.status = 'draft' AND NEW.status IN ('pending', 'approved')) OR
    (OLD.status = 'pending' AND NEW.status IN ('draft', 'approved', 'rejected', 'failed')) OR
    (OLD.status = 'approved' AND NEW.status IN ('draft', 'scheduled', 'publishing', 'published')) OR
    (OLD.status = 'rejected' AND NEW.status IN ('draft', 'pending')) OR
    (OLD.status = 'scheduled' AND NEW.status IN ('approved', 'draft', 'publishing', 'failed')) OR
    (OLD.status = 'publishing' AND NEW.status IN ('published', 'partial_failed', 'failed')) OR
    (OLD.status = 'published' AND NEW.status = 'draft') OR
    (OLD.status = 'failed' AND NEW.status IN ('draft', 'pending', 'approved')) OR
    (OLD.status = 'partial_failed' AND NEW.status IN ('approved', 'scheduled', 'draft'))
  ) THEN
    RAISE EXCEPTION 'Invalid content status transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_content_item_lifecycle ON public.content_items;
CREATE TRIGGER enforce_content_item_lifecycle
  BEFORE UPDATE ON public.content_items
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_content_item_lifecycle();

-- ═══ 20260910010000_create_persistent_assets.sql ═══
-- Durable generated asset metadata. Binary content lives in Supabase Storage.
CREATE TABLE IF NOT EXISTS public.assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  content_item_id uuid REFERENCES public.content_items(id) ON DELETE SET NULL,
  parent_asset_id uuid REFERENCES public.assets(id) ON DELETE SET NULL,
  generation_id text NOT NULL,
  idempotency_key text NOT NULL,
  asset_type text NOT NULL DEFAULT 'image',
  status text NOT NULL DEFAULT 'draft',
  storage_path text,
  thumbnail_path text,
  public_url text,
  filename text NOT NULL,
  mime_type text NOT NULL DEFAULT 'application/octet-stream',
  width integer,
  height integer,
  platform text,
  provider text,
  model text,
  model_route text,
  prompt_version text,
  creative_brief_version text,
  brand_dna_version text,
  attempt integer NOT NULL DEFAULT 1,
  seed text,
  qa_score numeric,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT assets_idempotency_key_unique UNIQUE (workspace_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS assets_workspace_created_idx ON public.assets(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS assets_workspace_status_idx ON public.assets(workspace_id, status);
CREATE INDEX IF NOT EXISTS assets_content_item_idx ON public.assets(content_item_id);

ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assets TO authenticated;
GRANT ALL ON public.assets TO service_role;

CREATE POLICY "Workspace members can read assets"
  ON public.assets FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "Workspace members can create assets"
  ON public.assets FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "Workspace members can update assets"
  ON public.assets FOR UPDATE TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "Workspace members can delete assets"
  ON public.assets FOR DELETE TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));

CREATE TRIGGER assets_touch_updated_at
  BEFORE UPDATE ON public.assets
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('generated-assets', 'generated-assets', true, 52428800)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit;

CREATE POLICY "Workspace members can read generated assets"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'generated-assets'
    AND (storage.foldername(name))[1] = 'workspace'
    AND public.is_workspace_member((storage.foldername(name))[2]::uuid, auth.uid())
  );
CREATE POLICY "Workspace members can upload generated assets"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'generated-assets'
    AND (storage.foldername(name))[1] = 'workspace'
    AND public.is_workspace_member((storage.foldername(name))[2]::uuid, auth.uid())
  );
CREATE POLICY "Workspace members can update generated assets"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'generated-assets'
    AND (storage.foldername(name))[1] = 'workspace'
    AND public.is_workspace_member((storage.foldername(name))[2]::uuid, auth.uid())
  )
  WITH CHECK (
    bucket_id = 'generated-assets'
    AND (storage.foldername(name))[1] = 'workspace'
    AND public.is_workspace_member((storage.foldername(name))[2]::uuid, auth.uid())
  );
CREATE POLICY "Workspace members can delete generated assets"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'generated-assets'
    AND (storage.foldername(name))[1] = 'workspace'
    AND public.is_workspace_member((storage.foldername(name))[2]::uuid, auth.uid())
  );

-- ═══ 20260910020000_harden_generated_asset_storage.sql ═══
-- Generated media is tenant-private. Durable references remain storage paths;
-- callers must request short-lived signed URLs from trusted server routes.
UPDATE storage.buckets
SET public = false,
    file_size_limit = 52428800
WHERE id = 'generated-assets';

CREATE OR REPLACE FUNCTION private.storage_workspace_id(path text)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = pg_catalog
AS $$
BEGIN
  IF path !~ '^workspace/[0-9a-fA-F-]{36}/assets/' THEN
    RETURN NULL;
  END IF;

  RETURN split_part(path, '/', 2)::uuid;
EXCEPTION
  WHEN invalid_text_representation THEN
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.storage_workspace_id(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.storage_workspace_id(text) TO authenticated, service_role;

DROP POLICY IF EXISTS "Workspace members can read generated assets" ON storage.objects;
DROP POLICY IF EXISTS "Workspace members can upload generated assets" ON storage.objects;
DROP POLICY IF EXISTS "Workspace members can update generated assets" ON storage.objects;
DROP POLICY IF EXISTS "Workspace members can delete generated assets" ON storage.objects;

CREATE POLICY "Workspace members can read generated assets"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'generated-assets'
    AND private.is_workspace_member(private.storage_workspace_id(name), auth.uid())
  );

CREATE POLICY "Workspace members can upload generated assets"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'generated-assets'
    AND private.is_workspace_member(private.storage_workspace_id(name), auth.uid())
  );

CREATE POLICY "Workspace members can update generated assets"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'generated-assets'
    AND private.is_workspace_member(private.storage_workspace_id(name), auth.uid())
  )
  WITH CHECK (
    bucket_id = 'generated-assets'
    AND private.is_workspace_member(private.storage_workspace_id(name), auth.uid())
  );

CREATE POLICY "Workspace members can delete generated assets"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'generated-assets'
    AND private.is_workspace_member(private.storage_workspace_id(name), auth.uid())
  );

-- ═══ 20260910030000_harden_client_share_secrets.sql ═══
-- Public share access is mediated by the server route, which verifies the
-- cryptographic token and optional password before reading share content.
-- Anonymous PostgREST access would expose token/password hashes.
REVOKE ALL ON TABLE public.client_shares FROM anon;
DROP POLICY IF EXISTS "shares_select_public" ON public.client_shares;

-- ═══ 20260910040000_protect_workspace_owner_membership.sql ═══
-- A workspace owner cannot remove the owner membership row by deleting their
-- own membership. Workspace deletion remains the explicit owner operation.
DROP POLICY IF EXISTS members_delete_by_owner_or_self ON public.workspace_members;

CREATE POLICY members_delete_by_owner_or_self
  ON public.workspace_members
  FOR DELETE TO authenticated
  USING (
    (
      user_id = auth.uid()
      AND role <> 'owner'::public.app_role
    )
    OR EXISTS (
      SELECT 1
      FROM public.workspaces w
      WHERE w.id = workspace_members.workspace_id
        AND w.owner_id = auth.uid()
        AND workspace_members.role <> 'owner'::public.app_role
    )
  );

-- ═══ 20260910050000_add_schedule_claim_leases.sql ═══
-- Prevent overlapping scheduler invocations from processing the same job.
-- A stale lease is reclaimable after the worker timeout in the application.
ALTER TABLE public.scheduled_jobs
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_by uuid;

CREATE INDEX IF NOT EXISTS scheduled_jobs_claim_idx
  ON public.scheduled_jobs (locked_at, next_run_at)
  WHERE active = true;

-- ═══ 20260910060000_lock_workspace_resource_ownership.sql ═══
-- Prevent authenticated callers from moving workspace resources or rewriting
-- their creator after the initial insert. Service-role workers are allowed to
-- maintain these fields because auth.uid() is NULL for service-role requests.
CREATE OR REPLACE FUNCTION private.prevent_workspace_resource_reassignment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND (
    NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR
    NEW.created_by IS DISTINCT FROM OLD.created_by
  ) THEN
    RAISE EXCEPTION 'workspace ownership fields are immutable'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.prevent_workspace_resource_reassignment() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.prevent_workspace_resource_reassignment() TO service_role;

DO $$
DECLARE
  resource_table text;
BEGIN
  FOREACH resource_table IN ARRAY ARRAY[
    'content_items', 'agent_runs', 'scheduled_jobs', 'geo_audit_runs',
    'memory_insights', 'competitor_watches'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', resource_table || '_ownership_guard', resource_table);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.prevent_workspace_resource_reassignment()',
      resource_table || '_ownership_guard', resource_table
    );
  END LOOP;
END $$;

DROP POLICY IF EXISTS "Members can insert content items" ON public.content_items;
CREATE POLICY "Members can insert content items"
  ON public.content_items FOR INSERT TO authenticated
  WITH CHECK (
    private.is_workspace_member(workspace_id, auth.uid())
    AND (created_by IS NULL OR created_by = auth.uid())
  );

DROP POLICY IF EXISTS "Members can insert agent runs" ON public.agent_runs;
CREATE POLICY "Members can insert agent runs"
  ON public.agent_runs FOR INSERT TO authenticated
  WITH CHECK (
    private.is_workspace_member(workspace_id, auth.uid())
    AND (created_by IS NULL OR created_by = auth.uid())
  );

DROP POLICY IF EXISTS "Members can insert scheduled jobs" ON public.scheduled_jobs;
CREATE POLICY "Members can insert scheduled jobs"
  ON public.scheduled_jobs FOR INSERT TO authenticated
  WITH CHECK (
    private.is_workspace_member(workspace_id, auth.uid())
    AND (created_by IS NULL OR created_by = auth.uid())
  );

DROP POLICY IF EXISTS "Workspace members insert geo_audit_runs" ON public.geo_audit_runs;
CREATE POLICY "Workspace members insert geo_audit_runs"
  ON public.geo_audit_runs FOR INSERT TO authenticated
  WITH CHECK (
    private.is_workspace_member(workspace_id, auth.uid())
    AND (created_by IS NULL OR created_by = auth.uid())
  );

DROP POLICY IF EXISTS "Workspace members write memory_insights" ON public.memory_insights;
CREATE POLICY "Workspace members write memory_insights"
  ON public.memory_insights FOR INSERT TO authenticated
  WITH CHECK (
    private.is_workspace_member(workspace_id, auth.uid())
    AND (created_by IS NULL OR created_by = auth.uid())
  );

DROP POLICY IF EXISTS "members insert watches" ON public.competitor_watches;
CREATE POLICY "members insert watches"
  ON public.competitor_watches FOR INSERT TO authenticated
  WITH CHECK (
    private.is_workspace_member(workspace_id, auth.uid())
    AND (created_by IS NULL OR created_by = auth.uid())
  );

-- ═══ 20260910070000_add_market_trend_collections.sql ═══
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

-- ═══ 20260910080000_add_market_intelligence_cache.sql ═══
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

-- ═══ 20260911000000_add_api_rate_limits.sql ═══
-- Fixed-window rate limiting for the metered AI endpoints.
--
-- Why Postgres and not an in-process Map: the app runs as a Railway standalone
-- Docker service that can scale to more than one instance, and module-level
-- counters reset on every deploy. A counter that a user can clear by waiting
-- for a redeploy is not a spend control. This table is the shared store.
--
-- Written ONLY by the service role (src/server/rate-limit.ts via supabaseAdmin).
-- No user-facing client ever reads or writes it.

CREATE TABLE IF NOT EXISTS public.api_rate_limits (
  bucket_key text NOT NULL,
  window_start timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket_key, window_start)
);

-- Supports the opportunistic sweep of expired windows below.
CREATE INDEX IF NOT EXISTS api_rate_limits_window_idx
  ON public.api_rate_limits(window_start);

ALTER TABLE public.api_rate_limits ENABLE ROW LEVEL SECURITY;

-- Deliberately no policies: RLS with zero policies denies every authenticated
-- and anonymous request. Only the service role (which bypasses RLS) can touch
-- it. Revoke the default grants so a future `GRANT ... TO authenticated` on the
-- schema cannot accidentally expose it.
REVOKE ALL ON public.api_rate_limits FROM anon, authenticated;

-- Atomically consume `p_cost` from a fixed window and report whether the caller
-- is still under the limit. One round trip, and the INSERT ... ON CONFLICT makes
-- concurrent requests from the same user serialize on the primary key rather
-- than racing a read-then-write.
--
-- The counter is incremented even when the request is denied. That is
-- intentional: a client that keeps hammering keeps its window pinned, so abuse
-- does not get a free retry the instant it crosses the threshold.
CREATE OR REPLACE FUNCTION public.consume_rate_limit(
  p_bucket_key text,
  p_window_seconds integer,
  p_limit integer,
  p_cost integer DEFAULT 1
)
RETURNS TABLE (allowed boolean, current_count integer, reset_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_window_start timestamptz;
  v_count integer;
BEGIN
  IF p_window_seconds IS NULL OR p_window_seconds <= 0 THEN
    RAISE EXCEPTION 'p_window_seconds must be positive';
  END IF;

  -- Truncate now() down to the start of its window.
  v_window_start := to_timestamp(
    floor(extract(epoch FROM now()) / p_window_seconds) * p_window_seconds
  );

  INSERT INTO public.api_rate_limits AS l (bucket_key, window_start, request_count, updated_at)
  VALUES (p_bucket_key, v_window_start, GREATEST(p_cost, 0), now())
  ON CONFLICT (bucket_key, window_start)
  DO UPDATE SET
    request_count = l.request_count + GREATEST(p_cost, 0),
    updated_at = now()
  RETURNING l.request_count INTO v_count;

  -- Opportunistic GC (~1 call in 1000) so expired windows do not accumulate.
  -- Cheaper than a dedicated cron row and self-healing under any traffic level.
  IF random() < 0.001 THEN
    DELETE FROM public.api_rate_limits
    WHERE window_start < now() - interval '1 day';
  END IF;

  RETURN QUERY SELECT
    v_count <= p_limit,
    v_count,
    v_window_start + make_interval(secs => p_window_seconds);
END;
$$;

REVOKE ALL ON FUNCTION public.consume_rate_limit(text, integer, integer, integer)
  FROM anon, authenticated, public;

-- ═══ 20260911000100_add_app_hook_caller.sql ═══
-- Shared caller for the app's cron hooks.
--
-- Background: the original competitor-watch job (20260709194553) hardcoded a
-- stale deployment URL and sent an `apikey` header, but every hook in
-- src/app/api/public/hooks/* requires `x-cron-secret` == CRON_SECRET. That job
-- was unscheduled in 20260903000000 and never replaced, so nothing currently
-- drives scheduled publishing, Market Brain collection, competitor scans or SDR
-- reconciliation. See supabase/ENABLE-CRON-JOBS.sql to turn them on.
--
-- This migration only creates the caller. It schedules nothing and is safe to
-- apply in every environment: without the Vault entries the function raises a
-- clear error, and nothing invokes it until a cron job is scheduled.
--
-- Reading the base URL and secret from Vault at call time means:
--   * no deployment URL or secret is ever written into migration SQL,
--   * rotating CRON_SECRET is a Vault update, not a re-schedule,
--   * the same migration works in dev, staging and production.

-- [pglite] extension provided by stubs

-- [pglite] extension provided by stubs


CREATE OR REPLACE FUNCTION public.call_app_hook(p_path text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, net, pg_temp
AS $$
DECLARE
  v_base_url text;
  v_secret text;
BEGIN
  IF p_path IS NULL OR left(p_path, 1) <> '/' THEN
    RAISE EXCEPTION 'p_path must be an absolute path beginning with "/", got: %', p_path;
  END IF;

  SELECT decrypted_secret INTO v_base_url
  FROM vault.decrypted_secrets
  WHERE name = 'mellox_app_base_url';

  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'mellox_cron_secret';

  IF v_base_url IS NULL OR v_base_url = '' THEN
    RAISE EXCEPTION
      'Vault secret "mellox_app_base_url" is not set. See supabase/ENABLE-CRON-JOBS.sql';
  END IF;

  -- Mirrors the app-side guard: the hooks return 503 for a secret under 16
  -- chars, so fail loudly here rather than scheduling doomed requests.
  IF v_secret IS NULL OR length(v_secret) < 16 THEN
    RAISE EXCEPTION
      'Vault secret "mellox_cron_secret" is missing or shorter than 16 characters. See supabase/ENABLE-CRON-JOBS.sql';
  END IF;

  RETURN net.http_post(
    url := rtrim(v_base_url, '/') || p_path,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
END;
$$;

-- Cron runs as the table owner; no application role should be able to make the
-- database issue authenticated requests to the app on its behalf.
REVOKE ALL ON FUNCTION public.call_app_hook(text) FROM anon, authenticated, public;

-- ═══ 20260911090000_add_market_brain_production_schema.sql ═══
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

-- ═══ 20260911120000_add_sdr_webhook_events.sql ═══
-- Receipt log for the SDR → app webhook (src/app/api/public/hooks/sdr).
--
-- One row per callback — verified, rejected (bad signature), stale (replay
-- outside the tolerance window), unknown or malformed — and never the body.
-- It is the security signal the audit asked for (F-SEC-001 follow-up) and an
-- input to the Distribution Reliability Worker (rejection spikes, silence).
-- Rows are pruned after 30 days by public.prune_operational_logs().

CREATE TABLE IF NOT EXISTS public.sdr_webhook_events (
  id bigserial PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT now(),
  event text,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  outcome text NOT NULL
    CHECK (outcome IN ('verified', 'rejected', 'stale', 'unknown', 'malformed')),
  reason text NOT NULL DEFAULT '',
  sdr_post_id text,
  sdr_target_id text,
  account_id text
);

CREATE INDEX IF NOT EXISTS sdr_webhook_events_workspace_idx
  ON public.sdr_webhook_events (workspace_id, received_at DESC);
CREATE INDEX IF NOT EXISTS sdr_webhook_events_outcome_idx
  ON public.sdr_webhook_events (outcome, received_at DESC);

ALTER TABLE public.sdr_webhook_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.sdr_webhook_events FROM anon, authenticated;
GRANT SELECT ON public.sdr_webhook_events TO authenticated;
GRANT ALL ON public.sdr_webhook_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.sdr_webhook_events_id_seq TO service_role;

DROP POLICY IF EXISTS "Members read their webhook receipts" ON public.sdr_webhook_events;
CREATE POLICY "Members read their webhook receipts" ON public.sdr_webhook_events
  FOR SELECT TO authenticated
  USING (workspace_id IS NOT NULL AND private.is_workspace_member(workspace_id, auth.uid()));

-- ═══ 20260911120100_add_ai_usage_metering.sql ═══
-- AI usage metering (proposal workstream B).
--
-- Every paid provider call — OpenRouter, Anthropic, KIE image/video,
-- DataForSEO — records one ai_usage_events row: who (workspace, user), where
-- (route), what (provider, model, kind), how much (tokens / units, estimated
-- USD) and how it went (cached, truncated, status, latency). ai_usage_daily is
-- the rollup budgets and dashboards read; public.record_ai_usage() writes both
-- atomically so the rollup can never drift from the events.
--
-- Scope keys in the rollup: 'ws:<uuid>' for workspace-attributed spend and
-- 'user:<uuid>' for every call a user makes (per-user ceilings apply even when
-- no workspace is attributed).

CREATE TABLE IF NOT EXISTS public.ai_usage_events (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  route text NOT NULL,
  provider text NOT NULL,
  model text NOT NULL,
  kind text NOT NULL DEFAULT 'text'
    CHECK (kind IN ('text', 'image', 'video', 'search', 'moderation')),
  input_tokens integer NOT NULL DEFAULT 0,
  output_tokens integer NOT NULL DEFAULT 0,
  units integer NOT NULL DEFAULT 0,
  cached boolean NOT NULL DEFAULT false,
  truncated boolean NOT NULL DEFAULT false,
  est_cost_usd numeric(12, 6) NOT NULL DEFAULT 0,
  saved_usd numeric(12, 6) NOT NULL DEFAULT 0,
  latency_ms integer,
  status text NOT NULL DEFAULT 'ok'
    CHECK (status IN ('ok', 'error', 'blocked', 'degraded')),
  run_id uuid,
  request_id text
);

CREATE INDEX IF NOT EXISTS ai_usage_events_workspace_idx
  ON public.ai_usage_events (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_events_user_idx
  ON public.ai_usage_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_events_created_idx
  ON public.ai_usage_events (created_at DESC);

CREATE TABLE IF NOT EXISTS public.ai_usage_daily (
  day date NOT NULL,
  scope_key text NOT NULL,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  calls integer NOT NULL DEFAULT 0,
  cached_calls integer NOT NULL DEFAULT 0,
  truncated_calls integer NOT NULL DEFAULT 0,
  error_calls integer NOT NULL DEFAULT 0,
  input_tokens bigint NOT NULL DEFAULT 0,
  output_tokens bigint NOT NULL DEFAULT 0,
  images integer NOT NULL DEFAULT 0,
  videos integer NOT NULL DEFAULT 0,
  cost_usd numeric(14, 6) NOT NULL DEFAULT 0,
  saved_usd numeric(14, 6) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (day, scope_key)
);

CREATE INDEX IF NOT EXISTS ai_usage_daily_workspace_idx
  ON public.ai_usage_daily (workspace_id, day DESC);

ALTER TABLE public.ai_usage_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_usage_daily ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.ai_usage_events FROM anon, authenticated;
REVOKE ALL ON public.ai_usage_daily FROM anon, authenticated;
GRANT SELECT ON public.ai_usage_events, public.ai_usage_daily TO authenticated;
GRANT ALL ON public.ai_usage_events, public.ai_usage_daily TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.ai_usage_events_id_seq TO service_role;

DROP POLICY IF EXISTS "Members read workspace AI usage" ON public.ai_usage_events;
CREATE POLICY "Members read workspace AI usage" ON public.ai_usage_events
  FOR SELECT TO authenticated
  USING (
    (workspace_id IS NOT NULL AND private.is_workspace_member(workspace_id, auth.uid()))
    OR (workspace_id IS NULL AND user_id = auth.uid())
  );

DROP POLICY IF EXISTS "Members read workspace AI usage rollup" ON public.ai_usage_daily;
CREATE POLICY "Members read workspace AI usage rollup" ON public.ai_usage_daily
  FOR SELECT TO authenticated
  USING (
    (workspace_id IS NOT NULL AND private.is_workspace_member(workspace_id, auth.uid()))
    OR (workspace_id IS NULL AND user_id = auth.uid())
  );

-- Insert one event and fold it into the daily rollup(s), atomically.
CREATE OR REPLACE FUNCTION public.record_ai_usage(p_event jsonb)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id bigint;
  v_ws uuid := nullif(p_event ->> 'workspace_id', '')::uuid;
  v_user uuid := nullif(p_event ->> 'user_id', '')::uuid;
  v_kind text := coalesce(p_event ->> 'kind', 'text');
  v_cached boolean := coalesce((p_event ->> 'cached')::boolean, false);
  v_truncated boolean := coalesce((p_event ->> 'truncated')::boolean, false);
  v_status text := coalesce(p_event ->> 'status', 'ok');
  v_in integer := coalesce((p_event ->> 'input_tokens')::integer, 0);
  v_out integer := coalesce((p_event ->> 'output_tokens')::integer, 0);
  v_units integer := coalesce((p_event ->> 'units')::integer, 0);
  v_cost numeric := coalesce((p_event ->> 'est_cost_usd')::numeric, 0);
  v_saved numeric := coalesce((p_event ->> 'saved_usd')::numeric, 0);
  v_day date := (now() AT TIME ZONE 'utc')::date;
  v_scope text;
BEGIN
  INSERT INTO public.ai_usage_events (
    workspace_id, user_id, route, provider, model, kind, input_tokens,
    output_tokens, units, cached, truncated, est_cost_usd, saved_usd,
    latency_ms, status, run_id, request_id
  ) VALUES (
    v_ws, v_user,
    coalesce(p_event ->> 'route', 'unknown'),
    coalesce(p_event ->> 'provider', 'unknown'),
    coalesce(p_event ->> 'model', 'unknown'),
    v_kind, v_in, v_out, v_units, v_cached, v_truncated, v_cost, v_saved,
    nullif(p_event ->> 'latency_ms', '')::integer,
    v_status,
    nullif(p_event ->> 'run_id', '')::uuid,
    p_event ->> 'request_id'
  )
  RETURNING id INTO v_id;

  FOREACH v_scope IN ARRAY ARRAY[
    CASE WHEN v_ws IS NOT NULL THEN 'ws:' || v_ws::text END,
    CASE WHEN v_user IS NOT NULL THEN 'user:' || v_user::text END
  ] LOOP
    CONTINUE WHEN v_scope IS NULL;
    INSERT INTO public.ai_usage_daily AS d (
      day, scope_key, workspace_id, user_id, calls, cached_calls,
      truncated_calls, error_calls, input_tokens, output_tokens, images,
      videos, cost_usd, saved_usd, updated_at
    ) VALUES (
      v_day, v_scope,
      CASE WHEN v_scope LIKE 'ws:%' THEN v_ws END,
      CASE WHEN v_scope LIKE 'user:%' THEN v_user END,
      1,
      CASE WHEN v_cached THEN 1 ELSE 0 END,
      CASE WHEN v_truncated THEN 1 ELSE 0 END,
      CASE WHEN v_status = 'error' THEN 1 ELSE 0 END,
      v_in, v_out,
      CASE WHEN v_kind = 'image' THEN greatest(v_units, 1) ELSE 0 END,
      CASE WHEN v_kind = 'video' THEN greatest(v_units, 1) ELSE 0 END,
      v_cost, v_saved, now()
    )
    ON CONFLICT (day, scope_key) DO UPDATE SET
      calls = d.calls + 1,
      cached_calls = d.cached_calls + excluded.cached_calls,
      truncated_calls = d.truncated_calls + excluded.truncated_calls,
      error_calls = d.error_calls + excluded.error_calls,
      input_tokens = d.input_tokens + excluded.input_tokens,
      output_tokens = d.output_tokens + excluded.output_tokens,
      images = d.images + excluded.images,
      videos = d.videos + excluded.videos,
      cost_usd = d.cost_usd + excluded.cost_usd,
      saved_usd = d.saved_usd + excluded.saved_usd,
      updated_at = now();
  END LOOP;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_ai_usage(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_ai_usage(jsonb) TO service_role;

-- Today + this-month totals for one scope ("ws:<uuid>" or "user:<uuid>"), in
-- one round trip. Service role only; the budget module calls it before metered
-- requests (and caches the answer briefly).
CREATE OR REPLACE FUNCTION public.ai_usage_summary(p_scope_key text)
RETURNS TABLE (
  today_cost_usd numeric,
  month_cost_usd numeric,
  month_images bigint,
  month_videos bigint,
  month_calls bigint,
  month_cached_calls bigint,
  month_saved_usd numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(sum(cost_usd) FILTER (WHERE day = (now() AT TIME ZONE 'utc')::date), 0),
         coalesce(sum(cost_usd), 0),
         coalesce(sum(images), 0),
         coalesce(sum(videos), 0),
         coalesce(sum(calls), 0),
         coalesce(sum(cached_calls), 0),
         coalesce(sum(saved_usd), 0)
    FROM public.ai_usage_daily
   WHERE scope_key = p_scope_key
     AND day >= date_trunc('month', now() AT TIME ZONE 'utc')::date;
$$;

REVOKE ALL ON FUNCTION public.ai_usage_summary(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_usage_summary(text) TO service_role;

-- ═══ 20260911120200_add_guardrail_events.sql ═══
-- Guardrail event log (proposal workstream D): what was blocked, flagged or
-- repaired, why, and for which workspace. `detail` carries short snippets and
-- rule ids only — never whole prompts, outputs, or personal data.

CREATE TABLE IF NOT EXISTS public.guardrail_events (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  route text NOT NULL DEFAULT 'unknown',
  kind text NOT NULL CHECK (kind IN (
    'injection_detected',
    'untrusted_content_sanitized',
    'pii_redacted',
    'profanity',
    'claim_flagged',
    'brand_rule_violation',
    'moderation_blocked',
    'moderation_unverified',
    'parse_failure',
    'truncation',
    'action_blocked',
    'budget_degraded',
    'budget_exceeded'
  )),
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warn', 'block')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  run_id uuid,
  request_id text
);

CREATE INDEX IF NOT EXISTS guardrail_events_workspace_idx
  ON public.guardrail_events (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS guardrail_events_kind_idx
  ON public.guardrail_events (kind, created_at DESC);

ALTER TABLE public.guardrail_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.guardrail_events FROM anon, authenticated;
GRANT SELECT ON public.guardrail_events TO authenticated;
GRANT ALL ON public.guardrail_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.guardrail_events_id_seq TO service_role;

DROP POLICY IF EXISTS "Members read workspace guardrail events" ON public.guardrail_events;
CREATE POLICY "Members read workspace guardrail events" ON public.guardrail_events
  FOR SELECT TO authenticated
  USING (workspace_id IS NOT NULL AND private.is_workspace_member(workspace_id, auth.uid()));

-- ═══ 20260911120300_add_agent_control_plane.sql ═══
-- Agent control plane (audit §17–19, Stages 2–4): durable runs, per-step
-- audit, approval requests, findings, and the workspace kill switch.
--
-- The model may recommend; the platform validates, authorizes, executes,
-- persists and audits. Every row here is written by the server (service role)
-- through src/server/agents; members can READ their workspace's rows and make
-- decisions only through the authenticated, role-checked /api/agents routes.

-- ── agent_runs: extend the existing table into a durable run record ────────
ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS worker text,
  ADD COLUMN IF NOT EXISTS trigger text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS finished_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS model text,
  ADD COLUMN IF NOT EXISTS input_tokens integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS output_tokens integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_usd numeric(12, 6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS duration_ms integer,
  ADD COLUMN IF NOT EXISTS error text,
  ADD COLUMN IF NOT EXISTS budget jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS summary text,
  ADD COLUMN IF NOT EXISTS parent_run_id uuid REFERENCES public.agent_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS agent_runs_worker_idx
  ON public.agent_runs (workspace_id, worker, created_at DESC);

-- ── agent_run_steps: one row per tool call / model call / policy decision ──
CREATE TABLE IF NOT EXISTS public.agent_run_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('tool', 'model', 'policy', 'note')),
  tool text,
  tool_call_id text,
  redacted_args jsonb NOT NULL DEFAULT '{}'::jsonb,
  policy_decision text CHECK (policy_decision IN ('allow', 'require_approval', 'deny')),
  status text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'error', 'denied', 'pending_approval')),
  result_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  latency_ms integer,
  cost_usd numeric(12, 6) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, seq)
);

CREATE INDEX IF NOT EXISTS agent_run_steps_run_idx ON public.agent_run_steps (run_id, seq);

-- ── agent_action_requests: proposed side effects awaiting a human ──────────
CREATE TABLE IF NOT EXISTS public.agent_action_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  run_id uuid REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'worker' CHECK (source IN ('worker', 'chat', 'user')),
  tool text NOT NULL,
  args jsonb NOT NULL DEFAULT '{}'::jsonb,
  title text NOT NULL,
  preview jsonb NOT NULL DEFAULT '{}'::jsonb,
  affected_records jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'suggested'
    CHECK (status IN ('suggested', 'approved', 'rejected', 'executed', 'failed', 'expired')),
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  decision_reason text,
  executed_at timestamptz,
  result jsonb,
  error text,
  idempotency_key text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_action_requests_workspace_idx
  ON public.agent_action_requests (workspace_id, status, created_at DESC);

-- ── agent_findings: what a worker observed and recommends ──────────────────
CREATE TABLE IF NOT EXISTS public.agent_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  run_id uuid REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  worker text NOT NULL,
  fingerprint text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  title text NOT NULL,
  summary text NOT NULL DEFAULT '',
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  hypotheses jsonb NOT NULL DEFAULT '[]'::jsonb,
  affected jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommended_action text NOT NULL DEFAULT '',
  requires_human_approval boolean NOT NULL DEFAULT true,
  confidence numeric(4, 3) NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved')),
  occurrences integer NOT NULL DEFAULT 1,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One live finding per (workspace, fingerprint): a re-detection bumps
-- occurrences instead of flooding the inbox.
CREATE UNIQUE INDEX IF NOT EXISTS agent_findings_open_fingerprint_idx
  ON public.agent_findings (workspace_id, fingerprint)
  WHERE status <> 'resolved';
CREATE INDEX IF NOT EXISTS agent_findings_workspace_idx
  ON public.agent_findings (workspace_id, status, created_at DESC);

-- ── workspace_agent_settings: kill switch + per-worker enablement ──────────
CREATE TABLE IF NOT EXISTS public.workspace_agent_settings (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agents_paused boolean NOT NULL DEFAULT false,
  disabled_workers text[] NOT NULL DEFAULT '{}',
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── RLS: members read, only the service role writes ─────────────────────────
ALTER TABLE public.agent_run_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_action_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_agent_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.agent_run_steps, public.agent_action_requests,
  public.agent_findings, public.workspace_agent_settings FROM anon, authenticated;
GRANT SELECT ON public.agent_run_steps, public.agent_action_requests,
  public.agent_findings, public.workspace_agent_settings TO authenticated;
GRANT ALL ON public.agent_run_steps, public.agent_action_requests,
  public.agent_findings, public.workspace_agent_settings TO service_role;

DROP POLICY IF EXISTS "Members read run steps" ON public.agent_run_steps;
CREATE POLICY "Members read run steps" ON public.agent_run_steps
  FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Members read action requests" ON public.agent_action_requests;
CREATE POLICY "Members read action requests" ON public.agent_action_requests
  FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Members read findings" ON public.agent_findings;
CREATE POLICY "Members read findings" ON public.agent_findings
  FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Members read agent settings" ON public.workspace_agent_settings;
CREATE POLICY "Members read agent settings" ON public.workspace_agent_settings
  FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DO $$
BEGIN
  IF to_regprocedure('public.touch_updated_at()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS agent_runs_touch ON public.agent_runs;
    CREATE TRIGGER agent_runs_touch BEFORE UPDATE ON public.agent_runs
      FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
    DROP TRIGGER IF EXISTS agent_action_requests_touch ON public.agent_action_requests;
    CREATE TRIGGER agent_action_requests_touch BEFORE UPDATE ON public.agent_action_requests
      FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
    DROP TRIGGER IF EXISTS agent_findings_touch ON public.agent_findings;
    CREATE TRIGGER agent_findings_touch BEFORE UPDATE ON public.agent_findings
      FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
END
$$;

-- ═══ 20260911120400_add_cron_heartbeats_and_job_claims.sql ═══
-- Scheduler operability (proposal workstreams A + G).
--
-- 1. cron_heartbeats — every cron hook records start/success/failure. The
--    readiness probe (/api/health/ready) and the ops-watch job alert when a
--    job has not succeeded within 3× its expected interval ("a run was missed").
-- 2. claim_due_scheduled_jobs() — atomic lease claim with FOR UPDATE SKIP
--    LOCKED on the locked_at/locked_by columns added by 20260910050000 but never
--    used: a one-minute cron cadence with a 120 s hook timeout could otherwise
--    run the same scheduled job twice.
-- 3. prune_operational_logs() — retention for the operational log tables.

CREATE TABLE IF NOT EXISTS public.cron_heartbeats (
  job text PRIMARY KEY,
  expected_interval_seconds integer NOT NULL DEFAULT 60,
  last_started_at timestamptz,
  last_succeeded_at timestamptz,
  last_failed_at timestamptz,
  last_error text,
  last_duration_ms integer,
  last_result jsonb,
  run_count bigint NOT NULL DEFAULT 0,
  failure_count bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cron_heartbeats ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cron_heartbeats FROM anon, authenticated;
GRANT ALL ON public.cron_heartbeats TO service_role;

CREATE OR REPLACE FUNCTION public.claim_due_scheduled_jobs(
  p_max integer DEFAULT 25,
  p_lease_seconds integer DEFAULT 300,
  p_market_brain boolean DEFAULT false,
  p_job_id uuid DEFAULT NULL
)
RETURNS SETOF public.scheduled_jobs
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.scheduled_jobs AS s
     SET locked_at = now(),
         locked_by = gen_random_uuid()
   WHERE s.id IN (
     SELECT j.id
       FROM public.scheduled_jobs j
      WHERE j.active
        AND (CASE WHEN p_market_brain THEN j.task_type = 'market-brain'
                  ELSE j.task_type <> 'market-brain' END)
        AND (p_job_id IS NOT NULL OR j.next_run_at <= now())
        AND (p_job_id IS NULL OR j.id = p_job_id)
        AND (j.locked_at IS NULL OR j.locked_at < now() - make_interval(secs => p_lease_seconds))
      ORDER BY j.next_run_at
      LIMIT greatest(p_max, 0)
      FOR UPDATE SKIP LOCKED
   )
  RETURNING s.*;
$$;

REVOKE ALL ON FUNCTION public.claim_due_scheduled_jobs(integer, integer, boolean, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_due_scheduled_jobs(integer, integer, boolean, uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.prune_operational_logs()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_webhooks integer;
  v_guardrails integer;
  v_usage integer;
BEGIN
  DELETE FROM public.sdr_webhook_events WHERE received_at < now() - interval '30 days';
  GET DIAGNOSTICS v_webhooks = ROW_COUNT;
  DELETE FROM public.guardrail_events WHERE created_at < now() - interval '90 days';
  GET DIAGNOSTICS v_guardrails = ROW_COUNT;
  -- Raw events for 13 months; the daily rollup is kept indefinitely.
  DELETE FROM public.ai_usage_events WHERE created_at < now() - interval '13 months';
  GET DIAGNOSTICS v_usage = ROW_COUNT;
  RETURN jsonb_build_object(
    'sdr_webhook_events', v_webhooks,
    'guardrail_events', v_guardrails,
    'ai_usage_events', v_usage
  );
END;
$$;

REVOKE ALL ON FUNCTION public.prune_operational_logs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_operational_logs() TO service_role;

-- ═══ 20260911120500_revoke_private_schema_from_anon.sql ═══
-- 20260620101957 granted USAGE on schema private and EXECUTE on
-- private.is_workspace_member to anon. Later migrations only revoked FROM
-- PUBLIC, never FROM anon, so an anonymous caller could still probe workspace
-- membership by (workspace_id, user_id) pairs. Every policy that calls the
-- helper is scoped TO authenticated, so anon never needs it.
REVOKE EXECUTE ON FUNCTION private.is_workspace_member(uuid, uuid) FROM anon;
REVOKE USAGE ON SCHEMA private FROM anon;

-- ═══ 20260911120600_schedule_app_cron_jobs.sql ═══
-- Scheduler activation (proposal workstream A: "scheduled posts and competitor
-- monitoring wired and firing").
--
-- Idempotently (re)schedules every Mellox cron job through
-- public.call_app_hook(), which reads the app origin and CRON_SECRET from
-- Supabase Vault at call time — no URL or secret in committed SQL.
--
-- GUARDED: jobs are only scheduled once both Vault secrets exist. Pushing this
-- migration to a project whose secrets are not set yet schedules nothing (a
-- NOTICE says so) instead of creating jobs that fail every minute. After
-- setting the secrets, run supabase/ENABLE-CRON-JOBS.sql (same job list) or
-- re-run this file's DO block.

DO $$
DECLARE
  v_job record;
  v_ready boolean;
BEGIN
  IF to_regnamespace('cron') IS NULL OR to_regclass('vault.decrypted_secrets') IS NULL THEN
    RAISE NOTICE 'pg_cron or Vault unavailable — Mellox cron jobs not scheduled';
    RETURN;
  END IF;

  SELECT count(*) = 2 INTO v_ready
    FROM vault.decrypted_secrets
   WHERE name IN ('mellox_app_base_url', 'mellox_cron_secret')
     AND coalesce(decrypted_secret, '') <> '';

  IF NOT v_ready THEN
    RAISE NOTICE 'Vault secrets mellox_app_base_url / mellox_cron_secret not set — cron jobs not scheduled. See docs/OPERATIONS-RUNBOOK.md.';
    RETURN;
  END IF;

  FOR v_job IN
    SELECT * FROM (VALUES
      ('mellox-run-schedules',    '* * * * *',    '/api/public/hooks/run-schedules'),
      ('mellox-competitor-watch', '*/30 * * * *', '/api/public/hooks/competitor-watch'),
      ('mellox-sdr-reconcile',    '*/5 * * * *',  '/api/public/hooks/sdr-reconcile'),
      ('mellox-agents-tick',      '*/15 * * * *', '/api/public/hooks/agents-tick'),
      ('mellox-ops-watch',        '*/5 * * * *',  '/api/public/hooks/ops-watch')
    ) AS t(jobname, schedule, path)
  LOOP
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = v_job.jobname) THEN
      PERFORM cron.unschedule(v_job.jobname);
    END IF;
    PERFORM cron.schedule(
      v_job.jobname,
      v_job.schedule,
      format('SELECT public.call_app_hook(%L);', v_job.path)
    );
  END LOOP;
END
$$;
