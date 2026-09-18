-- Unified analytics — Google Analytics 4 + Google Search Console connector
-- (ADR-0015, docs/google-analytics-connector.md).
--
--   workspace_connections     gains provider 'google' (one OAuth grant per workspace)
--   connector_install_states  gains an encrypted PKCE verifier column
--   google_oauth_credentials  encrypted refresh/access tokens — service role only
--   analytics_sources         the GA4 property / Search Console site a workspace reads
--   analytics_ga4_daily       GA4 totals per day             (source: Google Analytics 4)
--   analytics_ga4_dimension_daily  GA4 top-N rows per dimension per day
--   analytics_gsc_daily       Search Console totals per day   (source: Google Search Console)
--   analytics_gsc_dimension_daily  Search Console top-N rows per dimension per day
--   analytics_sync_runs       leased sync jobs (initial / daily / manual)
--   analytics_insights        cached AI insights keyed by a deterministic fingerprint
--
-- Members read their workspace's rows; only the service role writes, so a
-- browser can never write metrics, sync state or insights. Tokens are never
-- readable by `authenticated`.
--
-- Idempotent and non-destructive: safe to re-run. The provider CHECK is
-- dropped and re-added only to widen it.

-- ── workspace_connections: allow the Google provider ──────────────────────
ALTER TABLE public.workspace_connections
  DROP CONSTRAINT IF EXISTS workspace_connections_provider_check;
ALTER TABLE public.workspace_connections
  ADD CONSTRAINT workspace_connections_provider_check
  CHECK (provider IN ('github', 'wordpress', 'webflow', 'framer', 'shopify', 'google'));

-- ── connector_install_states: PKCE verifier (encrypted, Google only) ──────
ALTER TABLE public.connector_install_states
  ADD COLUMN IF NOT EXISTS pkce_verifier_enc text;

