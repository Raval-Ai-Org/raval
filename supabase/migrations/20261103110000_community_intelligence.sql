-- Community Intelligence (Brain → Market → Communities): real discussions
-- where people ask about a brand's problem, its competitors or its field, and
-- reply drafts a person posts themselves.
--
-- community_threads  one row per discussion per workspace. `url` is the link a
--                    search or API really returned; `fingerprint` is the
--                    thread's own id on its network (reddit:<id>, hn:<id>,
--                    se:<site>:<id>, quora:<slug>). `reply` is the latest
--                    draft ({ text, disclosed, removed, createdAt }); Mellox
--                    never posts it.
-- community_watches  keywords and communities a person keeps.
-- community_jobs     one leased refresh per workspace, claimed by
--                    claim_community_jobs (SKIP LOCKED) and advanced by the
--                    existing competitor-watch cron hook and after(). Daily.
--                    No new cron job.
--
-- Members read (RLS); the server writes after a role check
-- (src/server/fns/community.ts) or from the worker. Idempotent.

CREATE TABLE IF NOT EXISTS public.community_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  url text NOT NULL CHECK (url ~ '^https://' AND char_length(url) <= 600),
  source text NOT NULL CHECK (source IN ('reddit', 'quora', 'hackernews', 'stackexchange')),
  community text NOT NULL DEFAULT '' CHECK (char_length(community) <= 120),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 300),
  snippet text NOT NULL DEFAULT '' CHECK (char_length(snippet) <= 800),
  summary text NOT NULL DEFAULT '' CHECK (char_length(summary) <= 300),
  matched_on text NOT NULL CHECK (matched_on IN ('problem', 'competitor', 'alternative', 'category')),
  matched_term text NOT NULL DEFAULT '' CHECK (char_length(matched_term) <= 120),
  competitor_name text CHECK (competitor_name IS NULL OR char_length(competitor_name) <= 200),
  relevance integer NOT NULL DEFAULT 50 CHECK (relevance BETWEEN 0 AND 100),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'saved', 'replied', 'hidden')),
  reply jsonb CHECK (reply IS NULL OR pg_column_size(reply) <= 12000),
  posted_at timestamptz,
  found_at timestamptz NOT NULL DEFAULT now(),
  fingerprint text NOT NULL CHECK (char_length(fingerprint) BETWEEN 3 AND 240),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT community_threads_fingerprint_unique UNIQUE (workspace_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS community_threads_recent_idx
  ON public.community_threads(workspace_id, found_at DESC);

ALTER TABLE public.community_threads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_threads FROM anon, authenticated;
GRANT SELECT ON public.community_threads TO authenticated;
GRANT ALL ON public.community_threads TO service_role;

DROP POLICY IF EXISTS "Members read community threads" ON public.community_threads;
CREATE POLICY "Members read community threads"
  ON public.community_threads FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP TRIGGER IF EXISTS community_threads_touch ON public.community_threads;
CREATE TRIGGER community_threads_touch BEFORE UPDATE ON public.community_threads
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ── What a person keeps an eye on ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.community_watches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('keyword', 'community')),
  value text NOT NULL CHECK (char_length(value) BETWEEN 2 AND 80),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS community_watches_value_unique
  ON public.community_watches(workspace_id, kind, lower(value));

ALTER TABLE public.community_watches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_watches FROM anon, authenticated;
GRANT SELECT ON public.community_watches TO authenticated;
GRANT ALL ON public.community_watches TO service_role;

DROP POLICY IF EXISTS "Members read community watches" ON public.community_watches;
CREATE POLICY "Members read community watches"
  ON public.community_watches FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

-- ── The refresh ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.community_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL UNIQUE REFERENCES public.workspaces(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'idle', 'failed', 'paused')),
  next_run_at timestamptz NOT NULL DEFAULT now(),
  last_run_at timestamptz,
  last_found integer NOT NULL DEFAULT 0,
  last_error text CHECK (last_error IS NULL OR char_length(last_error) <= 2000),
  lease_until timestamptz,
  locked_by text,
  attempt_count integer NOT NULL DEFAULT 0,
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS community_jobs_due_idx
  ON public.community_jobs(next_run_at)
  WHERE status <> 'paused';

ALTER TABLE public.community_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_jobs FROM anon, authenticated;
GRANT SELECT ON public.community_jobs TO authenticated;
GRANT ALL ON public.community_jobs TO service_role;

DROP POLICY IF EXISTS "Members read community jobs" ON public.community_jobs;
CREATE POLICY "Members read community jobs"
  ON public.community_jobs FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP TRIGGER IF EXISTS community_jobs_touch ON public.community_jobs;
CREATE TRIGGER community_jobs_touch BEFORE UPDATE ON public.community_jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.claim_community_jobs(
  p_worker text,
  p_max integer DEFAULT 2,
  p_lease_seconds integer DEFAULT 150,
  p_workspace_id uuid DEFAULT NULL
)
RETURNS SETOF public.community_jobs
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.community_jobs AS j
     SET lease_until = now() + make_interval(secs => greatest(p_lease_seconds, 30)),
         locked_by = p_worker,
         status = 'running',
         attempt_count = j.attempt_count + 1
   WHERE j.id IN (
     SELECT c.id
       FROM public.community_jobs c
      WHERE c.status <> 'paused'
        AND (p_workspace_id IS NULL OR c.workspace_id = p_workspace_id)
        AND (p_workspace_id IS NOT NULL OR c.next_run_at <= now())
        AND (c.lease_until IS NULL OR c.lease_until < now())
      ORDER BY c.next_run_at
      LIMIT greatest(p_max, 0)
      FOR UPDATE SKIP LOCKED
   )
  RETURNING j.*;
$$;

REVOKE ALL ON FUNCTION public.claim_community_jobs(text, integer, integer, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_community_jobs(text, integer, integer, uuid)
  TO service_role;
