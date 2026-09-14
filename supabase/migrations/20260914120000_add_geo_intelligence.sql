-- AI Visibility intelligence (GEO / AEO / SEO) — multi-page scans.
--
-- Replaces the single-page, browser-persisted audit with durable scan jobs:
--   geo_scans           one row per scan (quick = homepage, full = crawl), leased
--                       by the worker so a scan survives restarts and timeouts
--   geo_scan_pages      the crawl frontier and per-page evidence (no raw HTML)
--   geo_findings        explainable findings with fingerprints for comparison
--   geo_finding_states  workflow state (open / in progress / resolved / dismissed)
--                       per fingerprint, so it carries across rescans
--
-- All writes to scans, pages and findings come from the server (service role):
-- authenticated users can read their workspace's rows and set finding states,
-- nothing else. geo_audit_runs keeps its readers (Analytics, Coach, suggestions)
-- but is now written only by the worker — the browser can no longer insert a
-- score of its choosing.
--
-- Idempotent and non-destructive: safe to re-run.

CREATE TABLE IF NOT EXISTS public.geo_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  url text NOT NULL,
  origin text NOT NULL,
  host text NOT NULL,
  mode text NOT NULL DEFAULT 'full',
  trigger text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'queued',
  stage text NOT NULL DEFAULT 'queued',
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  site jsonb NOT NULL DEFAULT '{}'::jsonb,
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  overall_score integer,
  category_scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  report jsonb,
  probes jsonb,
  previous_scan_id uuid REFERENCES public.geo_scans(id) ON DELETE SET NULL,
  scheduled_job_id uuid REFERENCES public.scheduled_jobs(id) ON DELETE SET NULL,
  error text,
  cancel_requested boolean NOT NULL DEFAULT false,
  attempt_count integer NOT NULL DEFAULT 0,
  lease_until timestamptz,
  locked_by text,
  idempotency_key text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT geo_scans_mode_check CHECK (mode IN ('quick', 'full')),
  CONSTRAINT geo_scans_trigger_check CHECK (trigger IN ('manual', 'scheduled', 'rescan', 'chat')),
  CONSTRAINT geo_scans_status_check
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  CONSTRAINT geo_scans_stage_check
    CHECK (stage IN ('queued', 'discovering', 'crawling', 'analyzing', 'probing', 'done')),
  CONSTRAINT geo_scans_score_check CHECK (overall_score IS NULL OR overall_score BETWEEN 0 AND 100)
);

