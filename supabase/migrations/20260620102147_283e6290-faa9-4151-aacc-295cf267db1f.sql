UPDATE public.workspace_invites
SET role = 'admin'
WHERE role = 'owner';

ALTER POLICY invites_insert_owner ON public.workspace_invites
  WITH CHECK (
    role = ANY (ARRAY['admin'::text, 'editor'::text, 'viewer'::text])
    AND EXISTS (
      SELECT 1
      FROM public.workspaces w
      WHERE w.id = workspace_invites.workspace_id
        AND w.owner_id = auth.uid()
    )
  );

ALTER POLICY invites_update_owner ON public.workspace_invites
  USING (
    EXISTS (
      SELECT 1
      FROM public.workspaces w
      WHERE w.id = workspace_invites.workspace_id
        AND w.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    role = ANY (ARRAY['admin'::text, 'editor'::text, 'viewer'::text])
    AND EXISTS (
      SELECT 1
      FROM public.workspaces w
      WHERE w.id = workspace_invites.workspace_id
        AND w.owner_id = auth.uid()
    )
  );