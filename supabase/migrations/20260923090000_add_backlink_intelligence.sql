-- Backlink Intelligence — DataForSEO-sourced backlink profiles, competitor gap
-- analysis, scored link opportunities, outreach tracking and link verification.
--
--   backlink_profiles       one per workspace + target host (config + headline)
--   backlink_runs           the leased job row AND the snapshot (display jsonb)
--   backlink_domains        CURRENT STATE per referring domain (the diff watermark)
--   backlink_links          CURRENT STATE for the ~1000-row backlink sample
--   backlink_opportunities  durable, scored, AI-enriched, outreach workflow
--   backlink_verifications  per-URL link checks from the SSRF-guarded crawler
--
-- New/lost diffing does NOT store one row per (snapshot x domain). Each
-- current-state row carries first_seen_run_id / last_seen_run_id / state, so a
-- run only has to (a) upsert what it observed with last_seen_run_id = itself and
-- (b) sweep rows it did not observe to 'lost'. That sweep is only sound when the
-- run enumerated the whole key space, which is why runs record
-- domains_truncated and sweep_backlink_domains() refuses to run when it is true.
--
-- Idempotent and non-destructive: safe to re-run.

-- ── Profiles ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.backlink_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Canonical bare host, private.normalize_domain()-shaped: "mellox.ai".
  target text NOT NULL,
  target_type text NOT NULL DEFAULT 'domain',
  include_subdomains boolean NOT NULL DEFAULT true,
  -- Up to 3 competitor bare hosts: ["a.com","b.com"]. Config, not facts.
  competitors jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Headline numbers denormalized from the latest run so the first paint is
  -- one query. The authoritative copy lives on that run.
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  latest_run_id uuid,
  last_succeeded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT backlink_profiles_target_type_check
    CHECK (target_type IN ('domain', 'subdomain', 'page')),
  CONSTRAINT backlink_profiles_target_len
    CHECK (char_length(target) BETWEEN 3 AND 253),
  CONSTRAINT backlink_profiles_competitors_shape
    CHECK (jsonb_typeof(competitors) = 'array' AND jsonb_array_length(competitors) <= 3),
  CONSTRAINT backlink_profiles_unique UNIQUE (workspace_id, target)
);

CREATE INDEX IF NOT EXISTS backlink_profiles_workspace_idx
  ON public.backlink_profiles (workspace_id, updated_at DESC);

-- ── Runs (leased job + snapshot) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.backlink_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.backlink_profiles(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  target text NOT NULL,
  trigger text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'queued',
  -- queued -> summary -> domains -> anchors -> timeseries -> links -> gap
  --        -> scoring -> enriching -> done
  stage text NOT NULL DEFAULT 'queued',
  config jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Display-only payloads. Never filtered or joined server-side.
  summary jsonb,
  anchors jsonb,
  timeseries jsonb,
  gap jsonb,
  diff jsonb,
  -- Per-endpoint {cost, rows, latencyMs, error}. Its keys are also the
  -- idempotency markers that stop a resumed run re-billing a finished stage.
  provider jsonb NOT NULL DEFAULT '{}'::jsonb,
  totals jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Soundness flags for the lost-sweep (see the header comment).
  domains_truncated boolean NOT NULL DEFAULT false,
  links_truncated boolean NOT NULL DEFAULT true,

  opportunities_count integer NOT NULL DEFAULT 0,
  ai_enriched_count integer NOT NULL DEFAULT 0,
  cost_usd numeric(10, 6) NOT NULL DEFAULT 0,

  previous_run_id uuid REFERENCES public.backlink_runs(id) ON DELETE SET NULL,
  error text,
  error_code text,
  cancel_requested boolean NOT NULL DEFAULT false,
  attempt_count integer NOT NULL DEFAULT 0,
  lease_until timestamptz,
  locked_by text,
  idempotency_key text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT backlink_runs_trigger_check
    CHECK (trigger IN ('manual', 'refresh', 'scheduled', 'onboarding')),
  CONSTRAINT backlink_runs_status_check
    CHECK (status IN ('queued', 'running', 'succeeded', 'partial', 'failed', 'cancelled')),
  CONSTRAINT backlink_runs_stage_check
    CHECK (stage IN ('queued', 'summary', 'domains', 'anchors', 'timeseries',
                     'links', 'gap', 'scoring', 'enriching', 'done'))
);

