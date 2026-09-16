-- UGC Video Ads (docs/ugc-video-ads.md, ADR-0014).
--
--   ugc_projects  one ad per product: the extracted product facts, the brief,
--                 AI concepts and the edited script. Members read; editors
--                 write through the API (role enforced by the route kernel,
--                 RLS keeps rows inside the workspace).
--   ugc_renders   one provider video task per "Generate". Leased like GEO work
--                 (claim_ugc_renders), advanced by after(), the ugc-renders cron
--                 hook, provider callbacks and status reads. Holds an
--                 ai_usage_reservations row: captured when the video is stored,
--                 released when the render fails. Members read; only the service
--                 role writes, so a browser can never mark a render done or
--                 attach an asset.
--
-- Idempotent and non-destructive.

CREATE TABLE IF NOT EXISTS public.ugc_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  title text NOT NULL DEFAULT 'Untitled ad',
  product_url text,
  product jsonb NOT NULL DEFAULT '{}'::jsonb,
  brief jsonb NOT NULL DEFAULT '{}'::jsonb,
  brand_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  concepts jsonb NOT NULL DEFAULT '[]'::jsonb,
  selected_concept_id text,
  script jsonb,
  reference_asset_ids uuid[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ugc_projects_status_check CHECK (status IN ('draft', 'archived')),
  CONSTRAINT ugc_projects_title_length CHECK (char_length(title) <= 200),
  CONSTRAINT ugc_projects_url_length CHECK (product_url IS NULL OR char_length(product_url) <= 2048),
  CONSTRAINT ugc_projects_refs_count CHECK (cardinality(reference_asset_ids) <= 9),
  CONSTRAINT ugc_projects_size CHECK (
    pg_column_size(product) + pg_column_size(brief) + pg_column_size(brand_snapshot)
      + pg_column_size(concepts) + coalesce(pg_column_size(script), 0) <= 512000
  )
);

