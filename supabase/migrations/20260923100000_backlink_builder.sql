-- Backlink Builder — real, published backlinks.
--
-- Mellox does not buy, scrape or auto-spam links. A workspace connects a
-- platform it already has an account on (Dev.to, Hashnode), Mellox publishes a
-- real article there containing a real link back to one of the workspace's
-- pages, and then fetches that published page to confirm the link is live.
-- Every row in backlink_placements is a link that exists on the public web.
--
--   backlink_accounts    one connected publishing account per workspace+provider
--   backlink_placements  one published post, and the link it carries
--
-- Replaces the DataForSEO analysis tables from 20260923090000, which were
-- never used in production (they held no rows) and have been removed along
-- with the feature. Dropping is safe and keeps the schema honest.

DROP FUNCTION IF EXISTS public.claim_backlink_runs(text, integer, integer, uuid);
DROP FUNCTION IF EXISTS public.sweep_backlink_domains(uuid);
DROP FUNCTION IF EXISTS public.upsert_backlink_domains(uuid, jsonb);
DROP FUNCTION IF EXISTS public.upsert_backlink_links(uuid, jsonb);
DROP FUNCTION IF EXISTS public.upsert_backlink_opportunities(uuid, jsonb);

DROP TABLE IF EXISTS public.backlink_verifications CASCADE;
DROP TABLE IF EXISTS public.backlink_opportunities CASCADE;
DROP TABLE IF EXISTS public.backlink_links CASCADE;
DROP TABLE IF EXISTS public.backlink_domains CASCADE;
DROP TABLE IF EXISTS public.backlink_runs CASCADE;
DROP TABLE IF EXISTS public.backlink_profiles CASCADE;

DROP FUNCTION IF EXISTS private.backlink_profile_workspace_guard();

-- ── Connected publishing accounts ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.backlink_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  provider text NOT NULL,
  -- Who the token belongs to on that platform, confirmed by the provider's own
  -- "who am I" call at connect time. Display only.
  external_username text,
  external_id text,
  profile_url text,
  -- Where posts go (Hashnode needs a publication; Dev.to does not).
  publication_id text,
  publication_url text,
  -- AES-GCM via src/server/crypto/secret-box.server.ts. NEVER returned to a
  -- browser: present.ts maps rows without it and RLS grants no direct read.
  token_encrypted text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  last_error text,
  last_checked_at timestamptz,
  connected_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT backlink_accounts_provider_check CHECK (provider IN ('devto', 'hashnode')),
  CONSTRAINT backlink_accounts_status_check CHECK (status IN ('active', 'invalid', 'revoked')),
  -- One account per platform per workspace: reconnecting replaces the token.
  CONSTRAINT backlink_accounts_unique UNIQUE (workspace_id, provider)
);

CREATE INDEX IF NOT EXISTS backlink_accounts_workspace_idx
  ON public.backlink_accounts (workspace_id, provider);

-- ── Published placements (the backlinks themselves) ───────────────────────
CREATE TABLE IF NOT EXISTS public.backlink_placements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  account_id uuid REFERENCES public.backlink_accounts(id) ON DELETE SET NULL,
  provider text NOT NULL,

  -- The link this placement exists to create.
  target_url text NOT NULL,
  target_host text NOT NULL,
  anchor text NOT NULL,

  title text NOT NULL,
  body_markdown text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',

  status text NOT NULL DEFAULT 'draft',
  -- What the platform gave back once published.
  external_id text,
  live_url text,
  published_at timestamptz,

  -- Proof the link is actually on the published page, from our own fetch.
  verification text NOT NULL DEFAULT 'pending',
  verified_at timestamptz,
  link_found boolean,
  is_nofollow boolean,
  anchor_found text,
  http_status integer,
  verification_error text,

  error text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT backlink_placements_provider_check CHECK (provider IN ('devto', 'hashnode')),
  CONSTRAINT backlink_placements_status_check
    CHECK (status IN ('draft', 'publishing', 'published', 'failed', 'removed')),
  CONSTRAINT backlink_placements_verification_check
    CHECK (verification IN ('pending', 'live', 'nofollow', 'missing', 'unreachable', 'blocked')),
  CONSTRAINT backlink_placements_url_len CHECK (char_length(target_url) <= 2000),
  CONSTRAINT backlink_placements_anchor_len CHECK (char_length(anchor) BETWEEN 1 AND 300),
  CONSTRAINT backlink_placements_title_len CHECK (char_length(title) BETWEEN 1 AND 250),
  CONSTRAINT backlink_placements_body_len CHECK (char_length(body_markdown) <= 60000)
);