CREATE INDEX IF NOT EXISTS geo_scans_workspace_created_idx
  ON public.geo_scans (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS geo_scans_workspace_host_idx
  ON public.geo_scans (workspace_id, host, created_at DESC);
CREATE INDEX IF NOT EXISTS geo_scans_claimable_idx
  ON public.geo_scans (created_at) WHERE status IN ('queued', 'running');
-- One full crawl at a time per workspace; quick checks finish inline.
CREATE UNIQUE INDEX IF NOT EXISTS geo_scans_one_active_full_idx
  ON public.geo_scans (workspace_id) WHERE status IN ('queued', 'running') AND mode = 'full';
CREATE UNIQUE INDEX IF NOT EXISTS geo_scans_idempotency_idx
  ON public.geo_scans (workspace_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.geo_scan_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id uuid NOT NULL REFERENCES public.geo_scans(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  url text NOT NULL,
  final_url text,
  depth integer NOT NULL DEFAULT 0,
  state text NOT NULL DEFAULT 'pending',
  status_code integer,
  content_type text,
  fetch_ms integer,
  skip_reason text,
  x_robots_tag text,
  analysis jsonb,
  score integer,
  category_scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  issues integer NOT NULL DEFAULT 0,
  fetched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT geo_scan_pages_state_check CHECK (state IN ('pending', 'fetched', 'failed', 'skipped')),
  CONSTRAINT geo_scan_pages_url_unique UNIQUE (scan_id, url)
);

CREATE INDEX IF NOT EXISTS geo_scan_pages_frontier_idx
  ON public.geo_scan_pages (scan_id, state, depth, created_at);
CREATE INDEX IF NOT EXISTS geo_scan_pages_workspace_idx ON public.geo_scan_pages (workspace_id);

CREATE TABLE IF NOT EXISTS public.geo_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id uuid NOT NULL REFERENCES public.geo_scans(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  page_id uuid REFERENCES public.geo_scan_pages(id) ON DELETE SET NULL,
  page_url text,
  rule_id text NOT NULL,
  category text NOT NULL,
  status text NOT NULL,
  severity text NOT NULL,
  priority text NOT NULL,
  priority_score numeric(5, 3) NOT NULL DEFAULT 0,
  title text NOT NULL,
  detail text NOT NULL DEFAULT '',
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  fingerprint text NOT NULL,
  point_impact numeric(6, 2) NOT NULL DEFAULT 0,
  fix_id text,
  safety text NOT NULL DEFAULT 'manual_review',
  effort text NOT NULL DEFAULT 'medium',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT geo_findings_status_check CHECK (status IN ('warn', 'fail')),
  CONSTRAINT geo_findings_severity_check CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  CONSTRAINT geo_findings_priority_check CHECK (priority IN ('critical', 'high', 'medium', 'low'))
);

CREATE INDEX IF NOT EXISTS geo_findings_scan_idx
  ON public.geo_findings (scan_id, priority_score DESC);
CREATE INDEX IF NOT EXISTS geo_findings_page_idx ON public.geo_findings (page_id);
CREATE INDEX IF NOT EXISTS geo_findings_workspace_fingerprint_idx
  ON public.geo_findings (workspace_id, fingerprint);

CREATE TABLE IF NOT EXISTS public.geo_finding_states (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  fingerprint text NOT NULL,
  state text NOT NULL DEFAULT 'open',
  note text,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, fingerprint),
  CONSTRAINT geo_finding_states_state_check
    CHECK (state IN ('open', 'in_progress', 'resolved', 'dismissed')),
  CONSTRAINT geo_finding_states_note_length CHECK (note IS NULL OR char_length(note) <= 1000)
);

-- ── Row-level security ────────────────────────────────────────────────────
ALTER TABLE public.geo_scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.geo_scan_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.geo_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.geo_finding_states ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.geo_scans, public.geo_scan_pages, public.geo_findings FROM anon, authenticated;
REVOKE ALL ON public.geo_finding_states FROM anon;
GRANT SELECT ON public.geo_scans, public.geo_scan_pages, public.geo_findings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.geo_finding_states TO authenticated;
GRANT ALL ON public.geo_scans, public.geo_scan_pages, public.geo_findings, public.geo_finding_states
  TO service_role;

DROP POLICY IF EXISTS "Workspace members read geo scans" ON public.geo_scans;
CREATE POLICY "Workspace members read geo scans"
  ON public.geo_scans FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Workspace members read geo scan pages" ON public.geo_scan_pages;
CREATE POLICY "Workspace members read geo scan pages"
  ON public.geo_scan_pages FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Workspace members read geo findings" ON public.geo_findings;
CREATE POLICY "Workspace members read geo findings"
  ON public.geo_findings FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

-- Role checks (editor+) are enforced by the API before a write; RLS keeps
-- every state row inside its workspace and attributed to its author.
DROP POLICY IF EXISTS "Workspace members read finding states" ON public.geo_finding_states;
CREATE POLICY "Workspace members read finding states"
  ON public.geo_finding_states FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Workspace members write finding states" ON public.geo_finding_states;
CREATE POLICY "Workspace members write finding states"
  ON public.geo_finding_states FOR INSERT TO authenticated
  WITH CHECK (
    private.is_workspace_member(workspace_id, auth.uid())
    AND (updated_by IS NULL OR updated_by = auth.uid())
  );

DROP POLICY IF EXISTS "Workspace members update finding states" ON public.geo_finding_states;
CREATE POLICY "Workspace members update finding states"
  ON public.geo_finding_states FOR UPDATE TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (
    private.is_workspace_member(workspace_id, auth.uid())
    AND (updated_by IS NULL OR updated_by = auth.uid())
  );

DROP POLICY IF EXISTS "Workspace members delete finding states" ON public.geo_finding_states;
CREATE POLICY "Workspace members delete finding states"
  ON public.geo_finding_states FOR DELETE TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

-- The worker writes audit history now; the browser no longer inserts scores.
DROP POLICY IF EXISTS "Workspace members insert geo_audit_runs" ON public.geo_audit_runs;

DROP TRIGGER IF EXISTS geo_scans_touch_updated_at ON public.geo_scans;
CREATE TRIGGER geo_scans_touch_updated_at
  BEFORE UPDATE ON public.geo_scans
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ── Worker lease claim ────────────────────────────────────────────────────
-- Claims queued scans and running scans whose lease expired (a worker died or
-- yielded). FOR UPDATE SKIP LOCKED: overlapping cron calls and the in-request
-- kick never process the same scan at once.
CREATE OR REPLACE FUNCTION public.claim_geo_scans(
  p_worker text,
  p_max integer DEFAULT 2,
  p_lease_seconds integer DEFAULT 150,
  p_scan_id uuid DEFAULT NULL
)
RETURNS SETOF public.geo_scans
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.geo_scans AS s
     SET lease_until = now() + make_interval(secs => greatest(p_lease_seconds, 30)),
         locked_by = p_worker,
         attempt_count = s.attempt_count + 1,
         status = CASE WHEN s.status = 'queued' THEN 'running' ELSE s.status END,
         started_at = coalesce(s.started_at, now())
   WHERE s.id IN (
     SELECT g.id
       FROM public.geo_scans g
      WHERE g.status IN ('queued', 'running')
        AND (p_scan_id IS NULL OR g.id = p_scan_id)
        AND (g.lease_until IS NULL OR g.lease_until < now())
      ORDER BY g.created_at
      LIMIT greatest(p_max, 0)
      FOR UPDATE SKIP LOCKED
   )
  RETURNING s.*;
$$;

REVOKE ALL ON FUNCTION public.claim_geo_scans(text, integer, integer, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_geo_scans(text, integer, integer, uuid) TO service_role;

-- ── Retention ─────────────────────────────────────────────────────────────
-- Per-page evidence is the bulk of the data; scan summaries, findings and
-- history stay. Called from prune_operational_logs (ops-watch, every 5 min).
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
  RETURN jsonb_build_object(
    'sdr_webhook_events', v_webhooks,
    'guardrail_events', v_guardrails,
    'ai_usage_events', v_usage,
    'geo_scan_page_evidence', v_geo_pages
  );
END;
$$;

REVOKE ALL ON FUNCTION public.prune_operational_logs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_operational_logs() TO service_role;

-- ── Cron ──────────────────────────────────────────────────────────────────
-- Same guard as 20260911120600: scheduled only once the Vault secrets exist.
DO $$
DECLARE
  v_ready boolean;
BEGIN
  IF to_regnamespace('cron') IS NULL OR to_regclass('vault.decrypted_secrets') IS NULL THEN
    RAISE NOTICE 'pg_cron or Vault unavailable — mellox-geo-scans not scheduled';
    RETURN;
  END IF;

  SELECT count(*) = 2 INTO v_ready
    FROM vault.decrypted_secrets
   WHERE name IN ('mellox_app_base_url', 'mellox_cron_secret')
     AND coalesce(decrypted_secret, '') <> '';

  IF NOT v_ready THEN
    RAISE NOTICE 'Vault secrets not set — mellox-geo-scans not scheduled. See docs/OPERATIONS-RUNBOOK.md.';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mellox-geo-scans') THEN
    PERFORM cron.unschedule('mellox-geo-scans');
  END IF;
  PERFORM cron.schedule(
    'mellox-geo-scans',
    '* * * * *',
    format('SELECT public.call_app_hook(%L);', '/api/public/hooks/geo-scans')
  );
END
$$;
