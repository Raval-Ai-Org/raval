
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE TABLE public.scheduled_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  title text NOT NULL,
  task_type text NOT NULL DEFAULT 'social-post',
  channel text,
  agent text NOT NULL DEFAULT 'spark',
  cadence text NOT NULL DEFAULT 'once',
  timezone text NOT NULL DEFAULT 'UTC',
  next_run_at timestamptz NOT NULL,
  last_run_at timestamptz,
  last_run_status text,
  last_run_error text,
  last_content_item_id uuid,
  run_count integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  prompt text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_scheduled_jobs_workspace ON public.scheduled_jobs(workspace_id);
CREATE INDEX idx_scheduled_jobs_due ON public.scheduled_jobs(next_run_at) WHERE active = true;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.scheduled_jobs TO authenticated;
GRANT ALL ON public.scheduled_jobs TO service_role;

ALTER TABLE public.scheduled_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view scheduled jobs"
  ON public.scheduled_jobs FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

CREATE POLICY "Members can insert scheduled jobs"
  ON public.scheduled_jobs FOR INSERT TO authenticated
  WITH CHECK (private.is_workspace_member(workspace_id, auth.uid()));

CREATE POLICY "Members can update scheduled jobs"
  ON public.scheduled_jobs FOR UPDATE TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (private.is_workspace_member(workspace_id, auth.uid()));

CREATE POLICY "Members can delete scheduled jobs"
  ON public.scheduled_jobs FOR DELETE TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

CREATE TRIGGER touch_scheduled_jobs_updated
  BEFORE UPDATE ON public.scheduled_jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
