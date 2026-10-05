-- Autopilot — one engine that plans, creates, schedules and measures a
-- workspace's marketing (ADR-0028, docs/adr/0028-autopilot.md).
--
--   autopilot_programs        the settings a person chose (goal, channels, pace, limits, mode)
--   marketing_opportunities   scored, deduplicated things worth responding to
--   autopilot_actions         one leased row per step, claimed with SKIP LOCKED
--   autopilot_events          append-only history (real transitions only)
--
-- Invariants:
--   * Approval lives in content_items.status and nowhere else. An action only
--     records what it saw there.
--   * (workspace_id, dedupe_key) is unique, so a replayed plan, a double click
--     or two workers can never create the same piece twice.
--   * Members read their workspace's rows. There are no browser write policies:
--     every change is made by the service role from server functions and the worker.
--
-- Idempotent and non-destructive: safe to re-run.

-- ── Programs ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.autopilot_programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'running',
  -- Why it is paused: 'user', or a system reason such as 'member_left'.
  pause_reason text,
  mode text NOT NULL DEFAULT 'assist',
  goal text NOT NULL,
  goal_note text NOT NULL DEFAULT '',
  platforms text[] NOT NULL DEFAULT '{}'::text[],
  content_types text[] NOT NULL DEFAULT '{}'::text[],
  posts_per_week integer NOT NULL DEFAULT 3,
  -- 0 = Sunday … 6 = Saturday. Empty means any day.
  weekdays integer[] NOT NULL DEFAULT '{}'::integer[],
  timezone text NOT NULL DEFAULT 'UTC',
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  credit_cap_per_week integer NOT NULL DEFAULT 150,
  video_cap_per_week integer NOT NULL DEFAULT 0,
  act_on_opportunities boolean NOT NULL DEFAULT false,
  -- The member whose plan, credits and publishing rights the program uses.
  -- Re-checked on every run; the program pauses if they leave.
  acting_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- The last week that has been planned (0 = none yet).
  cycle integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT autopilot_programs_status_check CHECK (status IN ('running', 'paused', 'completed', 'stopped')),
  CONSTRAINT autopilot_programs_mode_check CHECK (mode IN ('assist', 'autopilot', 'full')),
  CONSTRAINT autopilot_programs_goal_check CHECK (char_length(goal) BETWEEN 1 AND 40),
  CONSTRAINT autopilot_programs_goal_note_length CHECK (char_length(goal_note) <= 600),
  CONSTRAINT autopilot_programs_pace_check CHECK (posts_per_week BETWEEN 1 AND 14),
  CONSTRAINT autopilot_programs_dates_check CHECK (ends_on >= starts_on AND ends_on <= starts_on + 366),
  CONSTRAINT autopilot_programs_caps_check CHECK (
    credit_cap_per_week BETWEEN 0 AND 100000 AND video_cap_per_week BETWEEN 0 AND 50),
  CONSTRAINT autopilot_programs_pause_reason_length CHECK (
    pause_reason IS NULL OR char_length(pause_reason) <= 60),
  CONSTRAINT autopilot_programs_timezone_length CHECK (char_length(timezone) BETWEEN 1 AND 64)
);

-- One live program per workspace; finished ones stay as history.
CREATE UNIQUE INDEX IF NOT EXISTS autopilot_programs_one_live_idx
  ON public.autopilot_programs (workspace_id) WHERE status IN ('running', 'paused');
CREATE INDEX IF NOT EXISTS autopilot_programs_workspace_idx
  ON public.autopilot_programs (workspace_id, created_at DESC);