CREATE INDEX IF NOT EXISTS backlink_runs_profile_created_idx
  ON public.backlink_runs (profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS backlink_runs_workspace_created_idx
  ON public.backlink_runs (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS backlink_runs_claimable_idx
  ON public.backlink_runs (created_at) WHERE status IN ('queued', 'running');
-- One active run per profile: a second "Analyze" joins the running one.
CREATE UNIQUE INDEX IF NOT EXISTS backlink_runs_one_active_idx
  ON public.backlink_runs (profile_id) WHERE status IN ('queued', 'running');
CREATE UNIQUE INDEX IF NOT EXISTS backlink_runs_idempotency_idx
  ON public.backlink_runs (workspace_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
-- "Is there a finished run for this profile newer than the cache TTL?"
CREATE INDEX IF NOT EXISTS backlink_runs_fresh_idx
  ON public.backlink_runs (profile_id, completed_at DESC)
  WHERE status IN ('succeeded', 'partial');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'backlink_profiles_latest_run_fk'
  ) THEN
    ALTER TABLE public.backlink_profiles
      ADD CONSTRAINT backlink_profiles_latest_run_fk
      FOREIGN KEY (latest_run_id) REFERENCES public.backlink_runs(id) ON DELETE SET NULL;
  END IF;
END
$$;

-- ── Referring domains (CURRENT STATE) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.backlink_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.backlink_profiles(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  domain text NOT NULL,
  state text NOT NULL DEFAULT 'live',
  -- Filtered and sorted, so these are columns rather than jsonb.
  rank integer,
  spam_score smallint,
  backlinks integer NOT NULL DEFAULT 0,
  broken_backlinks integer NOT NULL DEFAULT 0,
  referring_pages integer NOT NULL DEFAULT 0,
  referring_pages_nofollow integer NOT NULL DEFAULT 0,
  dofollow boolean NOT NULL DEFAULT true,
  tld text,
  country text,
  platform_types text[],
  -- Display-only remainder (link type mix, attribute mix, semantic locations).
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  provider_first_seen timestamptz,
  provider_lost_date timestamptz,
  -- Diff watermarks. These columns ARE the new/lost mechanism.
  first_seen_run_id uuid NOT NULL REFERENCES public.backlink_runs(id) ON DELETE CASCADE,
  last_seen_run_id uuid NOT NULL REFERENCES public.backlink_runs(id) ON DELETE CASCADE,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  lost_at timestamptz,
  regained_at timestamptz,
  CONSTRAINT backlink_domains_state_check CHECK (state IN ('live', 'lost')),
  CONSTRAINT backlink_domains_rank_check CHECK (rank IS NULL OR rank BETWEEN 0 AND 1000),
  CONSTRAINT backlink_domains_spam_check CHECK (spam_score IS NULL OR spam_score BETWEEN 0 AND 100),
  CONSTRAINT backlink_domains_domain_len CHECK (char_length(domain) BETWEEN 3 AND 253),
  CONSTRAINT backlink_domains_unique UNIQUE (profile_id, domain)
);

CREATE INDEX IF NOT EXISTS backlink_domains_profile_rank_idx
  ON public.backlink_domains (profile_id, state, rank DESC NULLS LAST);
-- "What changed in this run": one index scan, no snapshot join.
CREATE INDEX IF NOT EXISTS backlink_domains_new_idx
  ON public.backlink_domains (first_seen_run_id);
CREATE INDEX IF NOT EXISTS backlink_domains_sweep_idx
  ON public.backlink_domains (profile_id, last_seen_run_id) WHERE state = 'live';
CREATE INDEX IF NOT EXISTS backlink_domains_lost_idx
  ON public.backlink_domains (profile_id, lost_at DESC) WHERE state = 'lost';
CREATE INDEX IF NOT EXISTS backlink_domains_workspace_idx
  ON public.backlink_domains (workspace_id);

-- ── Backlinks sample (CURRENT STATE) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.backlink_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.backlink_profiles(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- sha256(url_from \n url_to \n anchor). URLs can exceed a btree tuple, so the
  -- identity column is the digest.
  link_hash text NOT NULL,
  domain_from text NOT NULL,
  url_from text NOT NULL,
  url_to text NOT NULL,
  anchor text,
  state text NOT NULL DEFAULT 'live',
  dofollow boolean NOT NULL DEFAULT true,
  item_type text,
  attributes text[],
  rank integer,
  page_from_rank integer,
  domain_from_rank integer,
  spam_score smallint,
  is_broken boolean NOT NULL DEFAULT false,
  url_to_status_code integer,
  page_from_title text,
  semantic_location text,
  country_from text,
  provider_first_seen timestamptz,
  provider_last_seen timestamptz,
  first_seen_run_id uuid NOT NULL REFERENCES public.backlink_runs(id) ON DELETE CASCADE,
  last_seen_run_id uuid NOT NULL REFERENCES public.backlink_runs(id) ON DELETE CASCADE,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  lost_at timestamptz,
  CONSTRAINT backlink_links_state_check CHECK (state IN ('live', 'lost')),
  CONSTRAINT backlink_links_url_len
    CHECK (char_length(url_from) <= 2000 AND char_length(url_to) <= 2000),
  CONSTRAINT backlink_links_anchor_len CHECK (anchor IS NULL OR char_length(anchor) <= 500),
  CONSTRAINT backlink_links_unique UNIQUE (profile_id, link_hash)
);

CREATE INDEX IF NOT EXISTS backlink_links_profile_rank_idx
  ON public.backlink_links (profile_id, state, domain_from_rank DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS backlink_links_domain_idx
  ON public.backlink_links (profile_id, domain_from);
CREATE INDEX IF NOT EXISTS backlink_links_new_idx
  ON public.backlink_links (first_seen_run_id);
CREATE INDEX IF NOT EXISTS backlink_links_broken_idx
  ON public.backlink_links (profile_id) WHERE is_broken = true AND state = 'live';
CREATE INDEX IF NOT EXISTS backlink_links_workspace_idx
  ON public.backlink_links (workspace_id);

-- ── Opportunities (scored + AI-enriched + outreach workflow) ──────────────
CREATE TABLE IF NOT EXISTS public.backlink_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.backlink_profiles(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  domain text NOT NULL,
  kind text NOT NULL,
  -- Deterministic. Recomputed every run; never written by the browser.
  score numeric(5, 2) NOT NULL DEFAULT 0,
  tier text NOT NULL DEFAULT 'low',
  -- Every factor that produced `score`, so the UI can show the arithmetic.
  factors jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  rank integer,
  spam_score smallint,
  competitor_hits smallint NOT NULL DEFAULT 0,
  -- Set when a hard filter fired. The row is kept so the UI can say how many
  -- candidates were filtered out and why, instead of silently dropping them.
  excluded_reason text,
  suggested_target text,

  -- AI enrichment (Claude), top N only, cached by ai_input_hash.
  ai jsonb,
  ai_input_hash text,
  ai_model text,
  ai_generated_at timestamptz,

  -- Outreach: drafts and status only. Nothing is ever sent from Mellox.
  outreach_status text NOT NULL DEFAULT 'none',
  outreach_draft jsonb,
  outreach_note text,
  outreach_contact jsonb,
  outreach_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  outreach_updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  outreach_updated_at timestamptz,

  first_run_id uuid NOT NULL REFERENCES public.backlink_runs(id) ON DELETE CASCADE,
  last_run_id uuid NOT NULL REFERENCES public.backlink_runs(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT backlink_opportunities_kind_check
    CHECK (kind IN ('gap', 'reclaim', 'broken', 'nofollow_upgrade')),
  CONSTRAINT backlink_opportunities_tier_check CHECK (tier IN ('high', 'medium', 'low')),
  CONSTRAINT backlink_opportunities_score_check CHECK (score BETWEEN 0 AND 100),
  CONSTRAINT backlink_opportunities_status_check
    CHECK (outreach_status IN ('none', 'queued', 'drafted', 'contacted',
                               'replied', 'won', 'lost', 'ignored')),
  CONSTRAINT backlink_opportunities_note_len
    CHECK (outreach_note IS NULL OR char_length(outreach_note) <= 2000),
  CONSTRAINT backlink_opportunities_history_shape
    CHECK (jsonb_typeof(outreach_history) = 'array'
           AND jsonb_array_length(outreach_history) <= 50),
  CONSTRAINT backlink_opportunities_unique UNIQUE (profile_id, domain, kind)
);

-- Guarded on the column that only this generation of the table has. A later
-- migration drops this table and rebuilds it with a different shape, so on a
-- replay the CREATE TABLE above is a no-op and these indexes would name
-- columns that no longer exist.
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'backlink_opportunities'
                AND column_name = 'excluded_reason') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS backlink_opportunities_profile_score_idx
               ON public.backlink_opportunities (profile_id, score DESC)
               WHERE excluded_reason IS NULL';
    EXECUTE 'CREATE INDEX IF NOT EXISTS backlink_opportunities_pipeline_idx
               ON public.backlink_opportunities (profile_id, outreach_status, score DESC)';
  END IF;
END;
$guard$;

CREATE INDEX IF NOT EXISTS backlink_opportunities_workspace_idx
  ON public.backlink_opportunities (workspace_id);

-- ── Verifications (SSRF-guarded per-URL link checks) ──────────────────────
CREATE TABLE IF NOT EXISTS public.backlink_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.backlink_profiles(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  opportunity_id uuid REFERENCES public.backlink_opportunities(id) ON DELETE SET NULL,
  url_from text NOT NULL,
  url_from_hash text NOT NULL,
  expected_target text,
  result text NOT NULL DEFAULT 'pending',
  http_status integer,
  final_url text,
  link_found boolean,
  target_matches boolean,
  anchor_found text,
  rel_values text[],
  is_nofollow boolean,
  is_sponsored boolean,
  is_ugc boolean,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  checked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT backlink_verifications_result_check
    CHECK (result IN ('pending', 'live', 'nofollow', 'wrong_target',
                      'missing', 'unreachable', 'blocked')),
  CONSTRAINT backlink_verifications_url_len CHECK (char_length(url_from) <= 2000),
  CONSTRAINT backlink_verifications_unique UNIQUE (profile_id, url_from_hash)
);

-- Same guard: a later generation of backlink_verifications has no profile_id.
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'backlink_verifications'
                AND column_name = 'profile_id') THEN
    EXECUTE 'CREATE INDEX IF NOT EXISTS backlink_verifications_profile_idx
               ON public.backlink_verifications (profile_id, checked_at DESC)';
  END IF;
END;
$guard$;
CREATE INDEX IF NOT EXISTS backlink_verifications_workspace_idx
  ON public.backlink_verifications (workspace_id);

-- ── Row-level security ────────────────────────────────────────────────────
-- Workspace members read. Nobody but service_role writes: scores, runs and
-- provider data are server-computed, and outreach drafts (which are user
-- content) still go through a server function that checks the editor role.
ALTER TABLE public.backlink_profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backlink_runs          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backlink_domains       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backlink_links         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backlink_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backlink_verifications ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.backlink_profiles, public.backlink_runs, public.backlink_domains,
               public.backlink_links, public.backlink_opportunities,
               public.backlink_verifications
  FROM anon, authenticated;

GRANT SELECT ON public.backlink_profiles, public.backlink_runs, public.backlink_domains,
                public.backlink_links, public.backlink_opportunities,
                public.backlink_verifications
  TO authenticated;

GRANT ALL ON public.backlink_profiles, public.backlink_runs, public.backlink_domains,
             public.backlink_links, public.backlink_opportunities,
             public.backlink_verifications
  TO service_role;

DROP POLICY IF EXISTS "Workspace members read backlink profiles" ON public.backlink_profiles;
CREATE POLICY "Workspace members read backlink profiles"
  ON public.backlink_profiles FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Workspace members read backlink runs" ON public.backlink_runs;
CREATE POLICY "Workspace members read backlink runs"
  ON public.backlink_runs FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Workspace members read backlink domains" ON public.backlink_domains;
CREATE POLICY "Workspace members read backlink domains"
  ON public.backlink_domains FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Workspace members read backlink links" ON public.backlink_links;
CREATE POLICY "Workspace members read backlink links"
  ON public.backlink_links FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Workspace members read backlink opportunities"
  ON public.backlink_opportunities;
CREATE POLICY "Workspace members read backlink opportunities"
  ON public.backlink_opportunities FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Workspace members read backlink verifications"
  ON public.backlink_verifications;
CREATE POLICY "Workspace members read backlink verifications"
  ON public.backlink_verifications FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

-- ── Child-table workspace guard ───────────────────────────────────────────
-- A service-path bug must fail rather than cross tenants.
CREATE OR REPLACE FUNCTION private.backlink_profile_workspace_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ws uuid;
BEGIN
  SELECT workspace_id INTO v_ws FROM public.backlink_profiles WHERE id = NEW.profile_id;
  IF v_ws IS NULL OR v_ws <> NEW.workspace_id THEN
    RAISE EXCEPTION 'backlink row workspace does not match its profile' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.backlink_profile_workspace_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS backlink_runs_workspace_guard ON public.backlink_runs;
CREATE TRIGGER backlink_runs_workspace_guard
  BEFORE INSERT OR UPDATE OF workspace_id, profile_id ON public.backlink_runs
  FOR EACH ROW EXECUTE FUNCTION private.backlink_profile_workspace_guard();

DROP TRIGGER IF EXISTS backlink_domains_workspace_guard ON public.backlink_domains;
CREATE TRIGGER backlink_domains_workspace_guard
  BEFORE INSERT OR UPDATE OF workspace_id, profile_id ON public.backlink_domains
  FOR EACH ROW EXECUTE FUNCTION private.backlink_profile_workspace_guard();

DROP TRIGGER IF EXISTS backlink_links_workspace_guard ON public.backlink_links;
CREATE TRIGGER backlink_links_workspace_guard
  BEFORE INSERT OR UPDATE OF workspace_id, profile_id ON public.backlink_links
  FOR EACH ROW EXECUTE FUNCTION private.backlink_profile_workspace_guard();

-- Guarded for the same reason as the indexes above: these triggers fire on a
-- column that only this generation of the tables has.
DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'backlink_opportunities'
                AND column_name = 'profile_id') THEN
    EXECUTE 'DROP TRIGGER IF EXISTS backlink_opportunities_workspace_guard
               ON public.backlink_opportunities';
    EXECUTE 'CREATE TRIGGER backlink_opportunities_workspace_guard
               BEFORE INSERT OR UPDATE OF workspace_id, profile_id
               ON public.backlink_opportunities
               FOR EACH ROW EXECUTE FUNCTION private.backlink_profile_workspace_guard()';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'backlink_verifications'
                AND column_name = 'profile_id') THEN
    EXECUTE 'DROP TRIGGER IF EXISTS backlink_verifications_workspace_guard
               ON public.backlink_verifications';
    EXECUTE 'CREATE TRIGGER backlink_verifications_workspace_guard
               BEFORE INSERT OR UPDATE OF workspace_id, profile_id
               ON public.backlink_verifications
               FOR EACH ROW EXECUTE FUNCTION private.backlink_profile_workspace_guard()';
  END IF;
