-- Roles enum
CREATE TYPE public.app_role AS ENUM ('owner','admin','editor','viewer');

-- Profiles
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name text,
  avatar_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_select_own" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "profiles_insert_own" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;

-- Workspaces
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
  client_status text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspaces TO authenticated;
GRANT ALL ON public.workspaces TO service_role;

-- Members
CREATE TABLE public.workspace_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL DEFAULT 'owner',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_members TO authenticated;
GRANT ALL ON public.workspace_members TO service_role;

CREATE OR REPLACE FUNCTION public.is_workspace_member(_workspace_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = _workspace_id AND user_id = _user_id
  );
$$;
REVOKE ALL ON FUNCTION public.is_workspace_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_workspace_member(uuid, uuid) TO authenticated;

CREATE POLICY "workspaces_select_members" ON public.workspaces FOR SELECT
  USING (public.is_workspace_member(id, auth.uid()));
CREATE POLICY "workspaces_insert_owner" ON public.workspaces FOR INSERT
  WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "workspaces_update_owner" ON public.workspaces FOR UPDATE
  USING (auth.uid() = owner_id);
CREATE POLICY "workspaces_delete_owner" ON public.workspaces FOR DELETE
  TO authenticated USING (auth.uid() = owner_id);

CREATE POLICY "members_select_self_workspace" ON public.workspace_members FOR SELECT
  USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "members_insert_by_owner" ON public.workspace_members FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_id AND w.owner_id = auth.uid()));
CREATE POLICY "members_update_by_owner" ON public.workspace_members FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_id AND w.owner_id = auth.uid()));
CREATE POLICY "members_delete_by_owner_or_self" ON public.workspace_members FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_id AND w.owner_id = auth.uid()));

-- Chat messages
CREATE TABLE public.chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant','system')),
  kind text NOT NULL DEFAULT 'text' CHECK (kind IN ('text','approval','progress','reminder')),
  content text NOT NULL DEFAULT '',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.chat_messages TO authenticated;
GRANT ALL ON public.chat_messages TO service_role;
CREATE POLICY "chat_select_members" ON public.chat_messages FOR SELECT
  USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "chat_insert_members" ON public.chat_messages FOR INSERT
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE INDEX chat_messages_workspace_created_idx ON public.chat_messages(workspace_id, created_at);

-- Approvals
CREATE TABLE public.approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  action text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.approvals ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.approvals TO authenticated;
GRANT ALL ON public.approvals TO service_role;
CREATE POLICY "approvals_select_members" ON public.approvals FOR SELECT
  USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "approvals_insert_members" ON public.approvals FOR INSERT
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "approvals_update_members" ON public.approvals FOR UPDATE
  USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "approvals_no_delete" ON public.approvals FOR DELETE TO authenticated, anon USING (false);

-- Audit logs
CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
CREATE POLICY "audit_select_members" ON public.audit_logs FOR SELECT
  USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "audit_no_client_insert" ON public.audit_logs FOR INSERT TO authenticated, anon WITH CHECK (false);
CREATE POLICY "audit_no_client_delete" ON public.audit_logs FOR DELETE TO authenticated, anon USING (false);

-- Content items
CREATE TABLE public.content_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  title text,
  body text,
  channel text,
  status text NOT NULL DEFAULT 'draft',
  hashtags jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  scheduled_for timestamptz,
  published_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.content_items ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_items TO authenticated;
GRANT ALL ON public.content_items TO service_role;
CREATE POLICY "content_all_members" ON public.content_items FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE INDEX content_items_ws_created_idx ON public.content_items(workspace_id, created_at DESC);

-- Workspace invites
CREATE TABLE public.workspace_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  email text,
  role public.app_role NOT NULL DEFAULT 'viewer',
  token text NOT NULL UNIQUE,
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.workspace_invites ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_invites TO authenticated;
GRANT ALL ON public.workspace_invites TO service_role;
CREATE POLICY "invites_select_owner" ON public.workspace_invites FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_id AND w.owner_id = auth.uid()));
CREATE POLICY "invites_insert_owner" ON public.workspace_invites FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_id AND w.owner_id = auth.uid()));
CREATE POLICY "invites_update_owner" ON public.workspace_invites FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_id AND w.owner_id = auth.uid()));

-- Client shares
CREATE TABLE public.client_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  slug text NOT NULL UNIQUE,
  title text,
  content_ids uuid[] NOT NULL DEFAULT '{}',
  expires_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.client_shares ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_shares TO authenticated;
GRANT SELECT ON public.client_shares TO anon;
GRANT ALL ON public.client_shares TO service_role;
CREATE POLICY "shares_all_members" ON public.client_shares FOR ALL TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "shares_select_public" ON public.client_shares FOR SELECT TO anon USING (true);

-- Handle new user
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  new_ws uuid;
BEGIN
  INSERT INTO public.profiles (id, name, avatar_url)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email,'@',1)), NEW.raw_user_meta_data->>'avatar_url');

  INSERT INTO public.workspaces (owner_id, name)
  VALUES (NEW.id, 'My Workspace')
  RETURNING id INTO new_ws;

  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (new_ws, NEW.id, 'owner');

  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Create workspace RPC
CREATE OR REPLACE FUNCTION public.create_workspace(p_name text, p_website_url text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id  uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN RAISE EXCEPTION 'name required'; END IF;

  INSERT INTO public.workspaces (owner_id, name, website_url)
  VALUES (v_uid, btrim(p_name), NULLIF(btrim(p_website_url), ''))
  RETURNING id INTO v_id;

  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (v_id, v_uid, 'owner')
  ON CONFLICT (workspace_id, user_id) DO NOTHING;

  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.create_workspace(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_workspace(text, text) TO authenticated;
