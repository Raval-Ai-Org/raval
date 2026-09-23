-- Proof Engine — website changes as controlled experiments
-- (ADR-0024, docs/adr/0024-proof-engine-controlled-experiments.md).
--
--   experiment_page_groups     clusters of comparable pages on a connected site
--   experiments                one change vs control; design locked after draft
--   experiment_assignments     page → arm; a page is in at most one active experiment
--   experiment_changes         per treatment page: before / after (frozen after draft)
--   experiment_deliveries      integration / ship / rollout / rollback pull requests
--   experiment_metrics_daily   complete per-page daily numbers (GSC + GA4)
--   experiment_metric_days     which days are complete per source (0 vs "no data")
--   experiment_events          append-only audit timeline (real events only)
--   experiment_jobs            leased worker jobs, claimed with SKIP LOCKED
--   workspace_report_branding  per-workspace name / logo for client reports
--
-- Members read their workspace's rows. There are no browser write policies at
-- all: status, assignments, metrics, results and events are written only by
-- the service role from server functions and workers.
--
-- Idempotent and non-destructive: safe to re-run.

-- ── Page groups ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.experiment_page_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES public.workspace_sources(id) ON DELETE CASCADE,
  label text NOT NULL,
  -- URL pattern with wildcards for varying segments, e.g. "/products/*".
  pattern text NOT NULL,
  -- The route or template file in the repository that renders the pattern.
  template_file text,
  rule jsonb NOT NULL DEFAULT '{}'::jsonb,
  page_count integer NOT NULL DEFAULT 0,
  paths text[] NOT NULL DEFAULT '{}'::text[],
  monthly_clicks numeric NOT NULL DEFAULT 0,
  eligibility jsonb NOT NULL DEFAULT '{}'::jsonb,
  detected_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT experiment_page_groups_label_length CHECK (char_length(label) BETWEEN 1 AND 120),
  CONSTRAINT experiment_page_groups_pattern_check CHECK (pattern ~ '^/' AND char_length(pattern) <= 300),
  CONSTRAINT experiment_page_groups_page_count_check CHECK (page_count >= 0),
  CONSTRAINT experiment_page_groups_source_pattern_unique UNIQUE (source_id, pattern)
);

CREATE INDEX IF NOT EXISTS experiment_page_groups_workspace_idx
  ON public.experiment_page_groups (workspace_id, source_id);

