-- AI Visibility fix workflow: proposed repository changes, pull requests and
-- verification rescans.
--
--   geo_fix_proposals  one proposed change for one finding: target repository,
--                      the exact files Mellox would write (after content + diff),
--                      validation results, the user's approval, the branch /
--                      commit / pull request it produced and that PR's state
--   geo_verifications  a targeted rescan that decides whether a finding is
--                      really fixed. Attempts are scheduled (deploys take time)
--                      and leased like scans (claim_geo_verifications)
--
-- geo_finding_states gains verification columns: "resolved" is now written
-- only by the verification worker (service role). Members can still set open /
-- in progress / dismissed; RLS refuses a browser-written "resolved".
--
-- All proposal and verification writes come from the server (service role).
-- Idempotent and non-destructive: safe to re-run.

-- ── Scans: targeted verification crawls ───────────────────────────────────
ALTER TABLE public.geo_scans DROP CONSTRAINT IF EXISTS geo_scans_mode_check;
ALTER TABLE public.geo_scans
  ADD CONSTRAINT geo_scans_mode_check CHECK (mode IN ('quick', 'full', 'targeted'));
ALTER TABLE public.geo_scans DROP CONSTRAINT IF EXISTS geo_scans_trigger_check;
ALTER TABLE public.geo_scans
  ADD CONSTRAINT geo_scans_trigger_check
  CHECK (trigger IN ('manual', 'scheduled', 'rescan', 'chat', 'verification'));

-- ── Proposals ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.geo_fix_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  scan_id uuid REFERENCES public.geo_scans(id) ON DELETE SET NULL,
  finding_id uuid REFERENCES public.geo_findings(id) ON DELETE SET NULL,
  fingerprint text NOT NULL,
  rule_id text NOT NULL,
  fix_id text NOT NULL,
  page_url text,
  site_origin text NOT NULL,
  provider text NOT NULL DEFAULT 'github',
  connection_id uuid REFERENCES public.workspace_connections(id) ON DELETE SET NULL,
  source_id uuid REFERENCES public.workspace_sources(id) ON DELETE SET NULL,
  repo_full_name text,
  repo_external_id text,
  framework text,
  base_branch text,
  base_sha text,
  head_branch text,
  strategy text,
  files jsonb NOT NULL DEFAULT '[]'::jsonb,
  files_purged_at timestamptz,
  explanation text,
  validation jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash text,
  model text,
  status text NOT NULL DEFAULT 'draft',
  error text,
  commit_sha text,
  pr_number integer,
  pr_url text,
  pr_state text,
  pr_merged_at timestamptz,
  checks jsonb,
  last_synced_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT geo_fix_proposals_provider_check CHECK (provider IN ('github')),
  CONSTRAINT geo_fix_proposals_status_check CHECK (status IN (
    'draft', 'applying', 'pr_open', 'merged', 'closed', 'verifying',
    'verified', 'not_verified', 'failed', 'discarded', 'stale', 'access_lost'
  )),
  CONSTRAINT geo_fix_proposals_pr_state_check
    CHECK (pr_state IS NULL OR pr_state IN ('open', 'closed', 'merged')),
  CONSTRAINT geo_fix_proposals_head_branch_check
    CHECK (head_branch IS NULL OR head_branch LIKE 'mellox/%'),
  CONSTRAINT geo_fix_proposals_error_length CHECK (error IS NULL OR char_length(error) <= 2000)
);

