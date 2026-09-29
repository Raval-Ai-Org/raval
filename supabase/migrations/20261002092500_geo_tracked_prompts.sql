-- Tracked prompts: questions a brand wants to be the answer to, checked weekly
-- on each answer engine the plan includes (Perplexity, ChatGPT, Gemini).
-- A person chooses every prompt; suggestions are never tracked by themselves.
-- The plan's trackedPrompts limit is pooled across the account's brands and
-- enforced by the server (src/server/geo/tracked-prompts.server.ts).
-- Members read; all writes go through the server (service role).

CREATE TABLE IF NOT EXISTS public.geo_tracked_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  text text NOT NULL CHECK (length(text) BETWEEN 3 AND 300),
  created_by uuid,
  paused_at timestamptz,
  next_check_at timestamptz NOT NULL DEFAULT now(),
  last_checked_at timestamptz,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS geo_tracked_prompts_unique_text
  ON public.geo_tracked_prompts (workspace_id, lower(text));
CREATE INDEX IF NOT EXISTS geo_tracked_prompts_due_idx
  ON public.geo_tracked_prompts (next_check_at) WHERE paused_at IS NULL;

CREATE TABLE IF NOT EXISTS public.geo_prompt_checks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  prompt_id uuid NOT NULL REFERENCES public.geo_tracked_prompts(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  engine text NOT NULL CHECK (engine IN ('perplexity','chatgpt','gemini','google_aio')),
  model text NOT NULL,
  checked_at timestamptz NOT NULL DEFAULT now(),
  mentioned boolean NOT NULL DEFAULT false,
  position integer,
  cited boolean NOT NULL DEFAULT false,
  cited_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  competitors_mentioned jsonb NOT NULL DEFAULT '[]'::jsonb,
  answer_excerpt text,
  web_search boolean NOT NULL DEFAULT false,
  error text
);
CREATE INDEX IF NOT EXISTS geo_prompt_checks_prompt_idx
  ON public.geo_prompt_checks (prompt_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS geo_prompt_checks_workspace_idx
  ON public.geo_prompt_checks (workspace_id, checked_at DESC);

ALTER TABLE public.geo_tracked_prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.geo_prompt_checks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.geo_tracked_prompts FROM anon;
REVOKE ALL ON public.geo_prompt_checks FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.geo_tracked_prompts FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.geo_prompt_checks FROM authenticated;
GRANT SELECT ON public.geo_tracked_prompts, public.geo_prompt_checks TO authenticated;
GRANT ALL ON public.geo_tracked_prompts, public.geo_prompt_checks TO service_role;

DROP POLICY IF EXISTS "Members read tracked prompts" ON public.geo_tracked_prompts;
CREATE POLICY "Members read tracked prompts"
  ON public.geo_tracked_prompts FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Members read prompt checks" ON public.geo_prompt_checks;
CREATE POLICY "Members read prompt checks"
  ON public.geo_prompt_checks FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

-- Due prompts for the worker, claimed with a short lease so two cron ticks
-- never check the same prompt twice.
CREATE OR REPLACE FUNCTION public.claim_tracked_prompts(p_limit integer, p_lease_seconds integer)
RETURNS SETOF public.geo_tracked_prompts
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.geo_tracked_prompts p
     SET lease_until = now() + make_interval(secs => p_lease_seconds)
   WHERE p.id IN (
     SELECT id FROM public.geo_tracked_prompts
      WHERE paused_at IS NULL
        AND next_check_at <= now()
        AND (lease_until IS NULL OR lease_until < now())
      ORDER BY next_check_at
      LIMIT greatest(1, least(p_limit, 50))
      FOR UPDATE SKIP LOCKED
   )
  RETURNING p.*;
$$;
REVOKE ALL ON FUNCTION public.claim_tracked_prompts(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_tracked_prompts(integer, integer) TO service_role;
