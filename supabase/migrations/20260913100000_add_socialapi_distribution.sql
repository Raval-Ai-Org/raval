-- SocialAPI.ai as a distribution provider (docs/adr/0009-socialapi-distribution-provider.md).
--
-- SocialAPI.ai sits behind the same pipeline as the SDR: content_items →
-- content_publications (per-destination delivery mirror) → signed webhook →
-- reconcile sweep. This migration only ADDS schema; nothing existing is
-- dropped or rewritten. Idempotent (required for migrations from 2026-09-11).
--
-- Tenant isolation model:
--   * one Mellox workspace ↔ one SocialAPI brand (workspace_socialapi). The
--     provider scopes accounts to a brand, and every server call filters by
--     the workspace's own brand_id — never by an id the browser supplies.
--   * provider credentials never live in the database; the API key is a
--     server-only environment variable.
--   * browser clients may READ their own workspace's accounts, deliveries and
--     usage (RLS); every write goes through the server with the service role.

-- ─── workspace ↔ brand mapping (server-only) ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workspace_socialapi (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL UNIQUE REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- Provider ids are opaque strings (SocialAPI reliability guide): text, not uuid.
  brand_id text,
  status text NOT NULL DEFAULT 'provisioning'
    CHECK (status IN ('provisioning', 'active', 'error')),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS workspace_socialapi_brand_idx
  ON public.workspace_socialapi (brand_id) WHERE brand_id IS NOT NULL;

ALTER TABLE public.workspace_socialapi ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_socialapi FROM anon, authenticated;
GRANT ALL ON public.workspace_socialapi TO service_role;

-- ─── connected social accounts (mirror of the provider's account list) ──────
CREATE TABLE IF NOT EXISTS public.social_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'socialapi',
  provider_account_id text NOT NULL,
  brand_id text,
  platform text NOT NULL,
  username text,
  display_name text,
  avatar_url text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'reconnect_required', 'disconnected')),
  reconnect_reason text,
  connected_by uuid,
  connected_at timestamptz NOT NULL DEFAULT now(),
  disconnected_at timestamptz,
  last_synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_account_id)
);

CREATE INDEX IF NOT EXISTS social_accounts_workspace_idx
  ON public.social_accounts (workspace_id, status);

ALTER TABLE public.social_accounts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_accounts FROM anon, authenticated;
GRANT SELECT ON public.social_accounts TO authenticated;
GRANT ALL ON public.social_accounts TO service_role;

DROP POLICY IF EXISTS "Members read workspace social accounts" ON public.social_accounts;
CREATE POLICY "Members read workspace social accounts" ON public.social_accounts
  FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

-- ─── OAuth connect state (CSRF + tenant binding, server-only) ───────────────
-- The raw state value travels through the provider and back; only its SHA-256
-- is stored, so a database read cannot be replayed into the callback.
CREATE TABLE IF NOT EXISTS public.social_oauth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_hash text NOT NULL UNIQUE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  provider text NOT NULL DEFAULT 'socialapi',
  platform text NOT NULL,
  connection_id text,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS social_oauth_states_expiry_idx
  ON public.social_oauth_states (expires_at);

ALTER TABLE public.social_oauth_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_oauth_states FROM anon, authenticated;
GRANT ALL ON public.social_oauth_states TO service_role;

-- ─── post-credit ledger (plan quota + reporting) ────────────────────────────
-- One row per provider operation that consumes a post credit (publish,
-- schedule, retry). Append-only; the quota check counts the current month.
CREATE TABLE IF NOT EXISTS public.social_usage_events (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'socialapi',
  operation text NOT NULL CHECK (operation IN ('publish', 'schedule', 'retry')),
  provider_post_id text,
  content_item_id uuid REFERENCES public.content_items(id) ON DELETE SET NULL,
  user_id uuid,
  targets int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS social_usage_events_workspace_idx
  ON public.social_usage_events (workspace_id, created_at DESC);

ALTER TABLE public.social_usage_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_usage_events FROM anon, authenticated;
GRANT SELECT ON public.social_usage_events TO authenticated;
GRANT ALL ON public.social_usage_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.social_usage_events_id_seq TO service_role;

DROP POLICY IF EXISTS "Members read workspace social usage" ON public.social_usage_events;
CREATE POLICY "Members read workspace social usage" ON public.social_usage_events
  FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

-- ─── delivery mirror: provider + engagement metrics ─────────────────────────
-- For SocialAPI rows: sdr_post_id holds the provider post id and sdr_target_id
-- the target account id (one delivery per account per post). The column names
-- predate the provider split and are kept to avoid a breaking rename.
ALTER TABLE public.content_publications
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'sdr',
  ADD COLUMN IF NOT EXISTS error_code text,
  ADD COLUMN IF NOT EXISTS metrics jsonb,
  ADD COLUMN IF NOT EXISTS metrics_synced_at timestamptz;

CREATE INDEX IF NOT EXISTS publications_provider_post_idx
  ON public.content_publications (provider, sdr_post_id);
CREATE INDEX IF NOT EXISTS publications_ws_delivered_idx
  ON public.content_publications (workspace_id, delivered_at DESC);

COMMENT ON COLUMN public.content_publications.sdr_post_id IS
  'Provider post/job id (SDR job id, or SocialAPI post id when provider = socialapi).';
COMMENT ON COLUMN public.content_publications.sdr_target_id IS
  'Provider delivery id (SDR target id, or the SocialAPI account id when provider = socialapi).';

-- ─── webhook receipts: provider + delivery-id deduplication ─────────────────
ALTER TABLE public.sdr_webhook_events
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'sdr',
  ADD COLUMN IF NOT EXISTS delivery_id text;

ALTER TABLE public.sdr_webhook_events DROP CONSTRAINT IF EXISTS sdr_webhook_events_outcome_check;
ALTER TABLE public.sdr_webhook_events ADD CONSTRAINT sdr_webhook_events_outcome_check
  CHECK (outcome IN ('verified', 'rejected', 'stale', 'unknown', 'malformed', 'duplicate', 'ignored'));

-- Only verified deliveries claim their id, so a forged request cannot burn a
-- real delivery id ahead of the genuine one.
CREATE UNIQUE INDEX IF NOT EXISTS sdr_webhook_events_delivery_idx
  ON public.sdr_webhook_events (provider, delivery_id)
  WHERE delivery_id IS NOT NULL AND outcome = 'verified';
