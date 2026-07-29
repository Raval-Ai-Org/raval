
CREATE TABLE IF NOT EXISTS public.workspace_invites (
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

CREATE POLICY invites_select_members ON public.workspace_invites
  FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()) OR lower(email) = lower(coalesce((auth.jwt()->>'email'),'')));

CREATE POLICY invites_insert_owner ON public.workspace_invites
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_id AND w.owner_id = auth.uid()));

CREATE POLICY invites_update_owner ON public.workspace_invites
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_id AND w.owner_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_id AND w.owner_id = auth.uid()));

CREATE POLICY invites_delete_owner ON public.workspace_invites
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_id AND w.owner_id = auth.uid()));

CREATE OR REPLACE FUNCTION public.accept_workspace_invite(_token uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text := lower(coalesce((auth.jwt()->>'email'),''));
  v_inv RECORD;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO v_inv FROM public.workspace_invites WHERE token = _token LIMIT 1;
  IF v_inv IS NULL THEN RAISE EXCEPTION 'invite not found'; END IF;
  IF v_inv.accepted_at IS NOT NULL THEN RETURN v_inv.workspace_id; END IF;
  IF lower(v_inv.email) <> v_email THEN RAISE EXCEPTION 'invite email does not match'; END IF;

  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (v_inv.workspace_id, v_uid, v_inv.role::app_role)
  ON CONFLICT (workspace_id, user_id) DO NOTHING;

  UPDATE public.workspace_invites SET accepted_at = now() WHERE id = v_inv.id;
  RETURN v_inv.workspace_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.workspace_member_profiles(_workspace_id uuid)
RETURNS TABLE (user_id uuid, role text, name text, avatar_url text, joined_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT wm.user_id, wm.role::text, p.name, p.avatar_url, wm.created_at
  FROM public.workspace_members wm
  LEFT JOIN public.profiles p ON p.id = wm.user_id
  WHERE wm.workspace_id = _workspace_id
    AND public.is_workspace_member(_workspace_id, auth.uid());
$$;
