-- Autopilot — the brand strategy a program follows, and when the acting
-- member was last told that pieces are waiting (ADR-0028).
--
--   strategy           {summary, audience, voice, pillars[]} proposed by Mellox
--                      from Brand DNA at setup and confirmed by a person; every
--                      weekly plan is written against it, so nobody has to
--                      restate their goals.
--   last_notified_at   throttles the "waiting for you" email to one a day.
--
-- Idempotent and non-destructive: safe to re-run.

ALTER TABLE public.autopilot_programs
  ADD COLUMN IF NOT EXISTS strategy jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.autopilot_programs
  ADD COLUMN IF NOT EXISTS last_notified_at timestamptz;

ALTER TABLE public.autopilot_programs
  DROP CONSTRAINT IF EXISTS autopilot_programs_strategy_size;
ALTER TABLE public.autopilot_programs
  ADD CONSTRAINT autopilot_programs_strategy_size CHECK (pg_column_size(strategy) <= 8000);
