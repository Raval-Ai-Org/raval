-- Guardrail event log (proposal workstream D): what was blocked, flagged or
-- repaired, why, and for which workspace. `detail` carries short snippets and
-- rule ids only — never whole prompts, outputs, or personal data.

CREATE TABLE IF NOT EXISTS public.guardrail_events (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  route text NOT NULL DEFAULT 'unknown',
  kind text NOT NULL CHECK (kind IN (
    'injection_detected',
    'untrusted_content_sanitized',
    'pii_redacted',
    'profanity',
    'claim_flagged',
    'brand_rule_violation',
    'moderation_blocked',
    'moderation_unverified',
    'parse_failure',
    'truncation',
    'action_blocked',
    'budget_degraded',
    'budget_exceeded'
  )),
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warn', 'block')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  run_id uuid,
  request_id text
);

CREATE INDEX IF NOT EXISTS guardrail_events_workspace_idx
  ON public.guardrail_events (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS guardrail_events_kind_idx
  ON public.guardrail_events (kind, created_at DESC);

ALTER TABLE public.guardrail_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.guardrail_events FROM anon, authenticated;
GRANT SELECT ON public.guardrail_events TO authenticated;
GRANT ALL ON public.guardrail_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.guardrail_events_id_seq TO service_role;

DROP POLICY IF EXISTS "Members read workspace guardrail events" ON public.guardrail_events;
CREATE POLICY "Members read workspace guardrail events" ON public.guardrail_events
  FOR SELECT TO authenticated
  USING (workspace_id IS NOT NULL AND private.is_workspace_member(workspace_id, auth.uid()));