-- ── Credentials (service role only) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.google_oauth_credentials (
  connection_id uuid PRIMARY KEY REFERENCES public.workspace_connections(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- AES-256-GCM, key GOOGLE_TOKEN_ENCRYPTION_KEY, format v1:iv:tag:ciphertext.
  refresh_token_enc text NOT NULL,
  access_token_enc text,
  access_token_expires_at timestamptz,
  scopes text[] NOT NULL DEFAULT '{}'::text[],
  google_sub text,
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS google_oauth_credentials_workspace_idx
  ON public.google_oauth_credentials (workspace_id);

-- ── Selected property / site ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.analytics_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.workspace_connections(id) ON DELETE CASCADE,
  kind text NOT NULL,
  -- GA4: "properties/123456". Search Console: "sc-domain:example.com" or "https://example.com/".
  external_id text NOT NULL,
  display_name text NOT NULL,
  account_name text,
  site_host text,
  time_zone text,
  currency text,
  status text NOT NULL DEFAULT 'active',
  last_error text,
  backfill_completed_at timestamptz,
  last_synced_at timestamptz,
  last_synced_date date,
  selected_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT analytics_sources_kind_check CHECK (kind IN ('ga4_property', 'gsc_site')),
  CONSTRAINT analytics_sources_status_check CHECK (status IN ('active', 'access_lost', 'error')),
  CONSTRAINT analytics_sources_error_length CHECK (last_error IS NULL OR char_length(last_error) <= 500),
  CONSTRAINT analytics_sources_external_length CHECK (char_length(external_id) <= 300),
  CONSTRAINT analytics_sources_workspace_kind_unique UNIQUE (workspace_id, kind)
);

CREATE INDEX IF NOT EXISTS analytics_sources_connection_idx
  ON public.analytics_sources (connection_id);
CREATE INDEX IF NOT EXISTS analytics_sources_due_idx
  ON public.analytics_sources (status, last_synced_date);

-- ── GA4 facts (source: Google Analytics 4) ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.analytics_ga4_daily (
  source_id uuid NOT NULL REFERENCES public.analytics_sources(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  date date NOT NULL,
  sessions bigint NOT NULL DEFAULT 0,
  total_users bigint NOT NULL DEFAULT 0,
  new_users bigint NOT NULL DEFAULT 0,
  engaged_sessions bigint NOT NULL DEFAULT 0,
  screen_page_views bigint NOT NULL DEFAULT 0,
  key_events numeric NOT NULL DEFAULT 0,
  -- Session-weighted inputs: stored as totals so any range re-aggregates exactly.
  session_duration_seconds numeric NOT NULL DEFAULT 0,
  bounced_sessions numeric NOT NULL DEFAULT 0,
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, date)
);

CREATE INDEX IF NOT EXISTS analytics_ga4_daily_workspace_idx
  ON public.analytics_ga4_daily (workspace_id, date);

CREATE TABLE IF NOT EXISTS public.analytics_ga4_dimension_daily (
  source_id uuid NOT NULL REFERENCES public.analytics_sources(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  date date NOT NULL,
  dimension text NOT NULL,
  value text NOT NULL,
  sessions bigint NOT NULL DEFAULT 0,
  total_users bigint NOT NULL DEFAULT 0,
  screen_page_views bigint NOT NULL DEFAULT 0,
  key_events numeric NOT NULL DEFAULT 0,
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, date, dimension, value),
  CONSTRAINT analytics_ga4_dimension_check
    CHECK (dimension IN ('channel', 'source_medium', 'landing_page', 'country', 'device')),
  CONSTRAINT analytics_ga4_dimension_value_length CHECK (char_length(value) <= 600)
);

CREATE INDEX IF NOT EXISTS analytics_ga4_dimension_daily_lookup_idx
  ON public.analytics_ga4_dimension_daily (workspace_id, dimension, date);

-- ── Search Console facts (source: Google Search Console) ──────────────────
CREATE TABLE IF NOT EXISTS public.analytics_gsc_daily (
  source_id uuid NOT NULL REFERENCES public.analytics_sources(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  date date NOT NULL,
  clicks bigint NOT NULL DEFAULT 0,
  impressions bigint NOT NULL DEFAULT 0,
  -- Impression-weighted position sum (position × impressions): CTR and average
  -- position are always recomputed from totals, never averaged.
  position_weighted numeric NOT NULL DEFAULT 0,
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, date)
);

CREATE INDEX IF NOT EXISTS analytics_gsc_daily_workspace_idx
  ON public.analytics_gsc_daily (workspace_id, date);

CREATE TABLE IF NOT EXISTS public.analytics_gsc_dimension_daily (
  source_id uuid NOT NULL REFERENCES public.analytics_sources(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  date date NOT NULL,
  dimension text NOT NULL,
  value text NOT NULL,
  clicks bigint NOT NULL DEFAULT 0,
  impressions bigint NOT NULL DEFAULT 0,
  position_weighted numeric NOT NULL DEFAULT 0,
  synced_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, date, dimension, value),
  CONSTRAINT analytics_gsc_dimension_check
    CHECK (dimension IN ('query', 'page', 'country', 'device')),
  CONSTRAINT analytics_gsc_dimension_value_length CHECK (char_length(value) <= 600)
);

CREATE INDEX IF NOT EXISTS analytics_gsc_dimension_daily_lookup_idx
  ON public.analytics_gsc_dimension_daily (workspace_id, dimension, date);

-- ── Sync runs (lease-based, no queue service) ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.analytics_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES public.analytics_sources(id) ON DELETE CASCADE,
  trigger text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  range_start date NOT NULL,
  range_end date NOT NULL,
  -- First date not yet written; the runner advances it chunk by chunk.
  cursor_date date NOT NULL,
  -- Which fetch step inside the current chunk comes next (0 = daily totals).
  cursor_step integer NOT NULL DEFAULT 0,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  failures integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  locked_by text,
  error_code text,
  error_message text,
  rows_written integer NOT NULL DEFAULT 0,
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT analytics_sync_runs_trigger_check CHECK (trigger IN ('initial', 'daily', 'manual')),
  CONSTRAINT analytics_sync_runs_status_check
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  CONSTRAINT analytics_sync_runs_error_code_check CHECK (
    error_code IS NULL OR error_code IN
      ('token_expired', 'permission_denied', 'quota', 'upstream', 'not_found', 'config', 'internal')
  ),
  CONSTRAINT analytics_sync_runs_error_length
    CHECK (error_message IS NULL OR char_length(error_message) <= 500),
  CONSTRAINT analytics_sync_runs_range_check CHECK (range_start <= range_end)
);

-- One queued-or-running run per source: enqueueing is idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS analytics_sync_runs_one_active_idx
  ON public.analytics_sync_runs (source_id)
  WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS analytics_sync_runs_due_idx
  ON public.analytics_sync_runs (status, next_attempt_at);