END;
$guard$;

DROP TRIGGER IF EXISTS backlink_profiles_touch_updated_at ON public.backlink_profiles;
CREATE TRIGGER backlink_profiles_touch_updated_at
  BEFORE UPDATE ON public.backlink_profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS backlink_runs_touch_updated_at ON public.backlink_runs;
CREATE TRIGGER backlink_runs_touch_updated_at
  BEFORE UPDATE ON public.backlink_runs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS backlink_opportunities_touch_updated_at ON public.backlink_opportunities;
CREATE TRIGGER backlink_opportunities_touch_updated_at
  BEFORE UPDATE ON public.backlink_opportunities
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ── Job claiming ──────────────────────────────────────────────────────────
-- Claims queued runs, and running runs whose lease expired (worker died, deploy,
-- or a slice yielded at its time budget). SKIP LOCKED so overlapping cron calls
-- and the in-request after() kick never take the same run.
CREATE OR REPLACE FUNCTION public.claim_backlink_runs(
  p_worker text,
  p_max integer DEFAULT 2,
  p_lease_seconds integer DEFAULT 120,
  p_run_id uuid DEFAULT NULL
)
RETURNS SETOF public.backlink_runs
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.backlink_runs AS r
     SET lease_until = now() + make_interval(secs => greatest(p_lease_seconds, 30)),
         locked_by = p_worker,
         attempt_count = r.attempt_count + 1,
         status = CASE WHEN r.status = 'queued' THEN 'running' ELSE r.status END,
         started_at = coalesce(r.started_at, now())
   WHERE r.id IN (
     SELECT b.id
       FROM public.backlink_runs b
      WHERE b.status IN ('queued', 'running')
        AND (p_run_id IS NULL OR b.id = p_run_id)
        AND (b.lease_until IS NULL OR b.lease_until < now())
      ORDER BY b.created_at
      LIMIT greatest(p_max, 0)
      FOR UPDATE SKIP LOCKED
   )
  RETURNING r.*;
