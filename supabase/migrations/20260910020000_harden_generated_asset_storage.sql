-- Generated media is tenant-private. Durable references remain storage paths;
-- callers must request short-lived signed URLs from trusted server routes.
UPDATE storage.buckets
SET public = false,
    file_size_limit = 52428800
WHERE id = 'generated-assets';

CREATE OR REPLACE FUNCTION private.storage_workspace_id(path text)
RETURNS uuid
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = pg_catalog
AS $$
BEGIN
  IF path !~ '^workspace/[0-9a-fA-F-]{36}/assets/' THEN
    RETURN NULL;
  END IF;

  RETURN split_part(path, '/', 2)::uuid;
EXCEPTION
  WHEN invalid_text_representation THEN
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.storage_workspace_id(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.storage_workspace_id(text) TO authenticated, service_role;

DROP POLICY IF EXISTS "Workspace members can read generated assets" ON storage.objects;
DROP POLICY IF EXISTS "Workspace members can upload generated assets" ON storage.objects;
DROP POLICY IF EXISTS "Workspace members can update generated assets" ON storage.objects;
DROP POLICY IF EXISTS "Workspace members can delete generated assets" ON storage.objects;

CREATE POLICY "Workspace members can read generated assets"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'generated-assets'
    AND private.is_workspace_member(private.storage_workspace_id(name), auth.uid())
  );

CREATE POLICY "Workspace members can upload generated assets"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'generated-assets'
    AND private.is_workspace_member(private.storage_workspace_id(name), auth.uid())
  );

CREATE POLICY "Workspace members can update generated assets"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'generated-assets'
    AND private.is_workspace_member(private.storage_workspace_id(name), auth.uid())
  )
  WITH CHECK (
    bucket_id = 'generated-assets'
    AND private.is_workspace_member(private.storage_workspace_id(name), auth.uid())
  );

CREATE POLICY "Workspace members can delete generated assets"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'generated-assets'
    AND private.is_workspace_member(private.storage_workspace_id(name), auth.uid())
  );