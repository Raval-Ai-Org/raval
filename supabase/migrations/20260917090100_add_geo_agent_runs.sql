-- Mellox GEO Engineer: the coding agent that investigates a repository, plans a
-- fix for an AI Visibility finding, and produces a validated patch (ADR-0013).
--
--   geo_agent_runs     one investigation → plan → patch per finding, leased like
--                      scans (claim_geo_agent_runs) and advanced by cron + after()
--   geo_agent_events   the run's activity log — concise action summaries written
--                      only from real execution (never model reasoning)
--
-- A run hands its validated patch to geo_fix_proposals (agent_run_id); from
-- there approval, the pull request and verification are unchanged, and only a
-- verification resolves a finding.
--
-- Also: finding review / dismissal reasons on geo_finding_states.
--
-- Members read; the service role writes. Idempotent and non-destructive.

CREATE TABLE IF NOT EXISTS public.geo_agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'finding',
  parent_run_id uuid REFERENCES public.geo_agent_runs(id) ON DELETE CASCADE,
  scan_id uuid REFERENCES public.geo_scans(id) ON DELETE SET NULL,
  finding_id uuid REFERENCES public.geo_findings(id) ON DELETE SET NULL,
  fingerprint text NOT NULL,
  rule_id text NOT NULL,
  page_url text,
  site_host text NOT NULL,
  site_origin text NOT NULL,
  source_id uuid REFERENCES public.workspace_sources(id) ON DELETE SET NULL,
  connection_id uuid REFERENCES public.workspace_connections(id) ON DELETE SET NULL,
  repo_full_name text,
  repo_external_id text,
  base_branch text,
  base_sha text,
  framework text,
  status text NOT NULL DEFAULT 'queued',
  status_detail text,
  failed_at_step text,
  error_code text,
  error text,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 6,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  locked_by text,
  cancel_requested_at timestamptz,
  plan jsonb,
  plan_hash text,
  plan_revision integer NOT NULL DEFAULT 0,
  plan_ready_at timestamptz,
  plan_approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  plan_approved_at timestamptz,
  feedback text,
  inputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  files_inspected jsonb NOT NULL DEFAULT '[]'::jsonb,
  patch jsonb,
  review jsonb,
  validation jsonb,
  correction_rounds integer NOT NULL DEFAULT 0,
  proposal_id uuid REFERENCES public.geo_fix_proposals(id) ON DELETE SET NULL,
  batch_id uuid REFERENCES public.geo_fix_batches(id) ON DELETE SET NULL,
  verification_id uuid REFERENCES public.geo_verifications(id) ON DELETE SET NULL,
  result jsonb,
  model text,
  usage jsonb NOT NULL DEFAULT '{}'::jsonb,
  checkpoint jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT geo_agent_runs_kind_check CHECK (kind IN ('finding', 'batch')),
  CONSTRAINT geo_agent_runs_status_check CHECK (status IN (
    'queued', 'investigating', 'needs_input', 'awaiting_plan_approval', 'implementing',
    'reviewing', 'validating', 'correcting', 'awaiting_patch_approval', 'applying', 'pr_open',
    'merged', 'rescan_pending', 'verified_fixed', 'not_verified', 'not_fixable', 'failed',
    'cancelled', 'closed', 'stale'
  )),
  CONSTRAINT geo_agent_runs_error_length CHECK (error IS NULL OR char_length(error) <= 2000),
  CONSTRAINT geo_agent_runs_feedback_length CHECK (feedback IS NULL OR char_length(feedback) <= 1000),
  CONSTRAINT geo_agent_runs_attempts_check CHECK (max_attempts BETWEEN 1 AND 20)
);