-- ── Opportunities ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.marketing_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  summary text NOT NULL DEFAULT '',
  why_relevant text NOT NULL DEFAULT '',
  suggested_action text NOT NULL DEFAULT '',
  suggested_type text NOT NULL DEFAULT 'social',
  suggested_platforms text[] NOT NULL DEFAULT '{}'::text[],
  -- [{title, url, date}] copied from the source record, never from a model.
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_kind text NOT NULL,
  source_id text,
  fingerprint text NOT NULL,
  score integer NOT NULL,
  score_parts jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'new',
  expires_at timestamptz NOT NULL,
  decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_opportunities_kind_check CHECK (kind IN (
    'trend', 'competitor', 'news', 'customer', 'performance')),
  CONSTRAINT marketing_opportunities_status_check CHECK (status IN (
    'new', 'accepted', 'dismissed', 'expired', 'done')),
  CONSTRAINT marketing_opportunities_score_check CHECK (score BETWEEN 0 AND 100),
  CONSTRAINT marketing_opportunities_title_length CHECK (char_length(title) BETWEEN 1 AND 200),
  CONSTRAINT marketing_opportunities_summary_length CHECK (char_length(summary) <= 1200),
  CONSTRAINT marketing_opportunities_why_length CHECK (char_length(why_relevant) <= 400),
  CONSTRAINT marketing_opportunities_action_length CHECK (char_length(suggested_action) <= 400),
  CONSTRAINT marketing_opportunities_fingerprint_length CHECK (char_length(fingerprint) BETWEEN 1 AND 200),
  CONSTRAINT marketing_opportunities_fingerprint_unique UNIQUE (workspace_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS marketing_opportunities_open_idx
  ON public.marketing_opportunities (workspace_id, status, score DESC);

-- ── Actions (leased) ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.autopilot_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- NULL for one-off content made from an opportunity without a program.
  program_id uuid REFERENCES public.autopilot_programs(id) ON DELETE CASCADE,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'planned',
  dedupe_key text NOT NULL,
  cycle integer NOT NULL DEFAULT 0,
  slot integer,
  planned_for timestamptz,
  platform text,
  content_type text,
  title text NOT NULL DEFAULT '',
  brief text NOT NULL DEFAULT '',
  -- Why this piece was chosen, shown to the person who approves it.
  reason text NOT NULL DEFAULT '',
  goal text,
  opportunity_id uuid REFERENCES public.marketing_opportunities(id) ON DELETE SET NULL,
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  studio_job_id uuid,
  content_item_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  generation_attempt integer NOT NULL DEFAULT 0,
  credits_charged integer NOT NULL DEFAULT 0,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- 'user' or 'auto' (Full mode, every guardrail passed).
  approved_via text,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  locked_by text,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  CONSTRAINT autopilot_actions_kind_check CHECK (kind IN ('plan', 'content', 'scan')),
  CONSTRAINT autopilot_actions_status_check CHECK (status IN (
    'proposed', 'planned', 'generating', 'needs_approval', 'approved', 'scheduled',
    'published', 'measured', 'done', 'skipped', 'missed', 'rejected', 'failed', 'cancelled')),
  CONSTRAINT autopilot_actions_approved_via_check CHECK (
    approved_via IS NULL OR approved_via IN ('user', 'auto')),
  CONSTRAINT autopilot_actions_dedupe_length CHECK (char_length(dedupe_key) BETWEEN 3 AND 160),
  CONSTRAINT autopilot_actions_title_length CHECK (char_length(title) <= 200),
  CONSTRAINT autopilot_actions_brief_length CHECK (char_length(brief) <= 4000),
  CONSTRAINT autopilot_actions_reason_length CHECK (char_length(reason) <= 500),
  CONSTRAINT autopilot_actions_last_error_length CHECK (last_error IS NULL OR char_length(last_error) <= 500),
  CONSTRAINT autopilot_actions_dedupe_unique UNIQUE (workspace_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS autopilot_actions_due_idx
  ON public.autopilot_actions (next_attempt_at)
  WHERE status IN ('planned', 'generating', 'needs_approval', 'approved', 'scheduled', 'published');
CREATE INDEX IF NOT EXISTS autopilot_actions_workspace_status_idx
  ON public.autopilot_actions (workspace_id, status, planned_for);
CREATE INDEX IF NOT EXISTS autopilot_actions_program_cycle_idx
  ON public.autopilot_actions (program_id, cycle);

-- ── Events (append-only) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.autopilot_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  program_id uuid REFERENCES public.autopilot_programs(id) ON DELETE CASCADE,
  action_id uuid REFERENCES public.autopilot_actions(id) ON DELETE CASCADE,
  opportunity_id uuid REFERENCES public.marketing_opportunities(id) ON DELETE CASCADE,
  kind text NOT NULL,
  summary text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor text NOT NULL DEFAULT 'system',
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT autopilot_events_kind_check CHECK (kind ~ '^[a-z][a-z_]{1,39}$'),
  CONSTRAINT autopilot_events_actor_check CHECK (actor IN ('system', 'user')),
  CONSTRAINT autopilot_events_summary_length CHECK (char_length(summary) BETWEEN 1 AND 500)
);

CREATE INDEX IF NOT EXISTS autopilot_events_workspace_idx
  ON public.autopilot_events (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS autopilot_events_action_idx
  ON public.autopilot_events (action_id, created_at);

-- ── Row-level security: members read, only the service role writes ───────
ALTER TABLE public.autopilot_programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketing_opportunities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.autopilot_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.autopilot_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.autopilot_programs, public.marketing_opportunities,
  public.autopilot_actions, public.autopilot_events
  FROM anon, authenticated;
GRANT SELECT ON public.autopilot_programs, public.marketing_opportunities,
  public.autopilot_actions, public.autopilot_events
  TO authenticated;
GRANT ALL ON public.autopilot_programs, public.marketing_opportunities,
  public.autopilot_actions, public.autopilot_events
  TO service_role;

DROP POLICY IF EXISTS "Workspace members read autopilot programs" ON public.autopilot_programs;
CREATE POLICY "Workspace members read autopilot programs"
  ON public.autopilot_programs FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Workspace members read marketing opportunities" ON public.marketing_opportunities;
CREATE POLICY "Workspace members read marketing opportunities"
  ON public.marketing_opportunities FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Workspace members read autopilot actions" ON public.autopilot_actions;
CREATE POLICY "Workspace members read autopilot actions"
  ON public.autopilot_actions FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Workspace members read autopilot events" ON public.autopilot_events;
CREATE POLICY "Workspace members read autopilot events"
  ON public.autopilot_events FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

-- ── Tenant integrity: every row stays in its parent's workspace ───────────
CREATE OR REPLACE FUNCTION private.autopilot_workspace_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec jsonb := to_jsonb(NEW);
  v_ws uuid := (v_rec ->> 'workspace_id')::uuid;
BEGIN
  IF (v_rec ->> 'program_id') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.autopilot_programs
     WHERE id = (v_rec ->> 'program_id')::uuid AND workspace_id = v_ws) THEN
    RAISE EXCEPTION 'autopilot row workspace does not match its program' USING ERRCODE = '23514';
  END IF;
  IF (v_rec ->> 'opportunity_id') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.marketing_opportunities
     WHERE id = (v_rec ->> 'opportunity_id')::uuid AND workspace_id = v_ws) THEN
    RAISE EXCEPTION 'autopilot row workspace does not match its opportunity' USING ERRCODE = '23514';
  END IF;
  IF (v_rec ->> 'action_id') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.autopilot_actions
     WHERE id = (v_rec ->> 'action_id')::uuid AND workspace_id = v_ws) THEN
    RAISE EXCEPTION 'autopilot row workspace does not match its action' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.autopilot_workspace_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS autopilot_programs_workspace_guard ON public.autopilot_programs;