-- ── Experiments ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.experiments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- The GitHub repository (workspace_sources) that builds site_host. Set to
  -- NULL if the repository is disconnected, so the history survives.
  source_id uuid REFERENCES public.workspace_sources(id) ON DELETE SET NULL,
  site_host text NOT NULL,
  gsc_source_id uuid REFERENCES public.analytics_sources(id) ON DELETE SET NULL,
  ga4_source_id uuid REFERENCES public.analytics_sources(id) ON DELETE SET NULL,
  page_group_id uuid REFERENCES public.experiment_page_groups(id) ON DELETE SET NULL,
  name text NOT NULL,
  hypothesis text NOT NULL DEFAULT '',
  change_type text NOT NULL,
  primary_metric text NOT NULL,
  secondary_metrics text[] NOT NULL DEFAULT '{}'::text[],
  status text NOT NULL DEFAULT 'draft',
  verdict text,
  closed_via text,
  pre_period_start date,
  pre_period_end date,
  planned_min_days integer NOT NULL DEFAULT 21,
  planned_max_days integer NOT NULL DEFAULT 42,
  mde_estimate numeric,
  assignment_seed bigint,
  assignment_attempts integer,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_patch_hash text,
  approved_at timestamptz,
  shipped_at timestamptz,
  -- Day 0: only the live check sets it.
  live_confirmed_at timestamptz,
  concluded_at timestamptz,
  closed_at timestamptz,
  invalidated_at timestamptz,
  cancelled_at timestamptz,
  invalid_reason text,
  last_checkpoint_day integer,
  -- Latest analysis summary (early read or checkpoint result).
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Headline figures, set together with the verdict.
  lift numeric,
  lift_low numeric,
  lift_high numeric,
  estimated_monthly_units numeric,
  estimated_monthly_value numeric,
  value_currency text,
  -- Inputs for outcome-based billing later; never shown as a price.
  revenue_basis jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT experiments_status_check CHECK (status IN (
    'draft', 'awaiting_approval', 'shipping', 'awaiting_deploy', 'running', 'analyzing',
    'concluded', 'rolling_out', 'rolling_back', 'closed', 'invalidated', 'cancelled')),
  CONSTRAINT experiments_verdict_check CHECK (verdict IS NULL OR verdict IN ('win', 'loss', 'inconclusive')),
  CONSTRAINT experiments_verdict_status_check CHECK (
    verdict IS NULL OR status IN ('concluded', 'rolling_out', 'rolling_back', 'closed', 'invalidated')),
  CONSTRAINT experiments_closed_via_check CHECK (closed_via IS NULL OR closed_via IN ('rollout', 'rollback', 'kept')),
  CONSTRAINT experiments_change_type_check CHECK (change_type IN (
    'title', 'meta_description', 'h1', 'intro', 'faq', 'cta_text')),
  CONSTRAINT experiments_primary_metric_check CHECK (primary_metric IN (
    'clicks', 'impressions', 'ctr', 'sessions', 'key_events', 'revenue', 'ai_referral_sessions')),
  CONSTRAINT experiments_durations_check CHECK (
    planned_min_days BETWEEN 7 AND 90 AND planned_max_days BETWEEN planned_min_days AND 120),
  CONSTRAINT experiments_pre_period_check CHECK (
    pre_period_start IS NULL OR pre_period_end IS NULL OR pre_period_start <= pre_period_end),
  CONSTRAINT experiments_name_length CHECK (char_length(name) BETWEEN 1 AND 160),
  CONSTRAINT experiments_hypothesis_length CHECK (char_length(hypothesis) <= 2000),
  CONSTRAINT experiments_invalid_reason_length CHECK (invalid_reason IS NULL OR char_length(invalid_reason) <= 500),
  CONSTRAINT experiments_patch_hash_check CHECK (approved_patch_hash IS NULL OR approved_patch_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS experiments_workspace_status_idx
  ON public.experiments (workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS experiments_source_idx
  ON public.experiments (source_id);

-- ── Assignments ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.experiment_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id uuid NOT NULL REFERENCES public.experiments(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  site_host text NOT NULL,
  page_url text NOT NULL,
  -- Normalized path: leading slash, no query or fragment, no trailing slash (except "/").
  path text NOT NULL,
  arm text NOT NULL,
  -- Pair index from the stratified assignment.
  stratum integer NOT NULL,
  baseline jsonb NOT NULL DEFAULT '{}'::jsonb,
  excluded_at timestamptz,
  excluded_reason text,
  -- Maintained by triggers from the experiment status; false only once closed/cancelled.
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT experiment_assignments_arm_check CHECK (arm IN ('treatment', 'control')),
  CONSTRAINT experiment_assignments_path_check CHECK (path ~ '^/' AND char_length(path) <= 600),
  CONSTRAINT experiment_assignments_stratum_check CHECK (stratum >= 0),
  CONSTRAINT experiment_assignments_excluded_reason_length CHECK (
    excluded_reason IS NULL OR char_length(excluded_reason) <= 300),
  CONSTRAINT experiment_assignments_experiment_path_unique UNIQUE (experiment_id, path)
);

-- One active experiment per page, enforced by the database.
CREATE UNIQUE INDEX IF NOT EXISTS experiment_assignments_one_active_per_page_idx
  ON public.experiment_assignments (workspace_id, site_host, path) WHERE active;
CREATE INDEX IF NOT EXISTS experiment_assignments_experiment_arm_idx
  ON public.experiment_assignments (experiment_id, arm);

-- ── Changes (treatment pages) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.experiment_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id uuid NOT NULL REFERENCES public.experiments(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  path text NOT NULL,
  field text NOT NULL,
  before text,
  after text NOT NULL,
  grounding jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT experiment_changes_field_check CHECK (field IN (
    'title', 'meta_description', 'h1', 'intro', 'faq', 'cta_text')),
  CONSTRAINT experiment_changes_after_length CHECK (char_length(after) BETWEEN 1 AND 8000),
  CONSTRAINT experiment_changes_before_length CHECK (before IS NULL OR char_length(before) <= 8000),
  CONSTRAINT experiment_changes_unique UNIQUE (experiment_id, path, field)
);

-- ── Deliveries (pull requests) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.experiment_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  source_id uuid REFERENCES public.workspace_sources(id) ON DELETE SET NULL,
  -- NULL only for the one-time integration of a repository.
  experiment_id uuid REFERENCES public.experiments(id) ON DELETE CASCADE,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  -- [{path, action, before?, after}] — the exact content the approver reviews.
  files jsonb NOT NULL DEFAULT '[]'::jsonb,
  content_hash text,
  validation jsonb NOT NULL DEFAULT '{}'::jsonb,
  base_branch text,
  base_sha text,
  head_branch text,
  commit_sha text,
  pr_number integer,
  pr_url text,
  pr_state text,
  merged_at timestamptz,
  live_at timestamptz,
  -- Integration only: which template files read the data file, and which fields.
  template_files text[] NOT NULL DEFAULT '{}'::text[],
  fields text[] NOT NULL DEFAULT '{}'::text[],
  agent_run_id uuid,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT experiment_deliveries_kind_check CHECK (kind IN ('integration', 'ship', 'rollout', 'rollback')),
  CONSTRAINT experiment_deliveries_experiment_check CHECK (kind = 'integration' OR experiment_id IS NOT NULL),
  CONSTRAINT experiment_deliveries_status_check CHECK (status IN (
    'draft', 'applying', 'pr_open', 'merged', 'live', 'closed', 'failed', 'discarded', 'stale', 'access_lost')),
  CONSTRAINT experiment_deliveries_head_branch_check CHECK (head_branch IS NULL OR head_branch LIKE 'mellox/%'),
  CONSTRAINT experiment_deliveries_hash_check CHECK (content_hash IS NULL OR content_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT experiment_deliveries_pr_state_check CHECK (pr_state IS NULL OR pr_state IN ('open', 'closed', 'merged')),
  CONSTRAINT experiment_deliveries_error_length CHECK (error IS NULL OR char_length(error) <= 500)
);

-- At most one delivery of each kind in flight per experiment.
CREATE UNIQUE INDEX IF NOT EXISTS experiment_deliveries_one_live_idx
  ON public.experiment_deliveries (experiment_id, kind)
  WHERE experiment_id IS NOT NULL AND status IN ('draft', 'applying', 'pr_open', 'merged');
-- At most one integration in flight per repository.
CREATE UNIQUE INDEX IF NOT EXISTS experiment_deliveries_one_live_integration_idx
  ON public.experiment_deliveries (source_id)
  WHERE kind = 'integration' AND status IN ('draft', 'applying', 'pr_open');
CREATE INDEX IF NOT EXISTS experiment_deliveries_pr_idx
  ON public.experiment_deliveries (source_id, pr_number) WHERE pr_number IS NOT NULL;

-- ── Daily metrics (complete, per page) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.experiment_metrics_daily (
  experiment_id uuid NOT NULL REFERENCES public.experiments(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  date date NOT NULL,
  path text NOT NULL,
  arm text NOT NULL,
  clicks numeric NOT NULL DEFAULT 0,
  impressions numeric NOT NULL DEFAULT 0,
  -- position × impressions, so averages can be re-weighted over any range.
  position_weighted numeric NOT NULL DEFAULT 0,
  sessions numeric NOT NULL DEFAULT 0,
  key_events numeric NOT NULL DEFAULT 0,
  revenue numeric NOT NULL DEFAULT 0,
  ai_referral_sessions numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (experiment_id, date, path),
  CONSTRAINT experiment_metrics_daily_arm_check CHECK (arm IN ('treatment', 'control'))
);

CREATE TABLE IF NOT EXISTS public.experiment_metric_days (
  experiment_id uuid NOT NULL REFERENCES public.experiments(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  date date NOT NULL,
  source text NOT NULL,
  complete boolean NOT NULL DEFAULT false,
  pulled_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (experiment_id, date, source),
  CONSTRAINT experiment_metric_days_source_check CHECK (source IN ('gsc', 'ga4'))
);

-- ── Events (append-only) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.experiment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id uuid NOT NULL REFERENCES public.experiments(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  kind text NOT NULL,
  summary text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT experiment_events_kind_check CHECK (kind ~ '^[a-z][a-z_]{1,39}$'),
  CONSTRAINT experiment_events_summary_length CHECK (char_length(summary) BETWEEN 1 AND 500)
);

CREATE INDEX IF NOT EXISTS experiment_events_experiment_idx
  ON public.experiment_events (experiment_id, created_at);

-- ── Jobs (leased) ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.experiment_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id uuid NOT NULL REFERENCES public.experiments(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  locked_by text,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 8,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT experiment_jobs_kind_check CHECK (kind IN (
    'backfill', 'pull_metrics', 'check_live', 'check_contamination', 'analyze', 'sync_pr')),
  CONSTRAINT experiment_jobs_status_check CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled')),
  CONSTRAINT experiment_jobs_last_error_length CHECK (last_error IS NULL OR char_length(last_error) <= 500)
);

-- One pending job of each kind per experiment.
CREATE UNIQUE INDEX IF NOT EXISTS experiment_jobs_one_pending_idx
  ON public.experiment_jobs (experiment_id, kind) WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS experiment_jobs_due_idx
  ON public.experiment_jobs (next_attempt_at) WHERE status IN ('queued', 'running');

-- ── Report branding (per workspace) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workspace_report_branding (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  display_name text,
  -- Storage path in generated-assets under workspace/<id>/assets/branding/.
  logo_path text,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_report_branding_name_length CHECK (
    display_name IS NULL OR char_length(display_name) BETWEEN 1 AND 80),
  CONSTRAINT workspace_report_branding_logo_path_check CHECK (
    logo_path IS NULL OR (
      logo_path LIKE 'workspace/' || workspace_id::text || '/assets/branding/%'
      AND logo_path !~ '\.\.'
      AND char_length(logo_path) <= 300))
);

-- ── Row-level security: members read, only the service role writes ───────
ALTER TABLE public.experiment_page_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.experiment_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.experiment_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.experiment_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.experiment_metrics_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.experiment_metric_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.experiment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.experiment_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_report_branding ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.experiment_page_groups, public.experiments, public.experiment_assignments,
  public.experiment_changes, public.experiment_deliveries, public.experiment_metrics_daily,
  public.experiment_metric_days, public.experiment_events, public.experiment_jobs,
  public.workspace_report_branding
  FROM anon, authenticated;
GRANT SELECT ON public.experiment_page_groups, public.experiments, public.experiment_assignments,
  public.experiment_changes, public.experiment_deliveries, public.experiment_metrics_daily,
  public.experiment_metric_days, public.experiment_events, public.experiment_jobs,
  public.workspace_report_branding
  TO authenticated;
GRANT ALL ON public.experiment_page_groups, public.experiments, public.experiment_assignments,
  public.experiment_changes, public.experiment_deliveries, public.experiment_metrics_daily,
  public.experiment_metric_days, public.experiment_events, public.experiment_jobs,
  public.workspace_report_branding
  TO service_role;

DROP POLICY IF EXISTS "Workspace members read experiment page groups" ON public.experiment_page_groups;
CREATE POLICY "Workspace members read experiment page groups"
  ON public.experiment_page_groups FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Workspace members read experiments" ON public.experiments;
CREATE POLICY "Workspace members read experiments"
  ON public.experiments FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Workspace members read experiment assignments" ON public.experiment_assignments;
CREATE POLICY "Workspace members read experiment assignments"
  ON public.experiment_assignments FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Workspace members read experiment changes" ON public.experiment_changes;
CREATE POLICY "Workspace members read experiment changes"
  ON public.experiment_changes FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Workspace members read experiment deliveries" ON public.experiment_deliveries;
CREATE POLICY "Workspace members read experiment deliveries"
  ON public.experiment_deliveries FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Workspace members read experiment metrics" ON public.experiment_metrics_daily;
CREATE POLICY "Workspace members read experiment metrics"
  ON public.experiment_metrics_daily FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Workspace members read experiment metric days" ON public.experiment_metric_days;
CREATE POLICY "Workspace members read experiment metric days"
  ON public.experiment_metric_days FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Workspace members read experiment events" ON public.experiment_events;
CREATE POLICY "Workspace members read experiment events"
  ON public.experiment_events FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Workspace members read experiment jobs" ON public.experiment_jobs;
CREATE POLICY "Workspace members read experiment jobs"
  ON public.experiment_jobs FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Workspace members read report branding" ON public.workspace_report_branding;
CREATE POLICY "Workspace members read report branding"
  ON public.workspace_report_branding FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

-- ── Tenant integrity: every row stays in its parent's workspace ───────────
CREATE OR REPLACE FUNCTION private.experiment_workspace_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Read columns through jsonb: this one function serves tables of different shapes.
  v_rec jsonb := to_jsonb(NEW);
  v_ws uuid := (v_rec ->> 'workspace_id')::uuid;
  v_parent uuid;
BEGIN
  IF (v_rec ->> 'source_id') IS NOT NULL THEN
    SELECT workspace_id INTO v_parent FROM public.workspace_sources
     WHERE id = (v_rec ->> 'source_id')::uuid;
    IF v_parent IS NULL OR v_parent <> v_ws THEN
      RAISE EXCEPTION 'experiment row workspace does not match its source' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_TABLE_NAME = 'experiments' THEN
    IF (v_rec ->> 'gsc_source_id') IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.analytics_sources
       WHERE id = (v_rec ->> 'gsc_source_id')::uuid AND workspace_id = v_ws AND kind = 'gsc_site') THEN
      RAISE EXCEPTION 'experiment Search Console source is not in its workspace' USING ERRCODE = '23514';
    END IF;
    IF (v_rec ->> 'ga4_source_id') IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.analytics_sources
       WHERE id = (v_rec ->> 'ga4_source_id')::uuid AND workspace_id = v_ws AND kind = 'ga4_property') THEN
      RAISE EXCEPTION 'experiment GA4 source is not in its workspace' USING ERRCODE = '23514';
    END IF;
    IF (v_rec ->> 'page_group_id') IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.experiment_page_groups
       WHERE id = (v_rec ->> 'page_group_id')::uuid AND workspace_id = v_ws) THEN
      RAISE EXCEPTION 'experiment page group is not in its workspace' USING ERRCODE = '23514';
    END IF;
  ELSIF (v_rec ->> 'experiment_id') IS NOT NULL THEN
    SELECT workspace_id INTO v_parent FROM public.experiments
     WHERE id = (v_rec ->> 'experiment_id')::uuid;
    IF v_parent IS NULL OR v_parent <> v_ws THEN
      RAISE EXCEPTION 'experiment row workspace does not match its experiment' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.experiment_workspace_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS experiment_page_groups_workspace_guard ON public.experiment_page_groups;
CREATE TRIGGER experiment_page_groups_workspace_guard
  BEFORE INSERT OR UPDATE OF workspace_id, source_id ON public.experiment_page_groups
  FOR EACH ROW EXECUTE FUNCTION private.experiment_workspace_guard();

DROP TRIGGER IF EXISTS experiments_workspace_guard ON public.experiments;
CREATE TRIGGER experiments_workspace_guard
  BEFORE INSERT OR UPDATE OF workspace_id, source_id, gsc_source_id, ga4_source_id, page_group_id
  ON public.experiments
  FOR EACH ROW EXECUTE FUNCTION private.experiment_workspace_guard();

DROP TRIGGER IF EXISTS experiment_assignments_workspace_guard ON public.experiment_assignments;
CREATE TRIGGER experiment_assignments_workspace_guard
  BEFORE INSERT OR UPDATE OF workspace_id, experiment_id ON public.experiment_assignments
  FOR EACH ROW EXECUTE FUNCTION private.experiment_workspace_guard();

DROP TRIGGER IF EXISTS experiment_changes_workspace_guard ON public.experiment_changes;
CREATE TRIGGER experiment_changes_workspace_guard
  BEFORE INSERT OR UPDATE OF workspace_id, experiment_id ON public.experiment_changes
  FOR EACH ROW EXECUTE FUNCTION private.experiment_workspace_guard();

DROP TRIGGER IF EXISTS experiment_deliveries_workspace_guard ON public.experiment_deliveries;
CREATE TRIGGER experiment_deliveries_workspace_guard
  BEFORE INSERT OR UPDATE OF workspace_id, source_id, experiment_id ON public.experiment_deliveries
  FOR EACH ROW EXECUTE FUNCTION private.experiment_workspace_guard();

DROP TRIGGER IF EXISTS experiment_metrics_daily_workspace_guard ON public.experiment_metrics_daily;
CREATE TRIGGER experiment_metrics_daily_workspace_guard
  BEFORE INSERT OR UPDATE OF workspace_id, experiment_id ON public.experiment_metrics_daily
  FOR EACH ROW EXECUTE FUNCTION private.experiment_workspace_guard();

DROP TRIGGER IF EXISTS experiment_metric_days_workspace_guard ON public.experiment_metric_days;
CREATE TRIGGER experiment_metric_days_workspace_guard
  BEFORE INSERT OR UPDATE OF workspace_id, experiment_id ON public.experiment_metric_days
  FOR EACH ROW EXECUTE FUNCTION private.experiment_workspace_guard();

DROP TRIGGER IF EXISTS experiment_events_workspace_guard ON public.experiment_events;
CREATE TRIGGER experiment_events_workspace_guard
  BEFORE INSERT ON public.experiment_events
  FOR EACH ROW EXECUTE FUNCTION private.experiment_workspace_guard();

DROP TRIGGER IF EXISTS experiment_jobs_workspace_guard ON public.experiment_jobs;
CREATE TRIGGER experiment_jobs_workspace_guard
  BEFORE INSERT OR UPDATE OF workspace_id, experiment_id ON public.experiment_jobs
  FOR EACH ROW EXECUTE FUNCTION private.experiment_workspace_guard();

-- ── The design is locked once the experiment leaves draft ─────────────────
-- Prevents cherry-picking a metric after the fact, and re-drawing the split.
-- The verdict, once set, is final.
CREATE OR REPLACE FUNCTION private.experiment_lock_design()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.status <> 'draft' AND (
    NEW.primary_metric IS DISTINCT FROM OLD.primary_metric OR
    NEW.secondary_metrics IS DISTINCT FROM OLD.secondary_metrics OR
    NEW.change_type IS DISTINCT FROM OLD.change_type OR
    (NEW.page_group_id IS NOT NULL AND NEW.page_group_id IS DISTINCT FROM OLD.page_group_id) OR
    NEW.pre_period_start IS DISTINCT FROM OLD.pre_period_start OR
    NEW.pre_period_end IS DISTINCT FROM OLD.pre_period_end OR
    NEW.planned_min_days IS DISTINCT FROM OLD.planned_min_days OR
    NEW.planned_max_days IS DISTINCT FROM OLD.planned_max_days OR
    NEW.assignment_seed IS DISTINCT FROM OLD.assignment_seed OR
    NEW.assignment_attempts IS DISTINCT FROM OLD.assignment_attempts OR
    -- A disconnected repository or deleted group only ever becomes NULL.
    (NEW.source_id IS NOT NULL AND NEW.source_id IS DISTINCT FROM OLD.source_id) OR
    NEW.site_host IS DISTINCT FROM OLD.site_host OR
    NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
  ) THEN
    RAISE EXCEPTION 'experiment design is locked after draft' USING ERRCODE = '42501';
  END IF;
  IF OLD.approved_patch_hash IS NOT NULL
     AND NEW.approved_patch_hash IS DISTINCT FROM OLD.approved_patch_hash THEN
    RAISE EXCEPTION 'approved patch hash is final' USING ERRCODE = '42501';
  END IF;
  IF OLD.live_confirmed_at IS NOT NULL
     AND NEW.live_confirmed_at IS DISTINCT FROM OLD.live_confirmed_at THEN
    RAISE EXCEPTION 'live confirmation date is final' USING ERRCODE = '42501';
  END IF;
  IF OLD.verdict IS NOT NULL AND NEW.verdict IS DISTINCT FROM OLD.verdict THEN
    RAISE EXCEPTION 'experiment verdict is final' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.experiment_lock_design() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS experiments_lock_design ON public.experiments;
CREATE TRIGGER experiments_lock_design
  BEFORE UPDATE ON public.experiments
  FOR EACH ROW EXECUTE FUNCTION private.experiment_lock_design();

-- Assignments and changes are part of the design: frozen after draft, except
-- that a page may be excluded (404, canonical elsewhere) with a reason, and
-- the `active` flag follows the experiment.
CREATE OR REPLACE FUNCTION private.experiment_lock_children()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_row jsonb := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
BEGIN
  -- Deletes cascading from a deleted workspace or experiment (depth > 1).
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  SELECT status INTO v_status FROM public.experiments WHERE id = (v_row ->> 'experiment_id')::uuid;
  IF v_status IS NULL OR v_status = 'draft' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  -- Only the exclusion fields and `active` of an assignment may change.
  IF TG_TABLE_NAME = 'experiment_assignments' AND TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - 'excluded_at' - 'excluded_reason' - 'active')
       = (to_jsonb(OLD) - 'excluded_at' - 'excluded_reason' - 'active') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% is locked after the experiment leaves draft', TG_TABLE_NAME USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION private.experiment_lock_children() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS experiment_assignments_lock ON public.experiment_assignments;
