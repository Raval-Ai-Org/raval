
-- 1) Tighten workspace_invites SELECT to owners only
DROP POLICY IF EXISTS invites_select_members ON public.workspace_invites;
CREATE POLICY invites_select_owner ON public.workspace_invites
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.workspaces w
                 WHERE w.id = workspace_invites.workspace_id AND w.owner_id = auth.uid()));

-- 2) Explicit deny-update on audit_logs
DROP POLICY IF EXISTS audit_logs_no_update ON public.audit_logs;
CREATE POLICY audit_logs_no_update ON public.audit_logs
  FOR UPDATE TO authenticated
  USING (false) WITH CHECK (false);

-- 3) Revoke EXECUTE on SECURITY DEFINER functions from anon/public; grant to authenticated only
REVOKE ALL ON FUNCTION public.is_workspace_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_workspace_member(uuid, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.create_workspace(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_workspace(text, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.accept_workspace_invite(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_workspace_invite(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.workspace_member_profiles(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workspace_member_profiles(uuid) TO authenticated, service_role;

-- handle_new_user is a trigger function on auth.users; restrict execute to service_role only
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