CREATE INDEX IF NOT EXISTS geo_fix_proposals_workspace_idx
  ON public.geo_fix_proposals (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS geo_fix_proposals_fingerprint_idx
  ON public.geo_fix_proposals (workspace_id, fingerprint, created_at DESC);
CREATE INDEX IF NOT EXISTS geo_fix_proposals_pr_idx
  ON public.geo_fix_proposals (repo_external_id, pr_number) WHERE pr_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS geo_fix_proposals_open_pr_idx
  ON public.geo_fix_proposals (last_synced_at) WHERE status = 'pr_open';
-- One live proposal per finding: regenerate or discard before proposing again.
CREATE UNIQUE INDEX IF NOT EXISTS geo_fix_proposals_one_live_idx
  ON public.geo_fix_proposals (workspace_id, fingerprint)
  WHERE status IN ('draft', 'applying', 'pr_open', 'merged', 'verifying');

-- ── Verifications ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.geo_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  proposal_id uuid REFERENCES public.geo_fix_proposals(id) ON DELETE SET NULL,
  origin text NOT NULL,
  fingerprints text[] NOT NULL,
  rule_ids text[] NOT NULL DEFAULT '{}',
  urls text[] NOT NULL,
  baseline_scan_id uuid REFERENCES public.geo_scans(id) ON DELETE SET NULL,
  scan_id uuid REFERENCES public.geo_scans(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'scheduled',
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 1,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  locked_by text,
  before jsonb NOT NULL DEFAULT '{}'::jsonb,
  after jsonb NOT NULL DEFAULT '{}'::jsonb,
  outcome_detail text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT geo_verifications_status_check CHECK (status IN (
    'scheduled', 'running', 'verified', 'not_verified', 'failed', 'cancelled'
  )),
  CONSTRAINT geo_verifications_urls_check CHECK (cardinality(urls) BETWEEN 1 AND 20),
  CONSTRAINT geo_verifications_fingerprints_check
    CHECK (cardinality(fingerprints) BETWEEN 1 AND 50),
  CONSTRAINT geo_verifications_attempts_check CHECK (max_attempts BETWEEN 1 AND 10)
);

CREATE INDEX IF NOT EXISTS geo_verifications_workspace_idx
  ON public.geo_verifications (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS geo_verifications_proposal_idx
  ON public.geo_verifications (proposal_id);
CREATE INDEX IF NOT EXISTS geo_verifications_due_idx
  ON public.geo_verifications (next_attempt_at) WHERE status IN ('scheduled', 'running');

-- ── Finding states: verified resolution ───────────────────────────────────
ALTER TABLE public.geo_finding_states ADD COLUMN IF NOT EXISTS resolved_via text;
ALTER TABLE public.geo_finding_states ADD COLUMN IF NOT EXISTS verified_at timestamptz;
ALTER TABLE public.geo_finding_states
  ADD COLUMN IF NOT EXISTS verification_id uuid
  REFERENCES public.geo_verifications(id) ON DELETE SET NULL;
ALTER TABLE public.geo_finding_states ADD COLUMN IF NOT EXISTS reopened_at timestamptz;
ALTER TABLE public.geo_finding_states DROP CONSTRAINT IF EXISTS geo_finding_states_resolved_via_check;
ALTER TABLE public.geo_finding_states
  ADD CONSTRAINT geo_finding_states_resolved_via_check
  CHECK (resolved_via IS NULL OR resolved_via IN ('verified', 'manual_legacy'));

-- Findings someone marked resolved by hand before verification existed stay
-- visible, labelled as unverified.
UPDATE public.geo_finding_states
   SET resolved_via = 'manual_legacy'
 WHERE state = 'resolved' AND resolved_via IS NULL;

-- ── Row-level security ────────────────────────────────────────────────────
ALTER TABLE public.geo_fix_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.geo_verifications ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.geo_fix_proposals, public.geo_verifications FROM anon, authenticated;
GRANT SELECT ON public.geo_fix_proposals, public.geo_verifications TO authenticated;
GRANT ALL ON public.geo_fix_proposals, public.geo_verifications TO service_role;

DROP POLICY IF EXISTS "Workspace members read fix proposals" ON public.geo_fix_proposals;
CREATE POLICY "Workspace members read fix proposals"
  ON public.geo_fix_proposals FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Workspace members read verifications" ON public.geo_verifications;
CREATE POLICY "Workspace members read verifications"
  ON public.geo_verifications FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

-- Members may open, start or dismiss a finding, never mark it resolved or
-- forge verification fields: only a verification (service role) resolves.
DROP POLICY IF EXISTS "Workspace members write finding states" ON public.geo_finding_states;
CREATE POLICY "Workspace members write finding states"
  ON public.geo_finding_states FOR INSERT TO authenticated
  WITH CHECK (
    private.is_workspace_member(workspace_id, auth.uid())
    AND (updated_by IS NULL OR updated_by = auth.uid())
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
    AND state <> 'resolved'
    AND resolved_via IS NULL
    AND verified_at IS NULL
    AND verification_id IS NULL
  );

DROP TRIGGER IF EXISTS geo_fix_proposals_touch_updated_at ON public.geo_fix_proposals;
CREATE TRIGGER geo_fix_proposals_touch_updated_at
  BEFORE UPDATE ON public.geo_fix_proposals
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS geo_verifications_touch_updated_at ON public.geo_verifications;
CREATE TRIGGER geo_verifications_touch_updated_at
  BEFORE UPDATE ON public.geo_verifications
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ── Worker lease claim ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_geo_verifications(
  p_worker text,
  p_max integer DEFAULT 2,
  p_lease_seconds integer DEFAULT 240,
  p_id uuid DEFAULT NULL
)
RETURNS SETOF public.geo_verifications
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.geo_verifications AS v
     SET lease_until = now() + make_interval(secs => greatest(p_lease_seconds, 30)),
         locked_by = p_worker,
         status = 'running'
   WHERE v.id IN (
     SELECT g.id
       FROM public.geo_verifications g
      WHERE g.status IN ('scheduled', 'running')
        AND (p_id IS NULL OR g.id = p_id)
        AND g.next_attempt_at <= now()
        AND (g.lease_until IS NULL OR g.lease_until < now())
      ORDER BY g.next_attempt_at
      LIMIT greatest(p_max, 0)
      FOR UPDATE SKIP LOCKED
   )
  RETURNING v.*;
$$;

REVOKE ALL ON FUNCTION public.claim_geo_verifications(text, integer, integer, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_geo_verifications(text, integer, integer, uuid)
  TO service_role;

-- ── Retention ─────────────────────────────────────────────────────────────
-- Proposed file contents are customer source code: kept 30 days after a
-- proposal ends, then reduced to paths only.
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
  RETURN jsonb_build_object(
    'sdr_webhook_events', v_webhooks,
    'guardrail_events', v_guardrails,
    'ai_usage_events', v_usage,
    'geo_scan_page_evidence', v_geo_pages,
    'geo_fix_proposal_files', v_fix_files
  );
END;
$$;

REVOKE ALL ON FUNCTION public.prune_operational_logs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_operational_logs() TO service_role;
