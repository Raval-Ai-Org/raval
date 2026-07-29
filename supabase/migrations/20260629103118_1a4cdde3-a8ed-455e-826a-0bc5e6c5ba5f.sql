CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typnamespace = 'public'::regnamespace AND typname = 'app_role') THEN
    CREATE TYPE public.app_role AS ENUM ('owner','admin','editor','viewer');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typnamespace = 'public'::regnamespace AND typname = 'client_status') THEN
    CREATE TYPE public.client_status AS ENUM ('active','onboarding','paused');
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.workspaces (
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
  client_status public.client_status NOT NULL DEFAULT 'onboarding',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspaces TO authenticated;
GRANT ALL ON public.workspaces TO service_role;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.workspace_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL DEFAULT 'editor',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_members TO authenticated;
GRANT ALL ON public.workspace_members TO service_role;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION private.is_workspace_member(_workspace_id uuid, _user_id uuid)
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
REVOKE ALL ON FUNCTION private.is_workspace_member(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.is_workspace_member(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.touch_updated_at() TO service_role;

CREATE TABLE IF NOT EXISTS public.chat_messages (
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
CREATE INDEX IF NOT EXISTS chat_messages_workspace_created_idx ON public.chat_messages(workspace_id, created_at);

CREATE TABLE IF NOT EXISTS public.approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  action text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  decided_at timestamptz,
  content_item_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.approvals TO authenticated;
GRANT ALL ON public.approvals TO service_role;
ALTER TABLE public.approvals ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.audit_logs (
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

CREATE TABLE IF NOT EXISTS public.workspace_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'editor' CHECK (role IN ('admin','editor','viewer')),
  invited_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token uuid NOT NULL DEFAULT gen_random_uuid(),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, email)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_invites TO authenticated;
GRANT ALL ON public.workspace_invites TO service_role;
ALTER TABLE public.workspace_invites ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.content_items (
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
CREATE INDEX IF NOT EXISTS idx_content_items_workspace_status ON public.content_items(workspace_id, status);
CREATE INDEX IF NOT EXISTS idx_content_items_scheduled ON public.content_items(scheduled_at);

CREATE TABLE IF NOT EXISTS public.agent_runs (
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
CREATE INDEX IF NOT EXISTS idx_agent_runs_workspace_created ON public.agent_runs(workspace_id, created_at DESC);

ALTER TABLE public.approvals
  DROP CONSTRAINT IF EXISTS approvals_content_item_id_fkey,
  ADD CONSTRAINT approvals_content_item_id_fkey FOREIGN KEY (content_item_id) REFERENCES public.content_items(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_approvals_content_item ON public.approvals(content_item_id);

CREATE TABLE IF NOT EXISTS public.scheduled_jobs (
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
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scheduled_jobs TO authenticated;
GRANT ALL ON public.scheduled_jobs TO service_role;
ALTER TABLE public.scheduled_jobs ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_workspace ON public.scheduled_jobs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_due ON public.scheduled_jobs(next_run_at) WHERE active = true;

DROP TRIGGER IF EXISTS content_items_touch ON public.content_items;
CREATE TRIGGER content_items_touch BEFORE UPDATE ON public.content_items FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS touch_scheduled_jobs_updated ON public.scheduled_jobs;
CREATE TRIGGER touch_scheduled_jobs_updated BEFORE UPDATE ON public.scheduled_jobs FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_ws uuid;
  display_name text;
  avatar text;
BEGIN
  display_name := COALESCE(
    NEW.raw_user_meta_data->>'full_name',
    NEW.raw_user_meta_data->>'name',
    split_part(NEW.email, '@', 1),
    'New user'
  );
  avatar := COALESCE(NEW.raw_user_meta_data->>'avatar_url', NEW.raw_user_meta_data->>'picture');

  INSERT INTO public.profiles (id, name, avatar_url)
  VALUES (NEW.id, display_name, avatar)
  ON CONFLICT (id) DO UPDATE SET
    name = COALESCE(EXCLUDED.name, public.profiles.name),
    avatar_url = COALESCE(EXCLUDED.avatar_url, public.profiles.avatar_url);

  INSERT INTO public.workspaces (owner_id, name)
  VALUES (NEW.id, 'My Workspace')
  RETURNING id INTO new_ws;

  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (new_ws, NEW.id, 'owner')
  ON CONFLICT (workspace_id, user_id) DO NOTHING;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.create_missing_workspace_for_current_user()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ws uuid;
  v_email text := coalesce(auth.jwt()->>'email', '');
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT wm.workspace_id INTO v_ws
  FROM public.workspace_members wm
  WHERE wm.user_id = v_uid
  ORDER BY wm.created_at DESC
  LIMIT 1;

  IF v_ws IS NOT NULL THEN
    RETURN v_ws;
  END IF;

  INSERT INTO public.profiles (id, name)
  VALUES (v_uid, COALESCE(NULLIF(split_part(v_email, '@', 1), ''), 'New user'))
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.workspaces (owner_id, name)
  VALUES (v_uid, 'My Workspace')
  RETURNING id INTO v_ws;

  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (v_ws, v_uid, 'owner')
  ON CONFLICT (workspace_id, user_id) DO NOTHING;

  RETURN v_ws;
END;
$$;
REVOKE ALL ON FUNCTION public.create_missing_workspace_for_current_user() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_missing_workspace_for_current_user() TO authenticated, service_role;

DROP POLICY IF EXISTS profiles_select_own ON public.profiles;
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
DROP POLICY IF EXISTS profiles_insert_own ON public.profiles;
CREATE POLICY profiles_select_own ON public.profiles FOR SELECT TO authenticated USING (auth.uid() = id);
CREATE POLICY profiles_update_own ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY profiles_insert_own ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS workspaces_select_members ON public.workspaces;
DROP POLICY IF EXISTS workspaces_insert_owner ON public.workspaces;
DROP POLICY IF EXISTS workspaces_update_owner ON public.workspaces;
DROP POLICY IF EXISTS workspaces_delete_owner ON public.workspaces;
CREATE POLICY workspaces_select_members ON public.workspaces FOR SELECT TO authenticated USING (private.is_workspace_member(id, auth.uid()));
CREATE POLICY workspaces_insert_owner ON public.workspaces FOR INSERT TO authenticated WITH CHECK (auth.uid() = owner_id);
CREATE POLICY workspaces_update_owner ON public.workspaces FOR UPDATE TO authenticated USING (auth.uid() = owner_id) WITH CHECK (auth.uid() = owner_id);
CREATE POLICY workspaces_delete_owner ON public.workspaces FOR DELETE TO authenticated USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS members_select_self_workspace ON public.workspace_members;
DROP POLICY IF EXISTS members_insert_by_owner ON public.workspace_members;
DROP POLICY IF EXISTS members_update_by_owner ON public.workspace_members;
DROP POLICY IF EXISTS members_delete_by_owner_or_self ON public.workspace_members;
CREATE POLICY members_select_self_workspace ON public.workspace_members FOR SELECT TO authenticated USING (private.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY members_insert_by_owner ON public.workspace_members FOR INSERT TO authenticated WITH CHECK (role = ANY (ARRAY['admin'::public.app_role,'editor'::public.app_role,'viewer'::public.app_role]) AND EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_members.workspace_id AND w.owner_id = auth.uid()));
CREATE POLICY members_update_by_owner ON public.workspace_members FOR UPDATE TO authenticated USING (role <> 'owner'::public.app_role AND EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_members.workspace_id AND w.owner_id = auth.uid())) WITH CHECK (user_id <> auth.uid() AND role = ANY (ARRAY['admin'::public.app_role,'editor'::public.app_role,'viewer'::public.app_role]) AND EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_members.workspace_id AND w.owner_id = auth.uid()));
CREATE POLICY members_delete_by_owner_or_self ON public.workspace_members FOR DELETE TO authenticated USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_members.workspace_id AND w.owner_id = auth.uid()));

DROP POLICY IF EXISTS chat_select_members ON public.chat_messages;
DROP POLICY IF EXISTS chat_insert_members ON public.chat_messages;
DROP POLICY IF EXISTS chat_no_update ON public.chat_messages;
DROP POLICY IF EXISTS chat_no_delete ON public.chat_messages;
CREATE POLICY chat_select_members ON public.chat_messages FOR SELECT TO authenticated USING (private.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY chat_insert_members ON public.chat_messages FOR INSERT TO authenticated WITH CHECK (private.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY chat_no_update ON public.chat_messages FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY chat_no_delete ON public.chat_messages FOR DELETE TO authenticated USING (false);

DROP POLICY IF EXISTS approvals_select_members ON public.approvals;
DROP POLICY IF EXISTS approvals_insert_members ON public.approvals;
DROP POLICY IF EXISTS approvals_update_privileged ON public.approvals;
DROP POLICY IF EXISTS approvals_no_delete ON public.approvals;
CREATE POLICY approvals_select_members ON public.approvals FOR SELECT TO authenticated USING (private.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY approvals_insert_members ON public.approvals FOR INSERT TO authenticated WITH CHECK (private.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY approvals_update_privileged ON public.approvals FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = approvals.workspace_id AND wm.user_id = auth.uid() AND wm.role = ANY (ARRAY['owner'::public.app_role,'admin'::public.app_role]))) WITH CHECK (EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = approvals.workspace_id AND wm.user_id = auth.uid() AND wm.role = ANY (ARRAY['owner'::public.app_role,'admin'::public.app_role])));
CREATE POLICY approvals_no_delete ON public.approvals FOR DELETE TO authenticated USING (false);

DROP POLICY IF EXISTS audit_select_members ON public.audit_logs;
DROP POLICY IF EXISTS audit_no_client_insert ON public.audit_logs;
DROP POLICY IF EXISTS audit_no_client_delete ON public.audit_logs;
DROP POLICY IF EXISTS audit_logs_no_update ON public.audit_logs;
CREATE POLICY audit_select_members ON public.audit_logs FOR SELECT TO authenticated USING (private.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY audit_no_client_insert ON public.audit_logs FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY audit_no_client_delete ON public.audit_logs FOR DELETE TO authenticated USING (false);
CREATE POLICY audit_logs_no_update ON public.audit_logs FOR UPDATE TO authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS invites_select_owner ON public.workspace_invites;
DROP POLICY IF EXISTS invites_select_invitee ON public.workspace_invites;
DROP POLICY IF EXISTS invites_insert_owner ON public.workspace_invites;
DROP POLICY IF EXISTS invites_update_owner ON public.workspace_invites;
DROP POLICY IF EXISTS invites_delete_owner ON public.workspace_invites;
CREATE POLICY invites_select_owner ON public.workspace_invites FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_invites.workspace_id AND w.owner_id = auth.uid()));
CREATE POLICY invites_select_invitee ON public.workspace_invites FOR SELECT TO authenticated USING (lower(email) = lower(coalesce((auth.jwt() ->> 'email'), '')));
CREATE POLICY invites_insert_owner ON public.workspace_invites FOR INSERT TO authenticated WITH CHECK (role = ANY (ARRAY['admin'::text,'editor'::text,'viewer'::text]) AND EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_invites.workspace_id AND w.owner_id = auth.uid()));
CREATE POLICY invites_update_owner ON public.workspace_invites FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_invites.workspace_id AND w.owner_id = auth.uid())) WITH CHECK (role = ANY (ARRAY['admin'::text,'editor'::text,'viewer'::text]) AND EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_invites.workspace_id AND w.owner_id = auth.uid()));
CREATE POLICY invites_delete_owner ON public.workspace_invites FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_invites.workspace_id AND w.owner_id = auth.uid()));