CREATE INDEX IF NOT EXISTS backlink_placements_workspace_idx
  ON public.backlink_placements (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS backlink_placements_live_idx
  ON public.backlink_placements (workspace_id, verification)
  WHERE status = 'published';
CREATE INDEX IF NOT EXISTS backlink_placements_target_idx
  ON public.backlink_placements (workspace_id, target_host);
-- The same post is never published twice to the same platform.
CREATE UNIQUE INDEX IF NOT EXISTS backlink_placements_external_idx
  ON public.backlink_placements (provider, external_id)
  WHERE external_id IS NOT NULL;

-- ── Row-level security ────────────────────────────────────────────────────
-- Members read. Nobody but service_role writes: tokens and publish results are
-- server-owned, and every write goes through an editor-role server function.
ALTER TABLE public.backlink_accounts   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backlink_placements ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.backlink_accounts, public.backlink_placements FROM anon, authenticated;
GRANT SELECT ON public.backlink_placements TO authenticated;
-- Deliberately NOT granted on backlink_accounts: that table holds an encrypted
-- token, so it is read server-side only and presented through a server fn.
GRANT ALL ON public.backlink_accounts, public.backlink_placements TO service_role;

DROP POLICY IF EXISTS "Workspace members read backlink placements" ON public.backlink_placements;
CREATE POLICY "Workspace members read backlink placements"
  ON public.backlink_placements FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP TRIGGER IF EXISTS backlink_accounts_touch_updated_at ON public.backlink_accounts;
CREATE TRIGGER backlink_accounts_touch_updated_at
  BEFORE UPDATE ON public.backlink_accounts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS backlink_placements_touch_updated_at ON public.backlink_placements;
CREATE TRIGGER backlink_placements_touch_updated_at
  BEFORE UPDATE ON public.backlink_placements
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ── Retention: drop the backlink branches that referenced the old tables ──
CREATE OR REPLACE FUNCTION public.prune_operational_logs()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_webhooks integer;
  v_guardrails integer;
  v_usage integer;
  v_geo_pages integer;
  v_fix_files integer;
  v_batch_files integer;
BEGIN
  DELETE FROM public.sdr_webhook_events WHERE received_at < now() - interval '30 days';
  GET DIAGNOSTICS v_webhooks = ROW_COUNT;
  DELETE FROM public.guardrail_events WHERE created_at < now() - interval '90 days';
  GET DIAGNOSTICS v_guardrails = ROW_COUNT;
  DELETE FROM public.ai_usage_events WHERE created_at < now() - interval '13 months';
  GET DIAGNOSTICS v_usage = ROW_COUNT;
  UPDATE public.geo_scan_pages
     SET analysis = NULL
   WHERE analysis IS NOT NULL AND created_at < now() - interval '180 days';
  GET DIAGNOSTICS v_geo_pages = ROW_COUNT;
  UPDATE public.geo_fix_proposals
     SET files = coalesce((
           SELECT jsonb_agg(jsonb_build_object('path', f->>'path', 'action', f->>'action'))
             FROM jsonb_array_elements(files) AS f
         ), '[]'::jsonb),
         files_purged_at = now()
   WHERE files_purged_at IS NULL
     AND status IN ('verified', 'not_verified', 'failed', 'discarded', 'stale', 'closed', 'access_lost')
     AND updated_at < now() - interval '30 days';
  GET DIAGNOSTICS v_fix_files = ROW_COUNT;
  UPDATE public.geo_fix_batches
     SET files = coalesce((
           SELECT jsonb_agg(jsonb_build_object('path', f->>'path', 'action', f->>'action'))
             FROM jsonb_array_elements(files) AS f
         ), '[]'::jsonb),
         files_purged_at = now()
   WHERE files_purged_at IS NULL
     AND status IN ('completed', 'closed', 'failed', 'discarded', 'stale', 'access_lost')
     AND updated_at < now() - interval '30 days';
  GET DIAGNOSTICS v_batch_files = ROW_COUNT;
  RETURN jsonb_build_object(
    'sdr_webhook_events', v_webhooks,
    'guardrail_events', v_guardrails,
    'ai_usage_events', v_usage,
    'geo_scan_page_evidence', v_geo_pages,
    'geo_fix_proposal_files', v_fix_files,
    'geo_fix_batch_files', v_batch_files
  );
END;
$$;

REVOKE ALL ON FUNCTION public.prune_operational_logs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_operational_logs() TO service_role;

-- The analysis cron hook no longer exists.
DO $$
BEGIN
  IF to_regnamespace('cron') IS NOT NULL
     AND EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mellox-backlink-runs') THEN
    PERFORM cron.unschedule('mellox-backlink-runs');
  END IF;
END
$$;
