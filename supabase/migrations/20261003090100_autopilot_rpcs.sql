-- Autopilot — worker lease claim and the cross-client overview (ADR-0028).
--
--   claim_autopilot_actions()   SKIP LOCKED lease for the worker (service role only)
--   autopilot_overview()        one row per workspace the CALLER belongs to
--
-- No cron job is added: the existing run-schedules hook advances the worker.
--
-- Idempotent: safe to re-run.

-- ── Worker lease claim ────────────────────────────────────────────────────
-- Claiming never changes an action's status: the runner does that with a
-- compare-and-set on (id, status, locked_by). Actions of a paused or finished
-- program are left alone.
CREATE OR REPLACE FUNCTION public.claim_autopilot_actions(
  p_worker text,
  p_max integer DEFAULT 12,
  p_lease_seconds integer DEFAULT 180,
  p_id uuid DEFAULT NULL
)
RETURNS SETOF public.autopilot_actions
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.autopilot_actions AS a
     SET lease_until = now() + make_interval(secs => greatest(p_lease_seconds, 30)),
         locked_by = p_worker
   WHERE a.id IN (
     SELECT u.id FROM public.autopilot_actions u
      WHERE u.status IN ('planned', 'generating', 'needs_approval', 'approved', 'scheduled', 'published')
        AND (p_id IS NULL OR u.id = p_id)
        AND u.next_attempt_at <= now()
        AND (u.lease_until IS NULL OR u.lease_until < now())
        AND (u.program_id IS NULL OR EXISTS (
          SELECT 1 FROM public.autopilot_programs p
           WHERE p.id = u.program_id AND p.status = 'running'))
      ORDER BY u.next_attempt_at
      LIMIT greatest(p_max, 0)
      FOR UPDATE SKIP LOCKED)
  RETURNING a.*;
$$;

REVOKE ALL ON FUNCTION public.claim_autopilot_actions(text, integer, integer, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_autopilot_actions(text, integer, integer, uuid) TO service_role;

-- ── autopilot_overview(): Agency HQ ───────────────────────────────────────
-- SECURITY INVOKER: every count runs under the caller's RLS, correlated on
-- each workspace id, so a row can only describe a workspace the caller is a
-- member of. Kept separate from workspace_overview() so that function's shape
-- stays untouched.
CREATE OR REPLACE FUNCTION public.autopilot_overview()
RETURNS TABLE (
  workspace_id uuid,
  program_id uuid,
  status text,
  pause_reason text,
  mode text,
  ends_on date,
  needs_approval bigint,
  plan_waiting bigint,
  new_opportunities bigint,
  failures bigint,
  missed bigint,
  performance_warnings bigint,
  next_action_at timestamptz,
  next_action_title text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    m.workspace_id,
    p.id,
    p.status,
    p.pause_reason,
    p.mode,
    p.ends_on,
    (SELECT count(*) FROM public.autopilot_actions a
      WHERE a.workspace_id = m.workspace_id AND a.kind = 'content' AND a.status = 'needs_approval'),
    (SELECT count(*) FROM public.autopilot_actions a
      WHERE a.workspace_id = m.workspace_id AND a.kind = 'content' AND a.status = 'proposed'),
    (SELECT count(*) FROM public.marketing_opportunities o
      WHERE o.workspace_id = m.workspace_id AND o.status = 'new' AND o.expires_at > now()),
    (SELECT count(*) FROM public.autopilot_actions a
      WHERE a.workspace_id = m.workspace_id AND a.status = 'failed'
        AND a.updated_at > now() - interval '14 days'),
    (SELECT count(*) FROM public.autopilot_actions a
      WHERE a.workspace_id = m.workspace_id AND a.status = 'missed'
        AND a.updated_at > now() - interval '7 days'),
    (SELECT count(*) FROM public.marketing_opportunities o
      WHERE o.workspace_id = m.workspace_id AND o.kind = 'performance'
        AND o.status = 'new' AND o.expires_at > now()),
    n.planned_for,
    n.title
  FROM public.workspace_members m
  LEFT JOIN LATERAL (
    SELECT * FROM public.autopilot_programs p
     WHERE p.workspace_id = m.workspace_id AND p.status IN ('running', 'paused')
     LIMIT 1) p ON true
  LEFT JOIN LATERAL (
    SELECT a.planned_for, a.title FROM public.autopilot_actions a
     WHERE a.workspace_id = m.workspace_id AND a.kind = 'content'
       AND a.status IN ('planned', 'generating', 'needs_approval', 'approved', 'scheduled')
       AND a.planned_for >= now()
     ORDER BY a.planned_for
     LIMIT 1) n ON true
  WHERE m.user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.autopilot_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.autopilot_overview() TO authenticated, service_role;