CREATE INDEX IF NOT EXISTS ugc_projects_workspace_idx
  ON public.ugc_projects (workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.ugc_renders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.ugc_projects(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  model_key text NOT NULL,
  provider text NOT NULL,
  provider_model text NOT NULL,
  provider_variant text,
  generation_type text NOT NULL,
  duration_sec integer NOT NULL,
  aspect_ratio text NOT NULL,
  resolution text NOT NULL,
  audio boolean NOT NULL DEFAULT true,
  reference_asset_ids uuid[] NOT NULL DEFAULT '{}',
  script jsonb NOT NULL,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  prompt text NOT NULL,
  provider_task_id text,
  provider_state text,
  provider_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code text,
  error_message text,
  reservation_id uuid REFERENCES public.ai_usage_reservations(id) ON DELETE SET NULL,
  est_cost_usd numeric(12, 6) NOT NULL DEFAULT 0,
  actual_cost_usd numeric(12, 6),
  asset_id uuid REFERENCES public.assets(id) ON DELETE SET NULL,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 40,
  submit_attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  locked_by text,
  submitted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ugc_renders_status_check CHECK (status IN (
    'queued', 'submitting', 'processing', 'persisting', 'succeeded', 'failed', 'cancelled'
  )),
  CONSTRAINT ugc_renders_idempotency_unique UNIQUE (workspace_id, idempotency_key),
  CONSTRAINT ugc_renders_duration_check CHECK (duration_sec BETWEEN 1 AND 60),
  CONSTRAINT ugc_renders_prompt_length CHECK (char_length(prompt) <= 20000),
  CONSTRAINT ugc_renders_error_length CHECK (error_message IS NULL OR char_length(error_message) <= 1000),
  CONSTRAINT ugc_renders_attempts_check CHECK (max_attempts BETWEEN 1 AND 200)
);

CREATE UNIQUE INDEX IF NOT EXISTS ugc_renders_provider_task_unique
  ON public.ugc_renders (provider, provider_task_id)
  WHERE provider_task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ugc_renders_project_idx
  ON public.ugc_renders (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ugc_renders_workspace_idx
  ON public.ugc_renders (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ugc_renders_due_idx
  ON public.ugc_renders (next_attempt_at)
  WHERE status IN ('queued', 'submitting', 'processing', 'persisting');

-- ── Row-level security ────────────────────────────────────────────────────
ALTER TABLE public.ugc_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ugc_renders ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.ugc_projects, public.ugc_renders FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.ugc_projects TO authenticated;
GRANT SELECT ON public.ugc_renders TO authenticated;
GRANT ALL ON public.ugc_projects, public.ugc_renders TO service_role;

DROP POLICY IF EXISTS "Workspace members read UGC projects" ON public.ugc_projects;
CREATE POLICY "Workspace members read UGC projects"
  ON public.ugc_projects FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Workspace members create UGC projects" ON public.ugc_projects;
CREATE POLICY "Workspace members create UGC projects"
  ON public.ugc_projects FOR INSERT TO authenticated
  WITH CHECK (
    private.is_workspace_member(workspace_id, auth.uid())
    AND (created_by IS NULL OR created_by = auth.uid())
  );

DROP POLICY IF EXISTS "Workspace members update UGC projects" ON public.ugc_projects;
CREATE POLICY "Workspace members update UGC projects"
  ON public.ugc_projects FOR UPDATE TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Workspace members read UGC renders" ON public.ugc_renders;
CREATE POLICY "Workspace members read UGC renders"
  ON public.ugc_renders FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP TRIGGER IF EXISTS ugc_projects_touch_updated_at ON public.ugc_projects;
CREATE TRIGGER ugc_projects_touch_updated_at
  BEFORE UPDATE ON public.ugc_projects
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS ugc_renders_touch_updated_at ON public.ugc_renders;
CREATE TRIGGER ugc_renders_touch_updated_at
  BEFORE UPDATE ON public.ugc_renders
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Live render progress in the studio.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'ugc_renders'
     )
  THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ugc_renders;
  END IF;
END $$;

-- ── Worker lease claim ────────────────────────────────────────────────────
-- Status is not changed here: the runner moves it with compare-and-set.
CREATE OR REPLACE FUNCTION public.claim_ugc_renders(
  p_worker text,
  p_max integer DEFAULT 5,
  p_lease_seconds integer DEFAULT 120,
  p_id uuid DEFAULT NULL
)
RETURNS SETOF public.ugc_renders
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.ugc_renders AS r
     SET lease_until = now() + make_interval(secs => greatest(p_lease_seconds, 30)),
         locked_by = p_worker,
         attempts = r.attempts + 1
   WHERE r.id IN (
     SELECT u.id
       FROM public.ugc_renders u
      WHERE u.status IN ('queued', 'submitting', 'processing', 'persisting')
        AND (p_id IS NULL OR u.id = p_id)
        AND u.next_attempt_at <= now()
        AND (u.lease_until IS NULL OR u.lease_until < now())
      ORDER BY u.next_attempt_at
      LIMIT greatest(p_max, 0)
      FOR UPDATE SKIP LOCKED
   )
  RETURNING r.*;
$$;

REVOKE ALL ON FUNCTION public.claim_ugc_renders(text, integer, integer, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ugc_renders(text, integer, integer, uuid)
  TO service_role;

-- ── Scheduling: advance renders every minute ──────────────────────────────
DO $$
DECLARE
  v_ready boolean;
BEGIN
  IF to_regnamespace('cron') IS NULL OR to_regclass('vault.decrypted_secrets') IS NULL THEN
    RAISE NOTICE 'pg_cron or Vault unavailable — mellox-ugc-renders not scheduled';
    RETURN;
  END IF;

  SELECT count(*) = 2 INTO v_ready
    FROM vault.decrypted_secrets
   WHERE name IN ('mellox_app_base_url', 'mellox_cron_secret')
     AND coalesce(decrypted_secret, '') <> '';

  IF NOT v_ready THEN
    RAISE NOTICE 'Vault secrets missing — mellox-ugc-renders not scheduled';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mellox-ugc-renders') THEN
    PERFORM cron.unschedule('mellox-ugc-renders');
  END IF;
  PERFORM cron.schedule(
    'mellox-ugc-renders',
    '* * * * *',
    format('SELECT public.call_app_hook(%L);', '/api/public/hooks/ugc-renders')
  );
END;
$$;
