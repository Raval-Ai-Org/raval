
-- 1) Recreate policies on content_items and agent_runs to use private.is_workspace_member
DROP POLICY IF EXISTS "Members can delete content items" ON public.content_items;
DROP POLICY IF EXISTS "Members can insert content items" ON public.content_items;
DROP POLICY IF EXISTS "Members can update content items" ON public.content_items;
DROP POLICY IF EXISTS "Members can view content items"   ON public.content_items;
DROP POLICY IF EXISTS "Members can insert agent runs"    ON public.agent_runs;
DROP POLICY IF EXISTS "Members can view agent runs"      ON public.agent_runs;

CREATE POLICY "Members can view content items" ON public.content_items
  FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

CREATE POLICY "Members can insert content items" ON public.content_items
  FOR INSERT TO authenticated
  WITH CHECK (private.is_workspace_member(workspace_id, auth.uid()));

CREATE POLICY "Members can update content items" ON public.content_items
  FOR UPDATE TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (private.is_workspace_member(workspace_id, auth.uid()));

CREATE POLICY "Members can delete content items" ON public.content_items
  FOR DELETE TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

CREATE POLICY "Members can view agent runs" ON public.agent_runs
  FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

CREATE POLICY "Members can insert agent runs" ON public.agent_runs
  FOR INSERT TO authenticated
  WITH CHECK (private.is_workspace_member(workspace_id, auth.uid()));

-- 2) Explicitly forbid client UPDATE/DELETE on agent_runs (intent: immutable run log).
--    service_role bypasses RLS and can still perform maintenance.
CREATE POLICY "No client updates to agent runs" ON public.agent_runs
  FOR UPDATE TO authenticated, anon
  USING (false) WITH CHECK (false);

CREATE POLICY "No client deletes of agent runs" ON public.agent_runs
  FOR DELETE TO authenticated, anon
  USING (false);

-- 3) Lock down the public.is_workspace_member helper so it can't be probed directly.
REVOKE EXECUTE ON FUNCTION public.is_workspace_member(uuid, uuid) FROM PUBLIC, anon, authenticated;
