-- Audience — who a workspace's content is for, what Mellox expects them to
-- think of a piece before it goes out, and what really happened afterwards
-- (ADR-0031, docs/adr/0031-audience-intelligence.md).
--
--   audience_twins         one row per audience group, every trait with its source
--   audience_runs          one leased row per deeper check or comparison
--   audience_run_events    append-only progress (real steps only)
--   audience_predictions   a score for one exact piece of text
--   audience_outcomes      the real result of a published piece, frozen at 7 days
--   audience_calibration   how far predictions have been from real results
--
-- Invariants:
--   * Nothing here writes to content_items. A prediction is about a piece, it
--     never changes it (and so can never un-approve it).
--   * A prediction belongs to the exact text it scored (subject_hash). Edited
--     text has no score until it is checked again.
--   * Members read their workspace's rows. There are no browser write policies:
--     every change is made by the service role from server functions and the worker.
--
-- Idempotent and non-destructive: safe to re-run.

-- ── Audience groups ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audience_twins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- Stable key inside the workspace. 'overall' is the one row that holds what
  -- was measured from the workspace's own posts.
  slug text NOT NULL,
  kind text NOT NULL DEFAULT 'group',
  name text NOT NULL,
  segment text NOT NULL DEFAULT '',
  summary text NOT NULL DEFAULT '',
  -- Rough share of the audience, 1-100. Used to size the simulated panel.
  weight integer NOT NULL DEFAULT 50,
  -- [{id, kind, text, source, confidence, url?}]. source says where a trait
  -- came from: user | brand_dna | website | market | competitor | measured | assumed.
  profile jsonb NOT NULL DEFAULT '[]'::jsonb,
  origin text NOT NULL DEFAULT 'generated',
  origin_ref text,
  status text NOT NULL DEFAULT 'active',
  version integer NOT NULL DEFAULT 1,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audience_twins_kind_check CHECK (kind IN ('group', 'overall')),
  CONSTRAINT audience_twins_origin_check CHECK (origin IN ('brand_dna', 'user', 'generated', 'system')),
  CONSTRAINT audience_twins_status_check CHECK (status IN ('active', 'archived')),
  CONSTRAINT audience_twins_slug_check CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,59}$'),
  CONSTRAINT audience_twins_name_length CHECK (char_length(name) BETWEEN 1 AND 80),
  CONSTRAINT audience_twins_segment_length CHECK (char_length(segment) <= 120),
  CONSTRAINT audience_twins_summary_length CHECK (char_length(summary) <= 600),
  CONSTRAINT audience_twins_weight_check CHECK (weight BETWEEN 1 AND 100),
  CONSTRAINT audience_twins_profile_is_array CHECK (jsonb_typeof(profile) = 'array'),
  CONSTRAINT audience_twins_profile_size CHECK (pg_column_size(profile) <= 60000),
  CONSTRAINT audience_twins_slug_unique UNIQUE (workspace_id, slug)
);

CREATE INDEX IF NOT EXISTS audience_twins_workspace_idx
  ON public.audience_twins (workspace_id, status, weight DESC);

