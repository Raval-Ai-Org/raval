-- Wix website connector (GEO fixes and article publishing on Wix sites).
--
--   wix_oauth_credentials  one Wix app instance per connection. Wix apps get
--                          an access token from the app secret plus the
--                          site's instance id (client credentials, 4 h), so
--                          the instance id is the lasting credential. It and
--                          the cached access token are encrypted by the
--                          application (WIX_TOKEN_ENCRYPTION_KEY). Service
--                          role only.
--   wix_sites              the Wix site behind that instance (one per
--                          connection), with the hosts it is served on.
--   site_blog_settings     wix_member_id: the site member Wix Blog posts are
--                          written as (Wix requires one for app-made posts).
--
-- 'wix' joins the provider checks of the connection, fix, agent and
-- publishing tables. Idempotent and non-destructive.

-- ── Providers ─────────────────────────────────────────────────────────────
ALTER TABLE public.workspace_connections DROP CONSTRAINT IF EXISTS workspace_connections_provider_check;
ALTER TABLE public.workspace_connections ADD CONSTRAINT workspace_connections_provider_check
  CHECK (provider IN ('github','wordpress','webflow','framer','shopify','google','canva','notion','wix'));

ALTER TABLE public.geo_fix_proposals DROP CONSTRAINT IF EXISTS geo_fix_proposals_provider_check;
ALTER TABLE public.geo_fix_proposals ADD CONSTRAINT geo_fix_proposals_provider_check
  CHECK (provider IN ('github', 'wordpress', 'webflow', 'wix'));

ALTER TABLE public.geo_fix_batches DROP CONSTRAINT IF EXISTS geo_fix_batches_provider_check;
ALTER TABLE public.geo_fix_batches ADD CONSTRAINT geo_fix_batches_provider_check
  CHECK (provider IN ('github', 'wordpress', 'webflow', 'wix'));

ALTER TABLE public.geo_agent_runs DROP CONSTRAINT IF EXISTS geo_agent_runs_provider_check;
ALTER TABLE public.geo_agent_runs ADD CONSTRAINT geo_agent_runs_provider_check
  CHECK (provider IN ('github', 'wordpress', 'webflow', 'wix'));

ALTER TABLE public.site_blog_settings DROP CONSTRAINT IF EXISTS site_blog_settings_provider_check;
ALTER TABLE public.site_blog_settings ADD CONSTRAINT site_blog_settings_provider_check
  CHECK (provider IN ('github', 'wordpress', 'webflow', 'wix'));

ALTER TABLE public.site_publications DROP CONSTRAINT IF EXISTS site_publications_provider_check;
ALTER TABLE public.site_publications ADD CONSTRAINT site_publications_provider_check
  CHECK (provider IN ('github', 'wordpress', 'webflow', 'wix'));

ALTER TABLE public.site_blog_settings ADD COLUMN IF NOT EXISTS wix_member_id text;

-- One live Wix connection per workspace: connecting another site replaces it.
CREATE UNIQUE INDEX IF NOT EXISTS workspace_wix_one_active_idx
  ON public.workspace_connections (workspace_id)
  WHERE provider = 'wix' AND status <> 'revoked';

-- ── Credentials (service role only) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.wix_oauth_credentials (
  connection_id uuid PRIMARY KEY REFERENCES public.workspace_connections(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- AES-256-GCM, format v1:iv:tag:ciphertext.
  instance_id_enc text NOT NULL,
  access_token_enc text,
  access_token_expires_at timestamptz,
  -- Permissions the site owner granted the app (Get App Instance), for "reconnect to allow".
  permissions text[] NOT NULL DEFAULT '{}'::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.wix_sites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.workspace_connections(id) ON DELETE CASCADE,
  -- Wix's site GUID (metaSiteId), also stamped into the live page.
  site_id text NOT NULL,
  site_name text NOT NULL,
  site_url text,
  domains text[] NOT NULL DEFAULT '{}'::text[],
  installed_apps text[] NOT NULL DEFAULT '{}'::text[],
  selected boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'active',
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wix_sites_status_check CHECK (status IN ('active', 'unavailable', 'error')),
  CONSTRAINT wix_sites_error_length CHECK (last_error IS NULL OR char_length(last_error) <= 500),
  CONSTRAINT wix_sites_workspace_site_unique UNIQUE (workspace_id, site_id)
);

CREATE INDEX IF NOT EXISTS wix_sites_workspace_idx ON public.wix_sites (workspace_id, selected);
CREATE INDEX IF NOT EXISTS wix_sites_connection_idx ON public.wix_sites (connection_id);
CREATE INDEX IF NOT EXISTS wix_credentials_workspace_idx ON public.wix_oauth_credentials (workspace_id);

-- ── Row-level security ────────────────────────────────────────────────────
ALTER TABLE public.wix_oauth_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wix_sites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wix_oauth_credentials FROM anon, authenticated;
REVOKE ALL ON public.wix_sites FROM anon, authenticated;
GRANT ALL ON public.wix_oauth_credentials, public.wix_sites TO service_role;
GRANT SELECT ON public.wix_sites TO authenticated;

DROP POLICY IF EXISTS "Workspace members read Wix sites" ON public.wix_sites;
CREATE POLICY "Workspace members read Wix sites"
  ON public.wix_sites FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP TRIGGER IF EXISTS wix_credentials_touch_updated_at ON public.wix_oauth_credentials;
CREATE TRIGGER wix_credentials_touch_updated_at BEFORE UPDATE ON public.wix_oauth_credentials
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS wix_sites_touch_updated_at ON public.wix_sites;
CREATE TRIGGER wix_sites_touch_updated_at BEFORE UPDATE ON public.wix_sites
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
