-- Prevent overlapping scheduler invocations from processing the same job.
-- A stale lease is reclaimable after the worker timeout in the application.
ALTER TABLE public.scheduled_jobs
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_by uuid;

CREATE INDEX IF NOT EXISTS scheduled_jobs_claim_idx
  ON public.scheduled_jobs (locked_at, next_run_at)
  WHERE active = true;