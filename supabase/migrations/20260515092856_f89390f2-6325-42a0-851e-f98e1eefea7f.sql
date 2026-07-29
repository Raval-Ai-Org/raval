
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

-- Workspaces
CREATE TABLE public.workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'My Workspace',
  plan text NOT NULL DEFAULT 'starter',
  brand_voice jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

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

-- Membership check (security definer to avoid recursion)
CREATE OR REPLACE FUNCTION public.is_workspace_member(_workspace_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = _workspace_id AND user_id = _user_id
  );
$$;

CREATE POLICY "workspaces_select_members" ON public.workspaces FOR SELECT
  USING (public.is_workspace_member(id, auth.uid()));
CREATE POLICY "workspaces_insert_owner" ON public.workspaces FOR INSERT
  WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "workspaces_update_owner" ON public.workspaces FOR UPDATE
  USING (auth.uid() = owner_id);

CREATE POLICY "members_select_self_workspace" ON public.workspace_members FOR SELECT
  USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "members_insert_owner_self" ON public.workspace_members FOR INSERT
  WITH CHECK (auth.uid() = user_id);

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
CREATE POLICY "approvals_select_members" ON public.approvals FOR SELECT
  USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "approvals_insert_members" ON public.approvals FOR INSERT
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "approvals_update_members" ON public.approvals FOR UPDATE
  USING (public.is_workspace_member(workspace_id, auth.uid()));

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
CREATE POLICY "audit_select_members" ON public.audit_logs FOR SELECT
  USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "audit_insert_members" ON public.audit_logs FOR INSERT
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));

-- Auto create profile + personal workspace on signup
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

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
