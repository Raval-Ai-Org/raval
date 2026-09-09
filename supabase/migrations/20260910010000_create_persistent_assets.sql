-- Durable generated asset metadata. Binary content lives in Supabase Storage.
CREATE TABLE IF NOT EXISTS public.assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  content_item_id uuid REFERENCES public.content_items(id) ON DELETE SET NULL,
  parent_asset_id uuid REFERENCES public.assets(id) ON DELETE SET NULL,
  generation_id text NOT NULL,
  idempotency_key text NOT NULL,
  asset_type text NOT NULL DEFAULT 'image',
  status text NOT NULL DEFAULT 'draft',
  storage_path text,
  thumbnail_path text,
  public_url text,
  filename text NOT NULL,
  mime_type text NOT NULL DEFAULT 'application/octet-stream',
  width integer,
  height integer,
  platform text,
  provider text,
  model text,
  model_route text,
  prompt_version text,
  creative_brief_version text,
  brand_dna_version text,
  attempt integer NOT NULL DEFAULT 1,
  seed text,
  qa_score numeric,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT assets_idempotency_key_unique UNIQUE (workspace_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS assets_workspace_created_idx ON public.assets(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS assets_workspace_status_idx ON public.assets(workspace_id, status);
CREATE INDEX IF NOT EXISTS assets_content_item_idx ON public.assets(content_item_id);

ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.assets TO authenticated;
GRANT ALL ON public.assets TO service_role;

CREATE POLICY "Workspace members can read assets"
  ON public.assets FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "Workspace members can create assets"
  ON public.assets FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "Workspace members can update assets"
  ON public.assets FOR UPDATE TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
CREATE POLICY "Workspace members can delete assets"
  ON public.assets FOR DELETE TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));

CREATE TRIGGER assets_touch_updated_at
  BEFORE UPDATE ON public.assets
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('generated-assets', 'generated-assets', true, 52428800)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public, file_size_limit = EXCLUDED.file_size_limit;

CREATE POLICY "Workspace members can read generated assets"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'generated-assets'
    AND (storage.foldername(name))[1] = 'workspace'
    AND public.is_workspace_member((storage.foldername(name))[2]::uuid, auth.uid())
  );
CREATE POLICY "Workspace members can upload generated assets"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'generated-assets'
    AND (storage.foldername(name))[1] = 'workspace'
    AND public.is_workspace_member((storage.foldername(name))[2]::uuid, auth.uid())
  );
CREATE POLICY "Workspace members can update generated assets"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'generated-assets'
    AND (storage.foldername(name))[1] = 'workspace'
    AND public.is_workspace_member((storage.foldername(name))[2]::uuid, auth.uid())
  )
  WITH CHECK (
    bucket_id = 'generated-assets'
    AND (storage.foldername(name))[1] = 'workspace'
    AND public.is_workspace_member((storage.foldername(name))[2]::uuid, auth.uid())
  );
CREATE POLICY "Workspace members can delete generated assets"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'generated-assets'
    AND (storage.foldername(name))[1] = 'workspace'
    AND public.is_workspace_member((storage.foldername(name))[2]::uuid, auth.uid())
  );
