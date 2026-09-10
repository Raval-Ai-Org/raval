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