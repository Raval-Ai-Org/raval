
-- Atomic create: insert workspace + owner membership, return the new id.
CREATE OR REPLACE FUNCTION public.create_workspace(p_name text, p_website_url text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id  uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF p_name IS NULL OR length(btrim(p_name)) = 0 THEN
    RAISE EXCEPTION 'name required';
  END IF;

  INSERT INTO public.workspaces (owner_id, name, website_url)
  VALUES (v_uid, btrim(p_name), NULLIF(btrim(p_website_url), ''))
  RETURNING id INTO v_id;

  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (v_id, v_uid, 'owner')
  ON CONFLICT (workspace_id, user_id) DO NOTHING;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_workspace(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.create_workspace(text, text) TO authenticated;

-- Allow owners to delete their projects
DROP POLICY IF EXISTS workspaces_delete_owner ON public.workspaces;
CREATE POLICY workspaces_delete_owner
ON public.workspaces
FOR DELETE
TO authenticated
USING (auth.uid() = owner_id);