CREATE TRIGGER autopilot_programs_workspace_guard
  BEFORE INSERT OR UPDATE OF workspace_id ON public.autopilot_programs
  FOR EACH ROW EXECUTE FUNCTION private.autopilot_workspace_guard();

DROP TRIGGER IF EXISTS autopilot_actions_workspace_guard ON public.autopilot_actions;
CREATE TRIGGER autopilot_actions_workspace_guard
  BEFORE INSERT OR UPDATE OF workspace_id, program_id, opportunity_id ON public.autopilot_actions
  FOR EACH ROW EXECUTE FUNCTION private.autopilot_workspace_guard();

DROP TRIGGER IF EXISTS autopilot_events_workspace_guard ON public.autopilot_events;
CREATE TRIGGER autopilot_events_workspace_guard
  BEFORE INSERT ON public.autopilot_events
  FOR EACH ROW EXECUTE FUNCTION private.autopilot_workspace_guard();

-- ── Events are append-only ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.autopilot_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Cascades from a deleted workspace, program or action are allowed
  -- (depth > 1); a direct UPDATE or DELETE is not.
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'autopilot_events is append-only' USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION private.autopilot_events_append_only() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS autopilot_events_immutable ON public.autopilot_events;
CREATE TRIGGER autopilot_events_immutable
  BEFORE UPDATE OR DELETE ON public.autopilot_events
  FOR EACH ROW EXECUTE FUNCTION private.autopilot_events_append_only();

-- ── updated_at ────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS autopilot_programs_touch_updated_at ON public.autopilot_programs;
CREATE TRIGGER autopilot_programs_touch_updated_at
  BEFORE UPDATE ON public.autopilot_programs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS marketing_opportunities_touch_updated_at ON public.marketing_opportunities;
CREATE TRIGGER marketing_opportunities_touch_updated_at
  BEFORE UPDATE ON public.marketing_opportunities
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS autopilot_actions_touch_updated_at ON public.autopilot_actions;
CREATE TRIGGER autopilot_actions_touch_updated_at
  BEFORE UPDATE ON public.autopilot_actions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
