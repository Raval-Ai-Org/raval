-- Brand DNA moves from browser localStorage into the database: one row per
-- workspace, read by members (RLS), written only by the server after a role
-- check (src/server/fns/brand-dna.ts). The server loads it for AI requests by
-- the request's verified workspace id, never from browser state.

CREATE TABLE IF NOT EXISTS public.workspace_brand_dna (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  dna jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.workspace_brand_dna ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_brand_dna FROM anon, authenticated;
GRANT SELECT ON public.workspace_brand_dna TO authenticated;
GRANT ALL ON public.workspace_brand_dna TO service_role;

DROP POLICY IF EXISTS "Members read brand dna" ON public.workspace_brand_dna;
CREATE POLICY "Members read brand dna"
  ON public.workspace_brand_dna FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));
