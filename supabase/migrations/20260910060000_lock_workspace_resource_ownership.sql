-- Prevent authenticated callers from moving workspace resources or rewriting
-- their creator after the initial insert. Service-role workers are allowed to
-- maintain these fields because auth.uid() is NULL for service-role requests.
CREATE OR REPLACE FUNCTION private.prevent_workspace_resource_reassignment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND (
    NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR
    NEW.created_by IS DISTINCT FROM OLD.created_by
  ) THEN
    RAISE EXCEPTION 'workspace ownership fields are immutable'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.prevent_workspace_resource_reassignment() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.prevent_workspace_resource_reassignment() TO service_role;

DO $$
DECLARE
  resource_table text;
BEGIN
  FOREACH resource_table IN ARRAY ARRAY[
    'content_items', 'agent_runs', 'scheduled_jobs', 'geo_audit_runs',
    'memory_insights', 'competitor_watches'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', resource_table || '_ownership_guard', resource_table);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.prevent_workspace_resource_reassignment()',
      resource_table || '_ownership_guard', resource_table
    );
  END LOOP;
END $$;

DROP POLICY IF EXISTS "Members can insert content items" ON public.content_items;
CREATE POLICY "Members can insert content items"
  ON public.content_items FOR INSERT TO authenticated
  WITH CHECK (
    private.is_workspace_member(workspace_id, auth.uid())
    AND (created_by IS NULL OR created_by = auth.uid())
  );

DROP POLICY IF EXISTS "Members can insert agent runs" ON public.agent_runs;
CREATE POLICY "Members can insert agent runs"
  ON public.agent_runs FOR INSERT TO authenticated
  WITH CHECK (
    private.is_workspace_member(workspace_id, auth.uid())
    AND (created_by IS NULL OR created_by = auth.uid())
  );

DROP POLICY IF EXISTS "Members can insert scheduled jobs" ON public.scheduled_jobs;
CREATE POLICY "Members can insert scheduled jobs"
  ON public.scheduled_jobs FOR INSERT TO authenticated
  WITH CHECK (
    private.is_workspace_member(workspace_id, auth.uid())
    AND (created_by IS NULL OR created_by = auth.uid())
  );

DROP POLICY IF EXISTS "Workspace members insert geo_audit_runs" ON public.geo_audit_runs;
CREATE POLICY "Workspace members insert geo_audit_runs"
  ON public.geo_audit_runs FOR INSERT TO authenticated
  WITH CHECK (
    private.is_workspace_member(workspace_id, auth.uid())
    AND (created_by IS NULL OR created_by = auth.uid())
  );

DROP POLICY IF EXISTS "Workspace members write memory_insights" ON public.memory_insights;
CREATE POLICY "Workspace members write memory_insights"
  ON public.memory_insights FOR INSERT TO authenticated
  WITH CHECK (
    private.is_workspace_member(workspace_id, auth.uid())
    AND (created_by IS NULL OR created_by = auth.uid())
  );

DROP POLICY IF EXISTS "members insert watches" ON public.competitor_watches;
CREATE POLICY "members insert watches"
  ON public.competitor_watches FOR INSERT TO authenticated
  WITH CHECK (
    private.is_workspace_member(workspace_id, auth.uid())
    AND (created_by IS NULL OR created_by = auth.uid())
  );