-- Canva OAuth credentials are service-role only; members see connection metadata.
ALTER TABLE public.workspace_connections DROP CONSTRAINT IF EXISTS workspace_connections_provider_check;
ALTER TABLE public.workspace_connections ADD CONSTRAINT workspace_connections_provider_check
  CHECK (provider IN ('github', 'wordpress', 'webflow', 'framer', 'shopify', 'google', 'canva'));

CREATE TABLE IF NOT EXISTS public.canva_oauth_credentials (
  connection_id uuid PRIMARY KEY REFERENCES public.workspace_connections(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  access_token_enc text NOT NULL,
  refresh_token_enc text NOT NULL,
  access_token_expires_at timestamptz NOT NULL,
  scopes text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS canva_credentials_workspace_idx ON public.canva_oauth_credentials(workspace_id);
ALTER TABLE public.canva_oauth_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.canva_oauth_credentials FROM anon, authenticated;
GRANT ALL ON public.canva_oauth_credentials TO service_role;

CREATE TABLE IF NOT EXISTS public.canva_design_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  content_item_id uuid REFERENCES public.content_items(id) ON DELETE SET NULL,
  asset_id uuid REFERENCES public.assets(id) ON DELETE SET NULL,
  source_key text NOT NULL,
  canva_design_id text NOT NULL,
  canva_asset_ids text[] NOT NULL DEFAULT '{}',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_opened_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, source_key)
);
CREATE INDEX IF NOT EXISTS canva_design_mappings_content_idx ON public.canva_design_mappings(workspace_id, content_item_id);
ALTER TABLE public.canva_design_mappings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.canva_design_mappings FROM anon, authenticated;
GRANT SELECT ON public.canva_design_mappings TO authenticated;
GRANT ALL ON public.canva_design_mappings TO service_role;
DROP POLICY IF EXISTS "Workspace members read Canva mappings" ON public.canva_design_mappings;
CREATE POLICY "Workspace members read Canva mappings" ON public.canva_design_mappings
  FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id, auth.uid()));