-- ── Runs (leased) ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audience_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  stage text NOT NULL DEFAULT 'queued',
  -- {done, total}: counted model answers, never a timer.
  progress jsonb NOT NULL DEFAULT '{"done":0,"total":0}'::jsonb,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Partial work is kept here between leases so a retry never repeats a paid step.
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_item_id uuid REFERENCES public.content_items(id) ON DELETE SET NULL,
  idempotency_key text NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cancel_requested boolean NOT NULL DEFAULT false,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT audience_runs_kind_check CHECK (kind IN ('twins', 'pulse', 'tournament')),
  CONSTRAINT audience_runs_status_check CHECK (status IN (
    'queued', 'running', 'succeeded', 'failed', 'cancelled')),
  CONSTRAINT audience_runs_stage_check CHECK (stage ~ '^[a-z][a-z_]{1,29}$'),
  CONSTRAINT audience_runs_key_length CHECK (char_length(idempotency_key) BETWEEN 8 AND 160),
  CONSTRAINT audience_runs_last_error_length CHECK (last_error IS NULL OR char_length(last_error) <= 500),
  CONSTRAINT audience_runs_input_size CHECK (pg_column_size(input) <= 60000),
  CONSTRAINT audience_runs_key_unique UNIQUE (workspace_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS audience_runs_due_idx
  ON public.audience_runs (next_attempt_at) WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS audience_runs_workspace_idx
  ON public.audience_runs (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audience_runs_content_idx
  ON public.audience_runs (content_item_id, created_at DESC) WHERE content_item_id IS NOT NULL;

-- ── Run events (append-only) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audience_run_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  run_id uuid NOT NULL REFERENCES public.audience_runs(id) ON DELETE CASCADE,
  kind text NOT NULL,
  summary text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audience_run_events_kind_check CHECK (kind ~ '^[a-z][a-z_]{1,39}$'),
  CONSTRAINT audience_run_events_summary_length CHECK (char_length(summary) BETWEEN 1 AND 300)
);

CREATE INDEX IF NOT EXISTS audience_run_events_run_idx
  ON public.audience_run_events (run_id, created_at);

-- ── Predictions ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audience_predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- Studio deletes a row when its platform is removed; the score outlives it.
  content_item_id uuid REFERENCES public.content_items(id) ON DELETE SET NULL,
  run_id uuid REFERENCES public.audience_runs(id) ON DELETE SET NULL,
  variant_index integer,
  -- {kind, platform, title, body, ...}: the exact text that was scored.
  subject jsonb NOT NULL,
  subject_hash text NOT NULL,
  -- Which version of the audience answered.
  twins_fingerprint text NOT NULL,
  depth text NOT NULL,
  platform text NOT NULL DEFAULT '',
  content_type text NOT NULL DEFAULT '',
  overall integer NOT NULL,
  dimensions jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  score_version integer NOT NULL,
  -- True once the number was adjusted by this workspace's real results.
  calibrated boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audience_predictions_depth_check CHECK (depth IN ('score', 'pulse')),
  CONSTRAINT audience_predictions_overall_check CHECK (overall BETWEEN 0 AND 100),
  CONSTRAINT audience_predictions_hash_length CHECK (char_length(subject_hash) BETWEEN 16 AND 80),
  CONSTRAINT audience_predictions_fingerprint_length CHECK (char_length(twins_fingerprint) BETWEEN 1 AND 80),
  CONSTRAINT audience_predictions_subject_size CHECK (pg_column_size(subject) <= 40000),
  CONSTRAINT audience_predictions_result_size CHECK (pg_column_size(result) <= 120000),
  -- The same text, audience and scoring version is never paid for twice.
  CONSTRAINT audience_predictions_cache_unique
    UNIQUE (workspace_id, subject_hash, twins_fingerprint, depth, score_version)
);

CREATE INDEX IF NOT EXISTS audience_predictions_content_idx
  ON public.audience_predictions (content_item_id, created_at DESC) WHERE content_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS audience_predictions_workspace_idx
  ON public.audience_predictions (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audience_predictions_run_idx
  ON public.audience_predictions (run_id) WHERE run_id IS NOT NULL;

-- ── Outcomes (real results, frozen once) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audience_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  prediction_id uuid NOT NULL REFERENCES public.audience_predictions(id) ON DELETE CASCADE,
  content_item_id uuid REFERENCES public.content_items(id) ON DELETE SET NULL,
  platform text NOT NULL DEFAULT '',
  content_type text NOT NULL DEFAULT '',
  title text NOT NULL DEFAULT '',
  horizon text NOT NULL DEFAULT 'd7',
  -- {views, likes, comments, shares, saves} as read from the publication.
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  engagement numeric NOT NULL,
  predicted integer NOT NULL,
  -- Where this post sits among the workspace's own measured posts on the same
  -- platform (0-100). NULL until there are enough posts to compare with.
  actual integer,
  delivered_at timestamptz,
  measured_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audience_outcomes_horizon_check CHECK (horizon IN ('d7')),
  CONSTRAINT audience_outcomes_predicted_check CHECK (predicted BETWEEN 0 AND 100),
  CONSTRAINT audience_outcomes_actual_check CHECK (actual IS NULL OR actual BETWEEN 0 AND 100),
  CONSTRAINT audience_outcomes_engagement_check CHECK (engagement >= 0),
  CONSTRAINT audience_outcomes_title_length CHECK (char_length(title) <= 200),
  CONSTRAINT audience_outcomes_once UNIQUE (prediction_id, horizon)
);

