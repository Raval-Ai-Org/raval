-- WordPress.com OAuth credentials and site selection. Self-hosted WordPress
-- Application Password credentials remain in wordpress_credentials.

CREATE TABLE IF NOT EXISTS public.wordpress_oauth_credentials (
  connection_id uuid PRIMARY KEY REFERENCES public.workspace_connections(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  access_token_enc text NOT NULL,
  refresh_token_enc text,
  access_token_expires_at timestamptz,
  scopes text[] NOT NULL DEFAULT '{}'::text[],
  wordpress_user_id text,
  wordpress_user_login text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.wordpress_sites ADD COLUMN IF NOT EXISTS wordpress_site_id text;
CREATE UNIQUE INDEX IF NOT EXISTS wordpress_sites_workspace_external_idx
  ON public.wordpress_sites (workspace_id, wordpress_site_id);
CREATE INDEX IF NOT EXISTS wordpress_sites_connection_idx
  ON public.wordpress_sites (connection_id);

ALTER TABLE public.wordpress_oauth_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wordpress_oauth_credentials FROM anon, authenticated;
GRANT ALL ON public.wordpress_oauth_credentials TO service_role;

DROP TRIGGER IF EXISTS wordpress_oauth_credentials_touch_updated_at ON public.wordpress_oauth_credentials;
CREATE TRIGGER wordpress_oauth_credentials_touch_updated_at BEFORE UPDATE ON public.wordpress_oauth_credentials
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();