CREATE INDEX IF NOT EXISTS analytics_sync_runs_workspace_idx
  ON public.analytics_sync_runs (workspace_id, created_at DESC);

-- ── Cached AI insights ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.analytics_insights (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- e.g. "28d:2026-09-17" — the range the signals were computed for.
  range_key text NOT NULL,
  -- sha256 of the rounded deterministic signals. Same data → same fingerprint → no new AI call.
  fingerprint text NOT NULL,
  signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  insights jsonb NOT NULL DEFAULT '[]'::jsonb,
  model text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT analytics_insights_unique UNIQUE (workspace_id, range_key, fingerprint)
);

CREATE INDEX IF NOT EXISTS analytics_insights_latest_idx
  ON public.analytics_insights (workspace_id, range_key, created_at DESC);

-- ── Row-level security ────────────────────────────────────────────────────
ALTER TABLE public.google_oauth_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_ga4_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_ga4_dimension_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_gsc_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_gsc_dimension_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_insights ENABLE ROW LEVEL SECURITY;

-- Tokens: no policy and no grant for anon/authenticated — service role only.
REVOKE ALL ON public.google_oauth_credentials FROM anon, authenticated;
GRANT ALL ON public.google_oauth_credentials TO service_role;

REVOKE ALL ON
  public.analytics_sources,
  public.analytics_ga4_daily,
  public.analytics_ga4_dimension_daily,
  public.analytics_gsc_daily,
  public.analytics_gsc_dimension_daily,
  public.analytics_sync_runs,
  public.analytics_insights
FROM anon, authenticated;

GRANT SELECT ON
  public.analytics_sources,
  public.analytics_ga4_daily,
  public.analytics_ga4_dimension_daily,
  public.analytics_gsc_daily,
  public.analytics_gsc_dimension_daily,
  public.analytics_sync_runs,
  public.analytics_insights
TO authenticated;

GRANT ALL ON
  public.analytics_sources,
  public.analytics_ga4_daily,
  public.analytics_ga4_dimension_daily,
  public.analytics_gsc_daily,
  public.analytics_gsc_dimension_daily,
  public.analytics_sync_runs,
  public.analytics_insights
TO service_role;

DROP POLICY IF EXISTS "Workspace members read analytics sources" ON public.analytics_sources;
CREATE POLICY "Workspace members read analytics sources"
  ON public.analytics_sources FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Workspace members read ga4 daily" ON public.analytics_ga4_daily;
CREATE POLICY "Workspace members read ga4 daily"
  ON public.analytics_ga4_daily FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Workspace members read ga4 dimensions" ON public.analytics_ga4_dimension_daily;
CREATE POLICY "Workspace members read ga4 dimensions"
  ON public.analytics_ga4_dimension_daily FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Workspace members read gsc daily" ON public.analytics_gsc_daily;
CREATE POLICY "Workspace members read gsc daily"
  ON public.analytics_gsc_daily FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Workspace members read gsc dimensions" ON public.analytics_gsc_dimension_daily;
CREATE POLICY "Workspace members read gsc dimensions"
  ON public.analytics_gsc_dimension_daily FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Workspace members read analytics sync runs" ON public.analytics_sync_runs;
CREATE POLICY "Workspace members read analytics sync runs"
  ON public.analytics_sync_runs FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Workspace members read analytics insights" ON public.analytics_insights;
CREATE POLICY "Workspace members read analytics insights"
  ON public.analytics_insights FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

-- ── Tenant integrity: a source, and every fact row, stays in its workspace ─
CREATE OR REPLACE FUNCTION private.analytics_source_workspace_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ws uuid;
BEGIN
  IF TG_TABLE_NAME = 'analytics_sources' THEN
    SELECT workspace_id INTO v_ws FROM public.workspace_connections WHERE id = NEW.connection_id;
  ELSE
    SELECT workspace_id INTO v_ws FROM public.analytics_sources WHERE id = NEW.source_id;
  END IF;
  IF v_ws IS NULL OR v_ws <> NEW.workspace_id THEN
    RAISE EXCEPTION 'analytics row workspace does not match its parent' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.analytics_source_workspace_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS analytics_sources_workspace_guard ON public.analytics_sources;
CREATE TRIGGER analytics_sources_workspace_guard
  BEFORE INSERT OR UPDATE OF workspace_id, connection_id ON public.analytics_sources
  FOR EACH ROW EXECUTE FUNCTION private.analytics_source_workspace_guard();

