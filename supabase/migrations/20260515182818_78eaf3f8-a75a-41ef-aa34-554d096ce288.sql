-- 1. Fix workspace_members privilege escalation
DROP POLICY IF EXISTS members_insert_owner_self ON public.workspace_members;

CREATE POLICY members_insert_by_owner
ON public.workspace_members
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.workspaces w
    WHERE w.id = workspace_id AND w.owner_id = auth.uid()
  )
);

-- 2. Add UPDATE/DELETE policies for workspace owners
CREATE POLICY members_update_by_owner
ON public.workspace_members
FOR UPDATE
TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_id AND w.owner_id = auth.uid())
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_id AND w.owner_id = auth.uid())
);

CREATE POLICY members_delete_by_owner_or_self
ON public.workspace_members
FOR DELETE
TO authenticated
USING (
  user_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = workspace_id AND w.owner_id = auth.uid())
);

-- 3. Audit logs: remove client insert capability
DROP POLICY IF EXISTS audit_insert_members ON public.audit_logs;

-- 4. Lock down SECURITY DEFINER function execution
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_workspace_member(uuid, uuid) FROM PUBLIC, anon;
-- authenticated retains EXECUTE on is_workspace_member because RLS policies call it.
