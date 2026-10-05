-- Marketing Strategy (ADR-0032): the one plan a workspace's marketing follows.
--
-- One row per workspace. Mellox drafts it from the four brains (Brand DNA,
-- Audience, Competitors, Market); a person confirms or edits it; from then on
-- Studio, chat, the Coach and Autopilot all write against it.
--
--   strategy            MarketingStrategy (src/lib/strategy/contracts.ts)
--   status              draft until a person confirms it; only a confirmed
--                       strategy reaches a generator
--   built_from          which brains had something to give
--   source_fingerprint  what the brains looked like then, to tell when it is stale
--   generations         how many times Mellox has written one (the first is included)
--
-- Read by members (RLS); written only by the server after a role check
-- (src/server/fns/strategy.ts). Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS public.workspace_marketing_strategy (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  strategy jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'confirmed')),
  version integer NOT NULL DEFAULT 1,
  built_from jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_fingerprint text,
  generations integer NOT NULL DEFAULT 0,
  generated_at timestamptz,
  confirmed_at timestamptz,
  confirmed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_marketing_strategy_size CHECK (pg_column_size(strategy) <= 40000)
);

ALTER TABLE public.workspace_marketing_strategy ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_marketing_strategy FROM anon, authenticated;
GRANT SELECT ON public.workspace_marketing_strategy TO authenticated;
GRANT ALL ON public.workspace_marketing_strategy TO service_role;

DROP POLICY IF EXISTS "Members read marketing strategy" ON public.workspace_marketing_strategy;
CREATE POLICY "Members read marketing strategy"
  ON public.workspace_marketing_strategy FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));
