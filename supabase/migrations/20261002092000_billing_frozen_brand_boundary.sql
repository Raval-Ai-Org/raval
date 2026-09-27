-- Browser writes must not move records out of a frozen brand or mutate any
-- other brand-scoped table that has a workspace_id column. Membership and
-- invitations remain manageable so an owner can revoke access while frozen.
CREATE OR REPLACE FUNCTION private.guard_frozen_brand_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN coalesce(NEW,OLD); END IF;
  IF TG_OP<>'INSERT' AND EXISTS (
    SELECT 1 FROM public.workspaces WHERE id=OLD.workspace_id AND frozen_at IS NOT NULL
  ) THEN RAISE EXCEPTION 'billing_brand_frozen' USING ERRCODE='42501'; END IF;
  IF TG_OP<>'DELETE' AND EXISTS (
    SELECT 1 FROM public.workspaces WHERE id=NEW.workspace_id AND frozen_at IS NOT NULL
  ) THEN RAISE EXCEPTION 'billing_brand_frozen' USING ERRCODE='42501'; END IF;
  RETURN coalesce(NEW,OLD);
END;
$$;
REVOKE ALL ON FUNCTION private.guard_frozen_brand_write() FROM PUBLIC,anon,authenticated;

DO $$
DECLARE v_table text;
BEGIN
  FOR v_table IN
    SELECT c.table_name FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema=c.table_schema AND t.table_name=c.table_name
    WHERE c.table_schema='public' AND c.column_name='workspace_id' AND t.table_type='BASE TABLE'
      AND c.table_name NOT IN ('workspace_members','workspace_invites','billing_suspended_members')
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS billing_frozen_write ON public.%I',v_table);
    EXECUTE format('CREATE TRIGGER billing_frozen_write BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.guard_frozen_brand_write()',v_table);
  END LOOP;
END;
$$;