CREATE INDEX IF NOT EXISTS audience_outcomes_workspace_idx
  ON public.audience_outcomes (workspace_id, platform, measured_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS audience_outcomes_content_once_idx
  ON public.audience_outcomes (content_item_id, horizon) WHERE content_item_id IS NOT NULL;

-- ── Calibration ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audience_calibration (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- 'all' on both is the workspace-wide row that carries the learned sentences.
  platform text NOT NULL,
  content_type text NOT NULL,
  n integer NOT NULL DEFAULT 0,
  -- Mean of (predicted - actual). Positive means Mellox was too optimistic.
  bias numeric NOT NULL DEFAULT 0,
  mae numeric NOT NULL DEFAULT 0,
  learned jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, platform, content_type),
  CONSTRAINT audience_calibration_n_check CHECK (n >= 0),
  CONSTRAINT audience_calibration_learned_is_array CHECK (jsonb_typeof(learned) = 'array')
);

-- ── Row-level security: members read, only the service role writes ───────
ALTER TABLE public.audience_twins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audience_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audience_run_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audience_predictions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audience_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audience_calibration ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.audience_twins, public.audience_runs, public.audience_run_events,
  public.audience_predictions, public.audience_outcomes, public.audience_calibration
  FROM anon, authenticated;
GRANT SELECT ON public.audience_twins, public.audience_runs, public.audience_run_events,
  public.audience_predictions, public.audience_outcomes, public.audience_calibration
  TO authenticated;
GRANT ALL ON public.audience_twins, public.audience_runs, public.audience_run_events,
  public.audience_predictions, public.audience_outcomes, public.audience_calibration
  TO service_role;

DROP POLICY IF EXISTS "Workspace members read audience twins" ON public.audience_twins;
CREATE POLICY "Workspace members read audience twins"
  ON public.audience_twins FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Workspace members read audience runs" ON public.audience_runs;
CREATE POLICY "Workspace members read audience runs"
  ON public.audience_runs FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Workspace members read audience run events" ON public.audience_run_events;
CREATE POLICY "Workspace members read audience run events"
  ON public.audience_run_events FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Workspace members read audience predictions" ON public.audience_predictions;
CREATE POLICY "Workspace members read audience predictions"
  ON public.audience_predictions FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Workspace members read audience outcomes" ON public.audience_outcomes;
CREATE POLICY "Workspace members read audience outcomes"
  ON public.audience_outcomes FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Workspace members read audience calibration" ON public.audience_calibration;
CREATE POLICY "Workspace members read audience calibration"
  ON public.audience_calibration FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

-- ── Tenant integrity: every row stays in its parent's workspace ───────────
CREATE OR REPLACE FUNCTION private.audience_workspace_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec jsonb := to_jsonb(NEW);
  v_ws uuid := (v_rec ->> 'workspace_id')::uuid;
BEGIN
  IF (v_rec ->> 'content_item_id') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.content_items
     WHERE id = (v_rec ->> 'content_item_id')::uuid AND workspace_id = v_ws) THEN
    RAISE EXCEPTION 'audience row workspace does not match its content' USING ERRCODE = '23514';
  END IF;
  IF (v_rec ->> 'run_id') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.audience_runs
     WHERE id = (v_rec ->> 'run_id')::uuid AND workspace_id = v_ws) THEN
    RAISE EXCEPTION 'audience row workspace does not match its run' USING ERRCODE = '23514';
  END IF;
  IF (v_rec ->> 'prediction_id') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.audience_predictions
     WHERE id = (v_rec ->> 'prediction_id')::uuid AND workspace_id = v_ws) THEN
    RAISE EXCEPTION 'audience row workspace does not match its prediction' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.audience_workspace_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS audience_runs_workspace_guard ON public.audience_runs;
