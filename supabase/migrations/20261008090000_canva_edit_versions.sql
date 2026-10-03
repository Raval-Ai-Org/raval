ALTER TABLE public.canva_design_mappings
  ADD COLUMN IF NOT EXISTS mode text NOT NULL DEFAULT 'flat_image',
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS last_imported_at timestamptz;
ALTER TABLE public.canva_design_mappings DROP CONSTRAINT IF EXISTS canva_design_mappings_mode_check;
ALTER TABLE public.canva_design_mappings ADD CONSTRAINT canva_design_mappings_mode_check
  CHECK (mode IN ('magic_layers', 'design_import', 'flat_image'));

CREATE TABLE IF NOT EXISTS public.canva_import_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  mapping_id uuid NOT NULL REFERENCES public.canva_design_mappings(id) ON DELETE CASCADE,
  version_number integer NOT NULL CHECK (version_number > 0),
  imported_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  selected_at timestamptz,
  UNIQUE (mapping_id, version_number)
);
CREATE INDEX IF NOT EXISTS canva_import_versions_workspace_idx ON public.canva_import_versions(workspace_id, mapping_id);

CREATE TABLE IF NOT EXISTS public.canva_design_source_pages (
  mapping_id uuid NOT NULL REFERENCES public.canva_design_mappings(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  page_number integer NOT NULL CHECK (page_number > 0),
  source_asset_id uuid REFERENCES public.assets(id) ON DELETE SET NULL,
  canva_asset_id text,
  PRIMARY KEY (mapping_id, page_number)
);
CREATE INDEX IF NOT EXISTS canva_design_source_pages_workspace_idx ON public.canva_design_source_pages(workspace_id, source_asset_id);

CREATE TABLE IF NOT EXISTS public.canva_fallback_slide_designs (
  mapping_id uuid NOT NULL REFERENCES public.canva_design_mappings(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  page_number integer NOT NULL CHECK (page_number > 0),
  canva_design_id text NOT NULL,
  PRIMARY KEY (mapping_id, page_number)
);
CREATE INDEX IF NOT EXISTS canva_fallback_slide_designs_workspace_idx ON public.canva_fallback_slide_designs(workspace_id, mapping_id);
ALTER TABLE public.canva_fallback_slide_designs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.canva_fallback_slide_designs FROM anon, authenticated;
GRANT SELECT ON public.canva_fallback_slide_designs TO authenticated;
GRANT ALL ON public.canva_fallback_slide_designs TO service_role;
DROP POLICY IF EXISTS "Workspace members read Canva fallback slides" ON public.canva_fallback_slide_designs;
CREATE POLICY "Workspace members read Canva fallback slides" ON public.canva_fallback_slide_designs
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
ALTER TABLE public.canva_design_source_pages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.canva_design_source_pages FROM anon, authenticated;
GRANT SELECT ON public.canva_design_source_pages TO authenticated;
GRANT ALL ON public.canva_design_source_pages TO service_role;
DROP POLICY IF EXISTS "Workspace members read Canva sources" ON public.canva_design_source_pages;
CREATE POLICY "Workspace members read Canva sources" ON public.canva_design_source_pages
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
ALTER TABLE public.canva_import_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.canva_import_versions FROM anon, authenticated;
GRANT SELECT ON public.canva_import_versions TO authenticated;
GRANT ALL ON public.canva_import_versions TO service_role;
DROP POLICY IF EXISTS "Workspace members read Canva versions" ON public.canva_import_versions;
CREATE POLICY "Workspace members read Canva versions" ON public.canva_import_versions
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));

CREATE TABLE IF NOT EXISTS public.canva_import_pages (
  version_id uuid NOT NULL REFERENCES public.canva_import_versions(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  page_number integer NOT NULL CHECK (page_number > 0),
  asset_id uuid NOT NULL REFERENCES public.assets(id) ON DELETE RESTRICT,
  PRIMARY KEY (version_id, page_number)
);
CREATE INDEX IF NOT EXISTS canva_import_pages_workspace_idx ON public.canva_import_pages(workspace_id, asset_id);
ALTER TABLE public.canva_import_pages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.canva_import_pages FROM anon, authenticated;
GRANT SELECT ON public.canva_import_pages TO authenticated;
GRANT ALL ON public.canva_import_pages TO service_role;
DROP POLICY IF EXISTS "Workspace members read Canva pages" ON public.canva_import_pages;
CREATE POLICY "Workspace members read Canva pages" ON public.canva_import_pages
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
