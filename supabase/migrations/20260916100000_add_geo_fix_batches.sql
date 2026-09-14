-- AI Visibility "Fix all": many findings fixed in ONE pull request after ONE
-- approval.
--
--   geo_fix_batches   one run over a scan's fixable findings: generation
--                     progress, per-finding items (generated / skipped + why),
--                     the combined files, validation, the user's approval and
--                     the single pull request it produced
--
-- Each finding in a batch still gets its own geo_fix_proposals row (batch_id
-- set) so per-finding status, diff and verification keep working. After the
-- PR is merged ONE verification (batch_id set) rescans all affected pages, and
-- each finding is resolved only when its own check passes.
--
-- All writes come from the server (service role). Idempotent and non-destructive.

CREATE TABLE IF NOT EXISTS public.geo_fix_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  scan_id uuid REFERENCES public.geo_scans(id) ON DELETE SET NULL,
  site_origin text NOT NULL,
  host text NOT NULL,
  provider text NOT NULL DEFAULT 'github',
  connection_id uuid REFERENCES public.workspace_connections(id) ON DELETE SET NULL,
  source_id uuid REFERENCES public.workspace_sources(id) ON DELETE SET NULL,
  repo_full_name text,
  repo_external_id text,
  framework text,
  base_branch text,
  base_sha text,
  head_branch text,
  status text NOT NULL DEFAULT 'generating',
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  files jsonb NOT NULL DEFAULT '[]'::jsonb,
  files_purged_at timestamptz,
  explanation text,
  validation jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash text,
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
  CONSTRAINT geo_fix_batches_provider_check CHECK (provider IN ('github')),
  CONSTRAINT geo_fix_batches_status_check CHECK (status IN (
    'generating', 'draft', 'applying', 'pr_open', 'merged', 'verifying',
    'completed', 'closed', 'failed', 'discarded', 'stale', 'access_lost'
  )),
  CONSTRAINT geo_fix_batches_pr_state_check
    CHECK (pr_state IS NULL OR pr_state IN ('open', 'closed', 'merged')),
  CONSTRAINT geo_fix_batches_head_branch_check
    CHECK (head_branch IS NULL OR head_branch LIKE 'mellox/%'),
  CONSTRAINT geo_fix_batches_error_length CHECK (error IS NULL OR char_length(error) <= 2000)
);

CREATE INDEX IF NOT EXISTS geo_fix_batches_workspace_idx
  ON public.geo_fix_batches (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS geo_fix_batches_pr_idx
  ON public.geo_fix_batches (repo_external_id, pr_number) WHERE pr_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS geo_fix_batches_open_pr_idx
  ON public.geo_fix_batches (last_synced_at) WHERE status = 'pr_open';
-- One live "Fix all" per website at a time.
CREATE UNIQUE INDEX IF NOT EXISTS geo_fix_batches_one_live_idx
  ON public.geo_fix_batches (workspace_id, host)
  WHERE status IN ('generating', 'draft', 'applying', 'pr_open', 'merged', 'verifying');

ALTER TABLE public.geo_fix_proposals
  ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES public.geo_fix_batches(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS geo_fix_proposals_batch_idx ON public.geo_fix_proposals (batch_id);

ALTER TABLE public.geo_verifications
  ADD COLUMN IF NOT EXISTS batch_id uuid REFERENCES public.geo_fix_batches(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS geo_verifications_batch_idx ON public.geo_verifications (batch_id);

ALTER TABLE public.geo_fix_batches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.geo_fix_batches FROM anon, authenticated;
GRANT SELECT ON public.geo_fix_batches TO authenticated;
GRANT ALL ON public.geo_fix_batches TO service_role;

DROP POLICY IF EXISTS "Workspace members read fix batches" ON public.geo_fix_batches;
CREATE POLICY "Workspace members read fix batches"
  ON public.geo_fix_batches FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP TRIGGER IF EXISTS geo_fix_batches_touch_updated_at ON public.geo_fix_batches;
CREATE TRIGGER geo_fix_batches_touch_updated_at
  BEFORE UPDATE ON public.geo_fix_batches
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ── Retention: batch file contents follow the proposal rule (30 days) ──────
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