CREATE TRIGGER audience_runs_workspace_guard
  BEFORE INSERT OR UPDATE OF workspace_id, content_item_id ON public.audience_runs
  FOR EACH ROW EXECUTE FUNCTION private.audience_workspace_guard();

DROP TRIGGER IF EXISTS audience_run_events_workspace_guard ON public.audience_run_events;
CREATE TRIGGER audience_run_events_workspace_guard
  BEFORE INSERT ON public.audience_run_events
  FOR EACH ROW EXECUTE FUNCTION private.audience_workspace_guard();

DROP TRIGGER IF EXISTS audience_predictions_workspace_guard ON public.audience_predictions;
CREATE TRIGGER audience_predictions_workspace_guard
  BEFORE INSERT OR UPDATE OF workspace_id, content_item_id, run_id ON public.audience_predictions
  FOR EACH ROW EXECUTE FUNCTION private.audience_workspace_guard();

DROP TRIGGER IF EXISTS audience_outcomes_workspace_guard ON public.audience_outcomes;
CREATE TRIGGER audience_outcomes_workspace_guard
  BEFORE INSERT OR UPDATE OF workspace_id, content_item_id, prediction_id ON public.audience_outcomes
  FOR EACH ROW EXECUTE FUNCTION private.audience_workspace_guard();

-- ── Run events are append-only ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.audience_run_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Cascades from a deleted workspace or run are allowed (depth > 1); a direct
  -- UPDATE or DELETE is not.
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'audience_run_events is append-only' USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION private.audience_run_events_append_only() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS audience_run_events_immutable ON public.audience_run_events;
CREATE TRIGGER audience_run_events_immutable
  BEFORE UPDATE OR DELETE ON public.audience_run_events
  FOR EACH ROW EXECUTE FUNCTION private.audience_run_events_append_only();

-- ── updated_at ────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS audience_twins_touch_updated_at ON public.audience_twins;
CREATE TRIGGER audience_twins_touch_updated_at
  BEFORE UPDATE ON public.audience_twins
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS audience_runs_touch_updated_at ON public.audience_runs;
CREATE TRIGGER audience_runs_touch_updated_at
  BEFORE UPDATE ON public.audience_runs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ── Worker lease claim ────────────────────────────────────────────────────
-- Claiming never changes a run's status: the runner does that with a
-- compare-and-set on (id, locked_by). No cron job is added: the existing
-- run-schedules hook advances the worker.
CREATE OR REPLACE FUNCTION public.claim_audience_runs(
  p_worker text,
  p_max integer DEFAULT 6,
  p_lease_seconds integer DEFAULT 150,
  p_id uuid DEFAULT NULL
)
RETURNS SETOF public.audience_runs
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.audience_runs AS r
     SET lease_until = now() + make_interval(secs => greatest(p_lease_seconds, 30)),
         locked_by = p_worker
   WHERE r.id IN (
     SELECT u.id FROM public.audience_runs u
      WHERE u.status IN ('queued', 'running')
        AND (p_id IS NULL OR u.id = p_id)
        AND u.next_attempt_at <= now()
        AND (u.lease_until IS NULL OR u.lease_until < now())
      ORDER BY u.next_attempt_at
      LIMIT greatest(p_max, 0)
      FOR UPDATE SKIP LOCKED)
  RETURNING r.*;
$$;

REVOKE ALL ON FUNCTION public.claim_audience_runs(text, integer, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_audience_runs(text, integer, integer, uuid) TO service_role;

-- ── Billing: a deeper check or comparison is a background charge ──────────
ALTER TABLE public.billing_async_links DROP CONSTRAINT IF EXISTS billing_async_links_kind_check;
ALTER TABLE public.billing_async_links ADD CONSTRAINT billing_async_links_kind_check
  CHECK (kind IN (
    'geo_agent_run', 'fix_batch', 'competitor_intel', 'competitor_profile', 'brand_voice',
    'audience_run'));
