-- Webflow OAuth credentials and selected site metadata. Tokens are encrypted
-- by the application and are never readable by authenticated clients.

CREATE TABLE IF NOT EXISTS public.webflow_oauth_credentials (
  connection_id uuid PRIMARY KEY REFERENCES public.workspace_connections(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  access_token_enc text NOT NULL,
  refresh_token_enc text,
  access_token_expires_at timestamptz,
  scopes text[] NOT NULL DEFAULT '{}'::text[],
  webflow_user_id text,
  webflow_user_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.webflow_sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.workspace_connections(id) ON DELETE CASCADE,
  site_id text NOT NULL,
  site_name text NOT NULL,
  domain text,
  preview_url text,
  selected boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active',
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT webflow_sites_status_check CHECK (status IN ('active', 'unavailable', 'error')),
  CONSTRAINT webflow_sites_error_length CHECK (last_error IS NULL OR char_length(last_error) <= 500),
  CONSTRAINT webflow_sites_workspace_site_unique UNIQUE (workspace_id, site_id)
);

CREATE INDEX IF NOT EXISTS webflow_sites_workspace_idx ON public.webflow_sites (workspace_id, selected);
CREATE INDEX IF NOT EXISTS webflow_credentials_workspace_idx ON public.webflow_oauth_credentials (workspace_id);

ALTER TABLE public.webflow_oauth_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webflow_sites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.webflow_oauth_credentials FROM anon, authenticated;
REVOKE ALL ON public.webflow_sites FROM anon, authenticated;
GRANT ALL ON public.webflow_oauth_credentials, public.webflow_sites TO service_role;
GRANT SELECT ON public.webflow_sites TO authenticated;

DROP POLICY IF EXISTS "Workspace members read Webflow sites" ON public.webflow_sites;
CREATE POLICY "Workspace members read Webflow sites"
  ON public.webflow_sites FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP TRIGGER IF EXISTS webflow_credentials_touch_updated_at ON public.webflow_oauth_credentials;
CREATE TRIGGER webflow_credentials_touch_updated_at BEFORE UPDATE ON public.webflow_oauth_credentials
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS webflow_sites_touch_updated_at ON public.webflow_sites;
CREATE TRIGGER webflow_sites_touch_updated_at BEFORE UPDATE ON public.webflow_sites
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();