CREATE TRIGGER experiment_assignments_lock
  BEFORE INSERT OR UPDATE OR DELETE ON public.experiment_assignments
  FOR EACH ROW EXECUTE FUNCTION private.experiment_lock_children();

DROP TRIGGER IF EXISTS experiment_changes_lock ON public.experiment_changes;
CREATE TRIGGER experiment_changes_lock
  BEFORE INSERT OR UPDATE OR DELETE ON public.experiment_changes
  FOR EACH ROW EXECUTE FUNCTION private.experiment_lock_children();

-- ── `active` follows the experiment status ────────────────────────────────
CREATE OR REPLACE FUNCTION private.experiment_assignment_set_active()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  SELECT status INTO v_status FROM public.experiments WHERE id = NEW.experiment_id;
  NEW.active := v_status IS NOT NULL AND v_status NOT IN ('closed', 'cancelled');
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.experiment_assignment_set_active() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS experiment_assignments_set_active ON public.experiment_assignments;
CREATE TRIGGER experiment_assignments_set_active
  BEFORE INSERT ON public.experiment_assignments
  FOR EACH ROW EXECUTE FUNCTION private.experiment_assignment_set_active();

CREATE OR REPLACE FUNCTION private.experiment_sync_assignment_active()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE public.experiment_assignments
       SET active = NEW.status NOT IN ('closed', 'cancelled')
     WHERE experiment_id = NEW.id
       AND active IS DISTINCT FROM (NEW.status NOT IN ('closed', 'cancelled'));
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.experiment_sync_assignment_active() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS experiments_sync_assignment_active ON public.experiments;
CREATE TRIGGER experiments_sync_assignment_active
  AFTER UPDATE OF status ON public.experiments
  FOR EACH ROW EXECUTE FUNCTION private.experiment_sync_assignment_active();

