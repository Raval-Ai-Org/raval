-- 1) Lock down internal SECURITY DEFINER functions (not meant to be called by users directly)
REVOKE EXECUTE ON FUNCTION public.is_workspace_member(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- 2) Safer default role for workspace_members
ALTER TABLE public.workspace_members ALTER COLUMN role SET DEFAULT 'editor'::app_role;

-- 3) Let an invited user read their own pending invite (matched by email in JWT)
DROP POLICY IF EXISTS invites_select_invitee ON public.workspace_invites;
CREATE POLICY invites_select_invitee ON public.workspace_invites
  FOR SELECT TO authenticated
  USING (lower(email) = lower(coalesce((auth.jwt() ->> 'email'), '')));
