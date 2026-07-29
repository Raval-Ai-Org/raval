ALTER POLICY profiles_insert_own ON public.profiles TO authenticated;
ALTER POLICY profiles_select_own ON public.profiles TO authenticated;
ALTER POLICY profiles_update_own ON public.profiles TO authenticated;

ALTER POLICY workspaces_insert_owner ON public.workspaces TO authenticated;
ALTER POLICY workspaces_select_members ON public.workspaces TO authenticated;
ALTER POLICY workspaces_update_owner ON public.workspaces TO authenticated;

ALTER POLICY members_select_self_workspace ON public.workspace_members TO authenticated;

ALTER POLICY chat_select_members ON public.chat_messages TO authenticated;
ALTER POLICY chat_insert_members ON public.chat_messages TO authenticated;
ALTER POLICY chat_no_update ON public.chat_messages TO authenticated;
ALTER POLICY chat_no_delete ON public.chat_messages TO authenticated;

ALTER POLICY approvals_select_members ON public.approvals TO authenticated;
ALTER POLICY approvals_insert_members ON public.approvals TO authenticated;
ALTER POLICY approvals_update_privileged ON public.approvals TO authenticated;
ALTER POLICY approvals_no_delete ON public.approvals TO authenticated;

ALTER POLICY audit_select_members ON public.audit_logs TO authenticated;
ALTER POLICY audit_no_client_insert ON public.audit_logs TO authenticated;
ALTER POLICY audit_logs_no_update ON public.audit_logs TO authenticated;
ALTER POLICY audit_no_client_delete ON public.audit_logs TO authenticated;

ALTER POLICY members_update_by_owner ON public.workspace_members
  USING (
    role <> 'owner'::public.app_role
    AND EXISTS (
      SELECT 1
      FROM public.workspaces w
      WHERE w.id = workspace_members.workspace_id
        AND w.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    user_id <> auth.uid()
    AND role = ANY (ARRAY['admin'::public.app_role, 'editor'::public.app_role, 'viewer'::public.app_role])
    AND EXISTS (
      SELECT 1
      FROM public.workspaces w
      WHERE w.id = workspace_members.workspace_id
        AND w.owner_id = auth.uid()
    )
  );

DROP FUNCTION IF EXISTS public.workspace_member_profiles(uuid);
DROP FUNCTION IF EXISTS public.accept_workspace_invite(uuid);
DROP FUNCTION IF EXISTS public.create_workspace(text, text);
DROP FUNCTION IF EXISTS public.is_workspace_member(uuid, uuid);

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;