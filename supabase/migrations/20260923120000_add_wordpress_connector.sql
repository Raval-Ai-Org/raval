-- WordPress REST API connections use Application Passwords, never normal passwords.
-- The credential row is service-role-only; the shared connection row is the
-- browser-safe status and the selected site is the GEO source metadata.

ALTER TABLE public.workspace_connections
  DROP CONSTRAINT IF EXISTS workspace_connections_verification_check;
ALTER TABLE public.workspace_connections
  ADD CONSTRAINT workspace_connections_verification_check
  CHECK (verification IN ('oauth', 'install_window', 'application_password'));

CREATE TABLE IF NOT EXISTS public.wordpress_credentials (
  connection_id uuid PRIMARY KEY REFERENCES public.workspace_connections(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  site_url text NOT NULL,
  username text NOT NULL,
  application_password_enc text NOT NULL,
  site_name text,
  site_description text,
  site_home text,
  api_namespaces text[] NOT NULL DEFAULT '{}'::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wordpress_credentials_url_length CHECK (char_length(site_url) <= 500),
  CONSTRAINT wordpress_credentials_username_length CHECK (char_length(username) BETWEEN 1 AND 200)
);

CREATE TABLE IF NOT EXISTS public.wordpress_sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.workspace_connections(id) ON DELETE CASCADE,
  site_url text NOT NULL,
  site_name text NOT NULL,
  selected boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'active',
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wordpress_sites_status_check CHECK (status IN ('active', 'error', 'unavailable')),
  CONSTRAINT wordpress_sites_error_length CHECK (last_error IS NULL OR char_length(last_error) <= 500),
  CONSTRAINT wordpress_sites_workspace_url_unique UNIQUE (workspace_id, site_url)
);

CREATE INDEX IF NOT EXISTS wordpress_sites_workspace_idx ON public.wordpress_sites (workspace_id, selected);
CREATE INDEX IF NOT EXISTS wordpress_credentials_workspace_idx ON public.wordpress_credentials (workspace_id);

ALTER TABLE public.wordpress_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wordpress_sites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wordpress_credentials FROM anon, authenticated;
REVOKE ALL ON public.wordpress_sites FROM anon, authenticated;
GRANT ALL ON public.wordpress_credentials, public.wordpress_sites TO service_role;
GRANT SELECT ON public.wordpress_sites TO authenticated;

DROP POLICY IF EXISTS "Workspace members read WordPress sites" ON public.wordpress_sites;
CREATE POLICY "Workspace members read WordPress sites"
  ON public.wordpress_sites FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP TRIGGER IF EXISTS wordpress_credentials_touch_updated_at ON public.wordpress_credentials;
CREATE TRIGGER wordpress_credentials_touch_updated_at BEFORE UPDATE ON public.wordpress_credentials
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS wordpress_sites_touch_updated_at ON public.wordpress_sites;
CREATE TRIGGER wordpress_sites_touch_updated_at BEFORE UPDATE ON public.wordpress_sites
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();