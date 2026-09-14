-- Workspace connectors — external systems behind a website (GitHub first).
--
--   workspace_connections   one row per connected external account per workspace
--                           (GitHub: an App installation). No credentials are
--                           stored: GitHub App tokens are minted server-side on
--                           demand and live only in server memory.
--   workspace_sources       what a connection is used for (GitHub: a selected
--                           repository), optionally linked to the website it builds
--   connector_install_states single-use, hashed install/OAuth state (CSRF + tenant binding)
--
-- Writes come only from the server (service role) after role checks; members
-- read their workspace's rows. Webhook receipts reuse sdr_webhook_events
-- (provider = 'github') and audit entries reuse audit_logs.
--
-- Idempotent and non-destructive: safe to re-run.

CREATE TABLE IF NOT EXISTS public.workspace_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  -- GitHub: the App installation id.
  external_account_id text NOT NULL,
  account_login text NOT NULL,
  account_type text,
  account_avatar_url text,
  manage_url text,
  repository_selection text,
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  verification text NOT NULL,
  connected_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  last_verified_at timestamptz,
  last_error text,
  revoked_at timestamptz,
  revoked_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_connections_provider_check
    CHECK (provider IN ('github', 'wordpress', 'webflow', 'framer', 'shopify')),
  CONSTRAINT workspace_connections_status_check
    CHECK (status IN ('active', 'suspended', 'revoked', 'error')),
  CONSTRAINT workspace_connections_verification_check
    CHECK (verification IN ('oauth', 'install_window')),
  CONSTRAINT workspace_connections_selection_check
    CHECK (repository_selection IS NULL OR repository_selection IN ('all', 'selected')),
  CONSTRAINT workspace_connections_error_length CHECK (last_error IS NULL OR char_length(last_error) <= 500),
  CONSTRAINT workspace_connections_account_unique UNIQUE (workspace_id, provider, external_account_id)
);

CREATE INDEX IF NOT EXISTS workspace_connections_workspace_idx
  ON public.workspace_connections (workspace_id, provider, status);
CREATE INDEX IF NOT EXISTS workspace_connections_external_idx
  ON public.workspace_connections (provider, external_account_id);

CREATE TABLE IF NOT EXISTS public.workspace_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.workspace_connections(id) ON DELETE CASCADE,
  provider text NOT NULL,
  kind text NOT NULL DEFAULT 'repository',
  -- GitHub: the numeric repository id (stable across renames and transfers).
  external_id text NOT NULL,
  name text NOT NULL,
  full_name text NOT NULL,
  owner_login text,
  private boolean NOT NULL DEFAULT false,
  default_branch text,
  branch text,
  html_url text,
  site_url text,
  site_host text,
  status text NOT NULL DEFAULT 'active',
  -- Names and paths only (framework, discovery files) — never file contents.
  inspection jsonb,
  last_synced_at timestamptz,
  last_error text,
  selected_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_sources_status_check CHECK (status IN ('active', 'access_lost')),
  CONSTRAINT workspace_sources_kind_check CHECK (kind IN ('repository')),
  CONSTRAINT workspace_sources_error_length CHECK (last_error IS NULL OR char_length(last_error) <= 500),
  CONSTRAINT workspace_sources_external_unique UNIQUE (workspace_id, provider, external_id)
);

CREATE INDEX IF NOT EXISTS workspace_sources_connection_idx
  ON public.workspace_sources (connection_id);
CREATE INDEX IF NOT EXISTS workspace_sources_site_idx
  ON public.workspace_sources (workspace_id, site_host);

CREATE TABLE IF NOT EXISTS public.connector_install_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- SHA-256 of the state that travels through GitHub; a database read can't be replayed.
  state_hash text NOT NULL UNIQUE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS connector_install_states_expiry_idx
  ON public.connector_install_states (expires_at);

-- ── Row-level security ────────────────────────────────────────────────────
ALTER TABLE public.workspace_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connector_install_states ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.workspace_connections, public.workspace_sources FROM anon, authenticated;
REVOKE ALL ON public.connector_install_states FROM anon, authenticated;
GRANT SELECT ON public.workspace_connections, public.workspace_sources TO authenticated;
GRANT ALL ON public.workspace_connections, public.workspace_sources, public.connector_install_states
  TO service_role;

DROP POLICY IF EXISTS "Workspace members read connections" ON public.workspace_connections;
CREATE POLICY "Workspace members read connections"
  ON public.workspace_connections FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Workspace members read sources" ON public.workspace_sources;
CREATE POLICY "Workspace members read sources"
  ON public.workspace_sources FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP TRIGGER IF EXISTS workspace_connections_touch_updated_at ON public.workspace_connections;
CREATE TRIGGER workspace_connections_touch_updated_at
  BEFORE UPDATE ON public.workspace_connections
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS workspace_sources_touch_updated_at ON public.workspace_sources;
CREATE TRIGGER workspace_sources_touch_updated_at
  BEFORE UPDATE ON public.workspace_sources
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
