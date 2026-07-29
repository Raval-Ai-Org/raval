-- Tighten content_items UPDATE: require privileged role (owner/admin/editor).
-- Viewers and non-members cannot approve/reject content.
DROP POLICY IF EXISTS "Members can update content items" ON public.content_items;

CREATE POLICY "content_items_update_privileged"
  ON public.content_items
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = content_items.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role = ANY (ARRAY['owner'::app_role, 'admin'::app_role, 'editor'::app_role])
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.workspace_members wm
      WHERE wm.workspace_id = content_items.workspace_id
        AND wm.user_id = auth.uid()
        AND wm.role = ANY (ARRAY['owner'::app_role, 'admin'::app_role, 'editor'::app_role])
    )
  );

-- Helper to fetch the caller's role on a workspace (NULL if not a member).
CREATE OR REPLACE FUNCTION public.my_workspace_role(_workspace_id uuid)
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role::text FROM public.workspace_members
   WHERE workspace_id = _workspace_id AND user_id = auth.uid()
   LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.my_workspace_role(uuid) TO authenticated;