CREATE INDEX IF NOT EXISTS geo_agent_runs_workspace_idx
  ON public.geo_agent_runs (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS geo_agent_runs_fingerprint_idx
  ON public.geo_agent_runs (workspace_id, fingerprint, created_at DESC);
CREATE INDEX IF NOT EXISTS geo_agent_runs_due_idx
  ON public.geo_agent_runs (next_attempt_at)
  WHERE status IN ('queued', 'investigating', 'implementing', 'reviewing', 'validating', 'correcting');
CREATE INDEX IF NOT EXISTS geo_agent_runs_proposal_idx ON public.geo_agent_runs (proposal_id);
-- One live run per finding: a second "Fix with AI Agent" joins the first.
CREATE UNIQUE INDEX IF NOT EXISTS geo_agent_runs_one_live_per_finding
  ON public.geo_agent_runs (workspace_id, fingerprint)
  WHERE status NOT IN ('verified_fixed', 'not_verified', 'not_fixable', 'failed', 'cancelled', 'closed', 'stale');

CREATE TABLE IF NOT EXISTS public.geo_agent_events (
  id bigserial PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES public.geo_agent_runs(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  at timestamptz NOT NULL DEFAULT now(),
  stage text,
  kind text NOT NULL,
  actor text NOT NULL DEFAULT 'agent',
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  summary text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT geo_agent_events_actor_check CHECK (actor IN ('agent', 'system', 'user')),
  CONSTRAINT geo_agent_events_summary_length CHECK (char_length(summary) <= 300),
  CONSTRAINT geo_agent_events_detail_size CHECK (pg_column_size(detail) <= 8192)
);

CREATE INDEX IF NOT EXISTS geo_agent_events_run_idx ON public.geo_agent_events (run_id, id);

ALTER TABLE public.geo_fix_proposals
  ADD COLUMN IF NOT EXISTS agent_run_id uuid REFERENCES public.geo_agent_runs(id) ON DELETE SET NULL;
ALTER TABLE public.geo_fix_proposals ADD COLUMN IF NOT EXISTS preview jsonb;

-- ── Finding review & dismissal reasons ────────────────────────────────────
ALTER TABLE public.geo_finding_states ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE public.geo_finding_states
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.geo_finding_states ADD COLUMN IF NOT EXISTS dismiss_reason text;
ALTER TABLE public.geo_finding_states DROP CONSTRAINT IF EXISTS geo_finding_states_dismiss_reason_check;
ALTER TABLE public.geo_finding_states
  ADD CONSTRAINT geo_finding_states_dismiss_reason_check CHECK (dismiss_reason IS NULL OR dismiss_reason IN (
    'false_positive', 'not_relevant', 'wont_fix', 'handled_elsewhere'
  ));

-- ── Row-level security ────────────────────────────────────────────────────
ALTER TABLE public.geo_agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.geo_agent_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.geo_agent_runs, public.geo_agent_events FROM anon, authenticated;
GRANT SELECT ON public.geo_agent_runs, public.geo_agent_events TO authenticated;
GRANT ALL ON public.geo_agent_runs, public.geo_agent_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.geo_agent_events_id_seq TO service_role;

DROP POLICY IF EXISTS "Workspace members read agent runs" ON public.geo_agent_runs;
CREATE POLICY "Workspace members read agent runs"
  ON public.geo_agent_runs FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Workspace members read agent events" ON public.geo_agent_events;
CREATE POLICY "Workspace members read agent events"
  ON public.geo_agent_events FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

-- Members may review or dismiss (with a reason) — still never resolve, and
-- never record a review in someone else's name.
DROP POLICY IF EXISTS "Workspace members write finding states" ON public.geo_finding_states;
CREATE POLICY "Workspace members write finding states"
  ON public.geo_finding_states FOR INSERT TO authenticated
  WITH CHECK (
    private.is_workspace_member(workspace_id, auth.uid())
    AND (updated_by IS NULL OR updated_by = auth.uid())
    AND (reviewed_by IS NULL OR reviewed_by = auth.uid())
    AND state <> 'resolved'
    AND resolved_via IS NULL
    AND verified_at IS NULL
    AND verification_id IS NULL
  );

DROP POLICY IF EXISTS "Workspace members update finding states" ON public.geo_finding_states;
CREATE POLICY "Workspace members update finding states"
  ON public.geo_finding_states FOR UPDATE TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (
    private.is_workspace_member(workspace_id, auth.uid())
    AND (updated_by IS NULL OR updated_by = auth.uid())
    AND (reviewed_by IS NULL OR reviewed_by = auth.uid())
    AND state <> 'resolved'
    AND resolved_via IS NULL
    AND verified_at IS NULL
    AND verification_id IS NULL
  );

DROP TRIGGER IF EXISTS geo_agent_runs_touch_updated_at ON public.geo_agent_runs;
CREATE TRIGGER geo_agent_runs_touch_updated_at
  BEFORE UPDATE ON public.geo_agent_runs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ── Worker lease claim ────────────────────────────────────────────────────
-- Claims runs a worker advances whose lease is free. Status is not changed
-- here: the runner moves queued → investigating itself (compare-and-set).
CREATE OR REPLACE FUNCTION public.claim_geo_agent_runs(
  p_worker text,
  p_max integer DEFAULT 1,
  p_lease_seconds integer DEFAULT 180,
  p_id uuid DEFAULT NULL
)
RETURNS SETOF public.geo_agent_runs
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.geo_agent_runs AS r
     SET lease_until = now() + make_interval(secs => greatest(p_lease_seconds, 30)),
         locked_by = p_worker,
         attempts = r.attempts + 1
   WHERE r.id IN (
     SELECT g.id
       FROM public.geo_agent_runs g
      WHERE g.status IN ('queued', 'investigating', 'implementing', 'reviewing', 'validating', 'correcting')
        AND (p_id IS NULL OR g.id = p_id)
        AND g.next_attempt_at <= now()
        AND (g.lease_until IS NULL OR g.lease_until < now())
        AND g.attempts < g.max_attempts
      ORDER BY g.next_attempt_at
      LIMIT greatest(p_max, 0)
      FOR UPDATE SKIP LOCKED
   )
  RETURNING r.*;
$$;

REVOKE ALL ON FUNCTION public.claim_geo_agent_runs(text, integer, integer, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_geo_agent_runs(text, integer, integer, uuid)
  TO service_role;

-- ── Retention ─────────────────────────────────────────────────────────────
-- Conversation checkpoints hold repository code sent to the model: dropped a
-- day after a run ends. Patches follow proposal retention (30 days). Events
-- are kept 180 days.
CREATE OR REPLACE FUNCTION public.prune_geo_agent_runs()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_checkpoints integer;
  v_patches integer;
  v_events integer;
BEGIN
  UPDATE public.geo_agent_runs
     SET checkpoint = NULL
   WHERE checkpoint IS NOT NULL
     AND status IN ('verified_fixed', 'not_verified', 'not_fixable', 'failed', 'cancelled', 'closed', 'stale',
                    'awaiting_patch_approval', 'pr_open', 'merged', 'rescan_pending')
     AND updated_at < now() - interval '1 day';
  GET DIAGNOSTICS v_checkpoints = ROW_COUNT;
  UPDATE public.geo_agent_runs
     SET patch = jsonb_build_object('purged', true)
   WHERE patch IS NOT NULL
     AND NOT (patch ? 'purged')
     AND status IN ('verified_fixed', 'not_verified', 'not_fixable', 'failed', 'cancelled', 'closed', 'stale')
     AND updated_at < now() - interval '30 days';
  GET DIAGNOSTICS v_patches = ROW_COUNT;
  DELETE FROM public.geo_agent_events WHERE at < now() - interval '180 days';
  GET DIAGNOSTICS v_events = ROW_COUNT;
  RETURN jsonb_build_object('checkpoints', v_checkpoints, 'patches', v_patches, 'events', v_events);
END;
$$;

REVOKE ALL ON FUNCTION public.prune_geo_agent_runs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_geo_agent_runs() TO service_role;

-- ── Scheduling: advance agent runs every minute ───────────────────────────
DO $$
DECLARE
  v_ready boolean;
BEGIN
  IF to_regnamespace('cron') IS NULL OR to_regclass('vault.decrypted_secrets') IS NULL THEN
    RAISE NOTICE 'pg_cron or Vault unavailable — mellox-geo-agents not scheduled';
    RETURN;
  END IF;

  SELECT count(*) = 2 INTO v_ready
    FROM vault.decrypted_secrets
   WHERE name IN ('mellox_app_base_url', 'mellox_cron_secret')
     AND coalesce(decrypted_secret, '') <> '';

  IF NOT v_ready THEN
    RAISE NOTICE 'Vault secrets missing — mellox-geo-agents not scheduled';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mellox-geo-agents') THEN
    PERFORM cron.unschedule('mellox-geo-agents');
  END IF;
  PERFORM cron.schedule(
    'mellox-geo-agents',
    '* * * * *',
    format('SELECT public.call_app_hook(%L);', '/api/public/hooks/geo-agents')
  );
END;
$$;
