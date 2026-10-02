-- Autopilot — work beyond posts (ADR-0028).
--
--   autopilot_actions.kind       adds 'task': a recurring job Autopilot starts
--                                through an existing Mellox system (for
--                                example the weekly AI visibility scan).
--   marketing_opportunities.kind adds 'visibility': fixes waiting in AI Visibility.
--   autopilot_programs.automations  which tasks a program runs each week.
--
-- Idempotent and non-destructive: safe to re-run.

ALTER TABLE public.autopilot_actions DROP CONSTRAINT IF EXISTS autopilot_actions_kind_check;
ALTER TABLE public.autopilot_actions
  ADD CONSTRAINT autopilot_actions_kind_check CHECK (kind IN ('plan', 'content', 'scan', 'task'));

ALTER TABLE public.marketing_opportunities DROP CONSTRAINT IF EXISTS marketing_opportunities_kind_check;
ALTER TABLE public.marketing_opportunities
  ADD CONSTRAINT marketing_opportunities_kind_check CHECK (kind IN (
    'trend', 'competitor', 'news', 'customer', 'performance', 'visibility'));

ALTER TABLE public.autopilot_programs
  ADD COLUMN IF NOT EXISTS automations text[] NOT NULL DEFAULT '{geo_scan}'::text[];