DROP TRIGGER IF EXISTS analytics_sync_runs_workspace_guard ON public.analytics_sync_runs;
CREATE TRIGGER analytics_sync_runs_workspace_guard
  BEFORE INSERT OR UPDATE OF workspace_id, source_id ON public.analytics_sync_runs
  FOR EACH ROW EXECUTE FUNCTION private.analytics_source_workspace_guard();

-- Fact tables are written in bulk by the worker; the guard is per statement-row
-- but cheap (PK lookup), and guarantees a service-path bug cannot cross tenants.
DROP TRIGGER IF EXISTS analytics_ga4_daily_workspace_guard ON public.analytics_ga4_daily;
CREATE TRIGGER analytics_ga4_daily_workspace_guard
  BEFORE INSERT OR UPDATE OF workspace_id, source_id ON public.analytics_ga4_daily
  FOR EACH ROW EXECUTE FUNCTION private.analytics_source_workspace_guard();

DROP TRIGGER IF EXISTS analytics_ga4_dimension_daily_workspace_guard ON public.analytics_ga4_dimension_daily;
CREATE TRIGGER analytics_ga4_dimension_daily_workspace_guard
  BEFORE INSERT OR UPDATE OF workspace_id, source_id ON public.analytics_ga4_dimension_daily
  FOR EACH ROW EXECUTE FUNCTION private.analytics_source_workspace_guard();

DROP TRIGGER IF EXISTS analytics_gsc_daily_workspace_guard ON public.analytics_gsc_daily;
CREATE TRIGGER analytics_gsc_daily_workspace_guard
  BEFORE INSERT OR UPDATE OF workspace_id, source_id ON public.analytics_gsc_daily
  FOR EACH ROW EXECUTE FUNCTION private.analytics_source_workspace_guard();

DROP TRIGGER IF EXISTS analytics_gsc_dimension_daily_workspace_guard ON public.analytics_gsc_dimension_daily;
CREATE TRIGGER analytics_gsc_dimension_daily_workspace_guard
  BEFORE INSERT OR UPDATE OF workspace_id, source_id ON public.analytics_gsc_dimension_daily
  FOR EACH ROW EXECUTE FUNCTION private.analytics_source_workspace_guard();

DROP TRIGGER IF EXISTS google_oauth_credentials_touch_updated_at ON public.google_oauth_credentials;
CREATE TRIGGER google_oauth_credentials_touch_updated_at
  BEFORE UPDATE ON public.google_oauth_credentials
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS analytics_sources_touch_updated_at ON public.analytics_sources;
CREATE TRIGGER analytics_sources_touch_updated_at
  BEFORE UPDATE ON public.analytics_sources
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS analytics_sync_runs_touch_updated_at ON public.analytics_sync_runs;
CREATE TRIGGER analytics_sync_runs_touch_updated_at
  BEFORE UPDATE ON public.analytics_sync_runs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ── Worker lease claim ────────────────────────────────────────────────────
-- Status moves queued → running here; the runner finishes it with a
-- lease-guarded compare-and-set (locked_by = worker).
CREATE OR REPLACE FUNCTION public.claim_analytics_sync_runs(
  p_worker text,
  p_max integer DEFAULT 2,
  p_lease_seconds integer DEFAULT 150,
  p_id uuid DEFAULT NULL
)
RETURNS SETOF public.analytics_sync_runs
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.analytics_sync_runs AS r
     SET lease_until = now() + make_interval(secs => greatest(p_lease_seconds, 30)),
         locked_by = p_worker,
         attempts = r.attempts + 1,
         status = 'running',
         started_at = coalesce(r.started_at, now())
   WHERE r.id IN (
     SELECT u.id
       FROM public.analytics_sync_runs u
      WHERE u.status IN ('queued', 'running')
        AND (p_id IS NULL OR u.id = p_id)
        AND u.next_attempt_at <= now()
        AND (u.lease_until IS NULL OR u.lease_until < now())
      ORDER BY u.next_attempt_at
      LIMIT greatest(p_max, 0)
      FOR UPDATE SKIP LOCKED
   )
  RETURNING r.*;
$$;

REVOKE ALL ON FUNCTION public.claim_analytics_sync_runs(text, integer, integer, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_analytics_sync_runs(text, integer, integer, uuid)
  TO service_role;