DROP POLICY IF EXISTS "Members can view content items" ON public.content_items;
DROP POLICY IF EXISTS "Members can insert content items" ON public.content_items;
DROP POLICY IF EXISTS "Members can update content items" ON public.content_items;
DROP POLICY IF EXISTS "Members can delete content items" ON public.content_items;
CREATE POLICY "Members can view content items" ON public.content_items FOR SELECT TO authenticated USING (private.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "Members can insert content items" ON public.content_items FOR INSERT TO authenticated WITH CHECK (private.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "Members can update content items" ON public.content_items FOR UPDATE TO authenticated USING (private.is_workspace_member(workspace_id, auth.uid())) WITH CHECK (private.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "Members can delete content items" ON public.content_items FOR DELETE TO authenticated USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Members can view agent runs" ON public.agent_runs;
DROP POLICY IF EXISTS "Members can insert agent runs" ON public.agent_runs;
DROP POLICY IF EXISTS "No client updates to agent runs" ON public.agent_runs;
DROP POLICY IF EXISTS "No client deletes of agent runs" ON public.agent_runs;
CREATE POLICY "Members can view agent runs" ON public.agent_runs FOR SELECT TO authenticated USING (private.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "Members can insert agent runs" ON public.agent_runs FOR INSERT TO authenticated WITH CHECK (private.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "No client updates to agent runs" ON public.agent_runs FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY "No client deletes of agent runs" ON public.agent_runs FOR DELETE TO authenticated USING (false);

DROP POLICY IF EXISTS "Members can view scheduled jobs" ON public.scheduled_jobs;
DROP POLICY IF EXISTS "Members can insert scheduled jobs" ON public.scheduled_jobs;
DROP POLICY IF EXISTS "Members can update scheduled jobs" ON public.scheduled_jobs;
DROP POLICY IF EXISTS "Members can delete scheduled jobs" ON public.scheduled_jobs;
CREATE POLICY "Members can view scheduled jobs" ON public.scheduled_jobs FOR SELECT TO authenticated USING (private.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "Members can insert scheduled jobs" ON public.scheduled_jobs FOR INSERT TO authenticated WITH CHECK (private.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "Members can update scheduled jobs" ON public.scheduled_jobs FOR UPDATE TO authenticated USING (private.is_workspace_member(workspace_id, auth.uid())) WITH CHECK (private.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "Members can delete scheduled jobs" ON public.scheduled_jobs FOR DELETE TO authenticated USING (private.is_workspace_member(workspace_id, auth.uid()));