CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.is_workspace_member(_workspace_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_members
    WHERE workspace_id = _workspace_id
      AND user_id = _user_id
  );
$$;

REVOKE ALL ON FUNCTION private.is_workspace_member(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.is_workspace_member(uuid, uuid) TO anon, authenticated, service_role;

ALTER POLICY workspaces_select_members ON public.workspaces
  USING (private.is_workspace_member(id, auth.uid()));

ALTER POLICY members_select_self_workspace ON public.workspace_members
  USING (private.is_workspace_member(workspace_id, auth.uid()));

ALTER POLICY chat_select_members ON public.chat_messages
  USING (private.is_workspace_member(workspace_id, auth.uid()));

ALTER POLICY chat_insert_members ON public.chat_messages
  WITH CHECK (private.is_workspace_member(workspace_id, auth.uid()));

ALTER POLICY approvals_select_members ON public.approvals
  USING (private.is_workspace_member(workspace_id, auth.uid()));

ALTER POLICY approvals_insert_members ON public.approvals
  WITH CHECK (private.is_workspace_member(workspace_id, auth.uid()));

ALTER POLICY audit_select_members ON public.audit_logs
  USING (private.is_workspace_member(workspace_id, auth.uid()));

ALTER POLICY approvals_update_privileged ON public.approvals
  USING (
    EXISTS (
      SELECT 1
      FROM public.workspace_members wm
      WHERE wm.workspace_id = approvals.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role = ANY (ARRAY['owner'::public.app_role, 'admin'::public.app_role])
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.workspace_members wm
      WHERE wm.workspace_id = approvals.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role = ANY (ARRAY['owner'::public.app_role, 'admin'::public.app_role])
    )
  );

ALTER POLICY members_insert_by_owner ON public.workspace_members
  WITH CHECK (
    role = ANY (ARRAY['admin'::public.app_role, 'editor'::public.app_role, 'viewer'::public.app_role])
    AND EXISTS (
      SELECT 1
      FROM public.workspaces w
      WHERE w.id = workspace_members.workspace_id
        AND w.owner_id = auth.uid()
    )
  );

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
    role = ANY (ARRAY['admin'::public.app_role, 'editor'::public.app_role, 'viewer'::public.app_role])
    AND EXISTS (
      SELECT 1
      FROM public.workspaces w
      WHERE w.id = workspace_members.workspace_id
        AND w.owner_id = auth.uid()
    )
  );

REVOKE ALL ON FUNCTION public.is_workspace_member(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_workspace(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.accept_workspace_invite(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.workspace_member_profiles(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_workspace(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.accept_workspace_invite(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.workspace_member_profiles(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;