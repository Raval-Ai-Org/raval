-- Agent control plane (audit §17–19, Stages 2–4): durable runs, per-step
-- audit, approval requests, findings, and the workspace kill switch.
--
-- The model may recommend; the platform validates, authorizes, executes,
-- persists and audits. Every row here is written by the server (service role)
-- through src/server/agents; members can READ their workspace's rows and make
-- decisions only through the authenticated, role-checked /api/agents routes.

-- ── agent_runs: extend the existing table into a durable run record ────────
ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS worker text,
  ADD COLUMN IF NOT EXISTS trigger text NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS finished_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS model text,
  ADD COLUMN IF NOT EXISTS input_tokens integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS output_tokens integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_usd numeric(12, 6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS duration_ms integer,
  ADD COLUMN IF NOT EXISTS error text,
  ADD COLUMN IF NOT EXISTS budget jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS summary text,
  ADD COLUMN IF NOT EXISTS parent_run_id uuid REFERENCES public.agent_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS agent_runs_worker_idx
  ON public.agent_runs (workspace_id, worker, created_at DESC);

-- ── agent_run_steps: one row per tool call / model call / policy decision ──
CREATE TABLE IF NOT EXISTS public.agent_run_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.agent_runs(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  kind text NOT NULL CHECK (kind IN ('tool', 'model', 'policy', 'note')),
  tool text,
  tool_call_id text,
  redacted_args jsonb NOT NULL DEFAULT '{}'::jsonb,
  policy_decision text CHECK (policy_decision IN ('allow', 'require_approval', 'deny')),
  status text NOT NULL DEFAULT 'ok' CHECK (status IN ('ok', 'error', 'denied', 'pending_approval')),
  result_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  latency_ms integer,
  cost_usd numeric(12, 6) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, seq)
);

CREATE INDEX IF NOT EXISTS agent_run_steps_run_idx ON public.agent_run_steps (run_id, seq);

-- ── agent_action_requests: proposed side effects awaiting a human ──────────
CREATE TABLE IF NOT EXISTS public.agent_action_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  run_id uuid REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'worker' CHECK (source IN ('worker', 'chat', 'user')),
  tool text NOT NULL,
  args jsonb NOT NULL DEFAULT '{}'::jsonb,
  title text NOT NULL,
  preview jsonb NOT NULL DEFAULT '{}'::jsonb,
  affected_records jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'suggested'
    CHECK (status IN ('suggested', 'approved', 'rejected', 'executed', 'failed', 'expired')),
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  decision_reason text,
  executed_at timestamptz,
  result jsonb,
  error text,
  idempotency_key text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agent_action_requests_workspace_idx
  ON public.agent_action_requests (workspace_id, status, created_at DESC);

-- ── agent_findings: what a worker observed and recommends ──────────────────
CREATE TABLE IF NOT EXISTS public.agent_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  run_id uuid REFERENCES public.agent_runs(id) ON DELETE SET NULL,
  worker text NOT NULL,
  fingerprint text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  title text NOT NULL,
  summary text NOT NULL DEFAULT '',
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  hypotheses jsonb NOT NULL DEFAULT '[]'::jsonb,
  affected jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommended_action text NOT NULL DEFAULT '',
  requires_human_approval boolean NOT NULL DEFAULT true,
  confidence numeric(4, 3) NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 1),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'acknowledged', 'resolved')),
  occurrences integer NOT NULL DEFAULT 1,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One live finding per (workspace, fingerprint): a re-detection bumps
-- occurrences instead of flooding the inbox.
CREATE UNIQUE INDEX IF NOT EXISTS agent_findings_open_fingerprint_idx
  ON public.agent_findings (workspace_id, fingerprint)
  WHERE status <> 'resolved';
CREATE INDEX IF NOT EXISTS agent_findings_workspace_idx
  ON public.agent_findings (workspace_id, status, created_at DESC);

-- ── workspace_agent_settings: kill switch + per-worker enablement ──────────
CREATE TABLE IF NOT EXISTS public.workspace_agent_settings (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  agents_paused boolean NOT NULL DEFAULT false,
  disabled_workers text[] NOT NULL DEFAULT '{}',
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── RLS: members read, only the service role writes ─────────────────────────
ALTER TABLE public.agent_run_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_action_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_agent_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.agent_run_steps, public.agent_action_requests,
  public.agent_findings, public.workspace_agent_settings FROM anon, authenticated;
GRANT SELECT ON public.agent_run_steps, public.agent_action_requests,
  public.agent_findings, public.workspace_agent_settings TO authenticated;
GRANT ALL ON public.agent_run_steps, public.agent_action_requests,
  public.agent_findings, public.workspace_agent_settings TO service_role;

DROP POLICY IF EXISTS "Members read run steps" ON public.agent_run_steps;
CREATE POLICY "Members read run steps" ON public.agent_run_steps
  FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Members read action requests" ON public.agent_action_requests;
CREATE POLICY "Members read action requests" ON public.agent_action_requests
  FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Members read findings" ON public.agent_findings;
CREATE POLICY "Members read findings" ON public.agent_findings
  FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Members read agent settings" ON public.workspace_agent_settings;
CREATE POLICY "Members read agent settings" ON public.workspace_agent_settings
  FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DO $$
BEGIN
  IF to_regprocedure('public.touch_updated_at()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS agent_runs_touch ON public.agent_runs;
    CREATE TRIGGER agent_runs_touch BEFORE UPDATE ON public.agent_runs
      FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
    DROP TRIGGER IF EXISTS agent_action_requests_touch ON public.agent_action_requests;
    CREATE TRIGGER agent_action_requests_touch BEFORE UPDATE ON public.agent_action_requests
      FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
    DROP TRIGGER IF EXISTS agent_findings_touch ON public.agent_findings;
    CREATE TRIGGER agent_findings_touch BEFORE UPDATE ON public.agent_findings
      FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
  END IF;
END
$$;