-- ── Events are append-only ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.experiment_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Cascades from a deleted experiment/workspace are allowed (depth > 1);
  -- a direct UPDATE or DELETE is not.
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'experiment_events is append-only' USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION private.experiment_events_append_only() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS experiment_events_immutable ON public.experiment_events;
CREATE TRIGGER experiment_events_immutable
  BEFORE UPDATE OR DELETE ON public.experiment_events
  FOR EACH ROW EXECUTE FUNCTION private.experiment_events_append_only();

-- ── updated_at ────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS experiment_page_groups_touch_updated_at ON public.experiment_page_groups;
CREATE TRIGGER experiment_page_groups_touch_updated_at
  BEFORE UPDATE ON public.experiment_page_groups
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS experiments_touch_updated_at ON public.experiments;
CREATE TRIGGER experiments_touch_updated_at
  BEFORE UPDATE ON public.experiments
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS experiment_deliveries_touch_updated_at ON public.experiment_deliveries;
CREATE TRIGGER experiment_deliveries_touch_updated_at
  BEFORE UPDATE ON public.experiment_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS experiment_jobs_touch_updated_at ON public.experiment_jobs;
CREATE TRIGGER experiment_jobs_touch_updated_at
  BEFORE UPDATE ON public.experiment_jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS workspace_report_branding_touch_updated_at ON public.workspace_report_branding;