$$;

REVOKE ALL ON FUNCTION public.claim_backlink_runs(text, integer, integer, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_backlink_runs(text, integer, integer, uuid) TO service_role;

-- ── Lost-domain sweep ─────────────────────────────────────────────────────
-- Marks referring domains the run did not observe as lost. Only sound when the
-- run enumerated every referring domain, so it refuses when domains_truncated.
CREATE OR REPLACE FUNCTION public.sweep_backlink_domains(p_run_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile uuid;
  v_truncated boolean;
  v_lost integer;
BEGIN
  SELECT profile_id, domains_truncated INTO v_profile, v_truncated
    FROM public.backlink_runs WHERE id = p_run_id;
  IF v_profile IS NULL OR v_truncated THEN RETURN 0; END IF;

  UPDATE public.backlink_domains
     SET state = 'lost', lost_at = now()
   WHERE profile_id = v_profile
     AND state = 'live'
     AND last_seen_run_id <> p_run_id;
  GET DIAGNOSTICS v_lost = ROW_COUNT;
  RETURN v_lost;
END;
$$;

REVOKE ALL ON FUNCTION public.sweep_backlink_domains(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_backlink_domains(uuid) TO service_role;

-- ── Retention ─────────────────────────────────────────────────────────────
-- Row count per profile is "distinct domains/links ever seen", not runs x rows,
-- so this only trims the long tail.
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
  v_backlink_links integer;
  v_backlink_domains integer;
  v_backlink_runs integer;
BEGIN
  DELETE FROM public.sdr_webhook_events WHERE received_at < now() - interval '30 days';
  GET DIAGNOSTICS v_webhooks = ROW_COUNT;
  DELETE FROM public.guardrail_events WHERE created_at < now() - interval '90 days';
  GET DIAGNOSTICS v_guardrails = ROW_COUNT;
  -- Raw events for 13 months; the daily rollup is kept indefinitely.
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

  DELETE FROM public.backlink_links
   WHERE state = 'lost' AND lost_at < now() - interval '90 days';
  GET DIAGNOSTICS v_backlink_links = ROW_COUNT;
  DELETE FROM public.backlink_domains
   WHERE state = 'lost' AND lost_at < now() - interval '365 days';
  GET DIAGNOSTICS v_backlink_domains = ROW_COUNT;
  -- Older runs keep their timeseries and totals (that is the history chart);
  -- only the bulky display payloads go.
  UPDATE public.backlink_runs
     SET summary = NULL, anchors = NULL, gap = NULL, diff = NULL
   WHERE summary IS NOT NULL AND created_at < now() - interval '180 days';
  GET DIAGNOSTICS v_backlink_runs = ROW_COUNT;

  RETURN jsonb_build_object(
    'sdr_webhook_events', v_webhooks,
    'guardrail_events', v_guardrails,
    'ai_usage_events', v_usage,
    'geo_scan_page_evidence', v_geo_pages,
    'geo_fix_proposal_files', v_fix_files,
    'geo_fix_batch_files', v_batch_files,
    'backlink_links', v_backlink_links,
    'backlink_domains', v_backlink_domains,
    'backlink_run_payloads', v_backlink_runs
  );
END;
$$;

REVOKE ALL ON FUNCTION public.prune_operational_logs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_operational_logs() TO service_role;
