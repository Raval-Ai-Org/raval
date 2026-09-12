-- Studio generation jobs. One row per generate / regenerate / refine request.
--
-- Image and video renders are asynchronous at the provider; the previous design
-- held a single HTTP request open for up to three minutes and kept progress in
-- browser memory, so closing the composer or reloading lost the work (and a
-- render past the timeout was billed but never delivered). A job row makes the
-- work durable: the client polls it, the rail shows it, and it survives
-- navigation. Idempotent — safe to re-run.
CREATE TABLE IF NOT EXISTS public.studio_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  type text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  stage text NOT NULL DEFAULT 'context',
  stage_at timestamptz NOT NULL DEFAULT now(),
  title text,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb NOT NULL DEFAULT '{}'::jsonb,
  error jsonb,
  provider_tasks jsonb NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key text NOT NULL,
  parent_job_id uuid REFERENCES public.studio_jobs(id) ON DELETE SET NULL,
  group_id uuid NOT NULL DEFAULT gen_random_uuid(),
  content_item_ids uuid[] NOT NULL DEFAULT '{}',
  asset_ids uuid[] NOT NULL DEFAULT '{}',
  attempt integer NOT NULL DEFAULT 1,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CONSTRAINT studio_jobs_status_check
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  CONSTRAINT studio_jobs_idempotency_unique UNIQUE (workspace_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS studio_jobs_workspace_status_idx
  ON public.studio_jobs (workspace_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS studio_jobs_group_idx ON public.studio_jobs (group_id);

ALTER TABLE public.studio_jobs ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON public.studio_jobs TO authenticated;
GRANT ALL ON public.studio_jobs TO service_role;

-- Role checks (editor+) are enforced by the API kernel before any write;
-- RLS keeps every row inside its workspace.
DROP POLICY IF EXISTS "Workspace members can read studio jobs" ON public.studio_jobs;
CREATE POLICY "Workspace members can read studio jobs"
  ON public.studio_jobs FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Workspace members can create studio jobs" ON public.studio_jobs;
CREATE POLICY "Workspace members can create studio jobs"
  ON public.studio_jobs FOR INSERT TO authenticated
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Workspace members can update studio jobs" ON public.studio_jobs;
CREATE POLICY "Workspace members can update studio jobs"
  ON public.studio_jobs FOR UPDATE TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));

DROP TRIGGER IF EXISTS studio_jobs_touch_updated_at ON public.studio_jobs;
CREATE TRIGGER studio_jobs_touch_updated_at
  BEFORE UPDATE ON public.studio_jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Live progress for the rail and the minimized dock.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'studio_jobs'
     )
  THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.studio_jobs;
  END IF;
END $$;