CREATE TRIGGER workspace_report_branding_touch_updated_at
  BEFORE UPDATE ON public.workspace_report_branding
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ── Worker lease claim ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_experiment_jobs(
  p_worker text,
  p_max integer DEFAULT 4,
  p_lease_seconds integer DEFAULT 150,
  p_id uuid DEFAULT NULL
)
RETURNS SETOF public.experiment_jobs
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.experiment_jobs AS j
     SET lease_until = now() + make_interval(secs => greatest(p_lease_seconds, 30)),
         locked_by = p_worker,
         attempts = j.attempts + 1,
         status = 'running'
   WHERE j.id IN (
     SELECT u.id FROM public.experiment_jobs u
      WHERE u.status IN ('queued', 'running')
        AND (p_id IS NULL OR u.id = p_id)
        AND u.next_attempt_at <= now()
        AND (u.lease_until IS NULL OR u.lease_until < now())
      ORDER BY u.next_attempt_at
      LIMIT greatest(p_max, 0)
      FOR UPDATE SKIP LOCKED)
  RETURNING j.*;
$$;

REVOKE ALL ON FUNCTION public.claim_experiment_jobs(text, integer, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_experiment_jobs(text, integer, integer, uuid) TO service_role;

-- ── experiment_overview(): proven impact per workspace ────────────────────
-- One row per workspace the CALLER belongs to (Agency command center).
-- SECURITY INVOKER: sums run under the caller's RLS, correlated on each
-- workspace id. Kept separate from workspace_overview() so that function's
-- shape (and its earlier migration) stays untouched.
CREATE OR REPLACE FUNCTION public.experiment_overview()
RETURNS TABLE (
  workspace_id uuid,
  proven_monthly_value numeric,
  proven_value_currency text,
  won_experiments bigint,
  running_experiments bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    m.workspace_id,
    -- Estimated value of won changes that are still in place (not rolled back).
    (SELECT sum(e.estimated_monthly_value) FROM public.experiments e
      WHERE e.workspace_id = m.workspace_id AND e.verdict = 'win'
        AND e.status IN ('concluded', 'rolling_out', 'closed')
        AND (e.closed_via IS NULL OR e.closed_via IN ('rollout', 'kept'))),
    (SELECT max(e.value_currency) FROM public.experiments e
      WHERE e.workspace_id = m.workspace_id AND e.verdict = 'win' AND e.value_currency IS NOT NULL),
    (SELECT count(*) FROM public.experiments e
      WHERE e.workspace_id = m.workspace_id AND e.verdict = 'win'),
    (SELECT count(*) FROM public.experiments e
      WHERE e.workspace_id = m.workspace_id AND e.status IN ('running', 'analyzing'))
  FROM public.workspace_members m
  WHERE m.user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.experiment_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.experiment_overview() TO authenticated, service_role;
