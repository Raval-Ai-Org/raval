-- Preserve pre-billing teammate roles when an existing account moves below its
-- old seat count. Reconciliation runs under the account row lock used by
-- invitation acceptance and role promotion.
CREATE TABLE IF NOT EXISTS public.billing_suspended_members (
  account_id uuid NOT NULL REFERENCES public.billing_accounts(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  original_role public.app_role NOT NULL CHECK (original_role IN ('admin','editor')),
  original_created_at timestamptz NOT NULL,
  suspended_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id,user_id)
);
ALTER TABLE public.billing_suspended_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_suspended_members FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.billing_suspended_members TO service_role;

CREATE OR REPLACE FUNCTION public.reconcile_billing_capacity(
  p_account uuid, p_brand_limit integer, p_seat_limit integer,
  p_preferred_workspace uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_owner uuid;
  v_row record;
  v_seat_count integer := 1;
  v_allowed uuid[] := ARRAY[]::uuid[];
  v_frozen integer := 0;
  v_suspended integer := 0;
BEGIN
  IF p_brand_limit < 0 OR p_seat_limit < 1 THEN
    RAISE EXCEPTION 'invalid billing capacity' USING ERRCODE='22023';
  END IF;
  SELECT owner_user_id INTO v_owner FROM public.billing_accounts
   WHERE id=p_account FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'billing account missing' USING ERRCODE='22023'; END IF;
  IF p_preferred_workspace IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.workspaces
     WHERE id=p_preferred_workspace AND billing_account_id=p_account AND duplicate_of IS NULL
  ) THEN RAISE EXCEPTION 'preferred brand is not in account' USING ERRCODE='22023'; END IF;

  WITH ranked AS (
    SELECT w.id, row_number() OVER (
      ORDER BY CASE WHEN w.id=p_preferred_workspace THEN 0
                    WHEN w.frozen_at IS NULL THEN 1 ELSE 2 END,
               w.created_at, w.id
    ) AS place
    FROM public.workspaces w
    WHERE w.billing_account_id=p_account AND w.duplicate_of IS NULL
  )
  UPDATE public.workspaces w
     SET frozen_at=CASE WHEN r.place<=p_brand_limit THEN NULL ELSE coalesce(w.frozen_at,now()) END,
         frozen_reason=CASE WHEN r.place<=p_brand_limit THEN NULL ELSE 'plan_limit' END
    FROM ranked r WHERE w.id=r.id AND
      (w.frozen_reason IS NULL OR w.frozen_reason='plan_limit');
  SELECT count(*) INTO v_frozen FROM public.workspaces
    WHERE billing_account_id=p_account AND duplicate_of IS NULL AND frozen_at IS NOT NULL;

  IF p_seat_limit IS NULL THEN
    UPDATE public.workspace_members m SET role=s.original_role
      FROM public.billing_suspended_members s
     WHERE s.account_id=p_account AND m.workspace_id=s.workspace_id AND m.user_id=s.user_id
       AND m.role='viewer';
    DELETE FROM public.billing_suspended_members WHERE account_id=p_account;
    RETURN jsonb_build_object('frozen_brands',v_frozen,'suspended_seats',0);
  END IF;

  FOR v_row IN
    SELECT candidates.user_id, min(candidates.first_at) AS first_at
      FROM (
        SELECT m.user_id, min(m.created_at) AS first_at
          FROM public.workspace_members m JOIN public.workspaces w ON w.id=m.workspace_id
         WHERE w.billing_account_id=p_account AND m.role IN ('admin','editor')
           AND m.user_id<>v_owner GROUP BY m.user_id
        UNION ALL
        SELECT s.user_id, min(s.original_created_at)
          FROM public.billing_suspended_members s WHERE s.account_id=p_account
           AND s.user_id<>v_owner GROUP BY s.user_id
      ) candidates GROUP BY candidates.user_id
     ORDER BY min(candidates.first_at), candidates.user_id
  LOOP
    IF v_seat_count < p_seat_limit THEN
      v_allowed := array_append(v_allowed,v_row.user_id);
      v_seat_count := v_seat_count+1;
    END IF;
  END LOOP;

  UPDATE public.workspace_members m SET role=s.original_role
    FROM public.billing_suspended_members s
   WHERE s.account_id=p_account AND m.workspace_id=s.workspace_id AND m.user_id=s.user_id
     AND m.role='viewer' AND s.user_id=ANY(v_allowed);
  DELETE FROM public.billing_suspended_members s
   WHERE s.account_id=p_account AND s.user_id=ANY(v_allowed);

  INSERT INTO public.billing_suspended_members
    (account_id,workspace_id,user_id,original_role,original_created_at)
  SELECT p_account,m.workspace_id,m.user_id,m.role,m.created_at
    FROM public.workspace_members m JOIN public.workspaces w ON w.id=m.workspace_id
   WHERE w.billing_account_id=p_account AND m.role IN ('admin','editor')
     AND m.user_id<>v_owner AND NOT (m.user_id=ANY(v_allowed))
  ON CONFLICT (workspace_id,user_id) DO NOTHING;
  UPDATE public.workspace_members m SET role='viewer'
    FROM public.billing_suspended_members s
   WHERE s.account_id=p_account AND m.workspace_id=s.workspace_id AND m.user_id=s.user_id
     AND m.role IN ('admin','editor');
  SELECT count(DISTINCT user_id) INTO v_suspended
    FROM public.billing_suspended_members WHERE account_id=p_account;
  RETURN jsonb_build_object('frozen_brands',v_frozen,'suspended_seats',v_suspended);
END;
$$;
REVOKE ALL ON FUNCTION public.reconcile_billing_capacity(uuid,integer,integer,uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_billing_capacity(uuid,integer,integer,uuid) TO service_role;

-- Authenticated browser writes cannot mutate brand data after a plan freeze.
CREATE OR REPLACE FUNCTION private.guard_frozen_brand_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_workspace uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN coalesce(NEW,OLD); END IF;
  v_workspace := CASE WHEN TG_OP='DELETE' THEN OLD.workspace_id ELSE NEW.workspace_id END;
  IF EXISTS (SELECT 1 FROM public.workspaces WHERE id=v_workspace AND frozen_at IS NOT NULL) THEN
    RAISE EXCEPTION 'billing_brand_frozen' USING ERRCODE='42501';
  END IF;
  RETURN coalesce(NEW,OLD);
END;
$$;
REVOKE ALL ON FUNCTION private.guard_frozen_brand_write() FROM PUBLIC,anon,authenticated;

DO $$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'content_items','ugc_projects','workspace_competitors','experiments',
    'social_accounts','scheduled_posts','brand_kit_assets','brand_kit_styles'
  ] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema='public' AND table_name=v_table AND column_name='workspace_id') THEN
      EXECUTE format('DROP TRIGGER IF EXISTS billing_frozen_write ON public.%I',v_table);
      EXECUTE format('CREATE TRIGGER billing_frozen_write BEFORE INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.guard_frozen_brand_write()',v_table);
    END IF;
  END LOOP;
END;
$$;
