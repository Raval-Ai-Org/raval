-- Keep the old workspace plan column aligned with account entitlements until
-- its remaining readers move to the account billing catalog.
-- STATEMENT
ALTER TABLE public.workspaces ALTER COLUMN plan SET DEFAULT 'free';

-- STATEMENT
CREATE OR REPLACE FUNCTION private.effective_legacy_billing_plan(p_account public.billing_accounts)
RETURNS text LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT CASE
    WHEN p_account.comped_plan_id IS NOT NULL AND p_account.comped_until > now()
      THEN p_account.comped_plan_id
    WHEN p_account.status IN ('paused', 'canceled') THEN 'free'
    WHEN p_account.status = 'past_due' AND (p_account.grace_until IS NULL OR p_account.grace_until <= now())
      THEN 'free'
    WHEN coalesce(p_account.entitled_plan_id, p_account.plan_id) IN ('free','starter','growth','agency','scale')
      THEN coalesce(p_account.entitled_plan_id, p_account.plan_id)
    ELSE 'free'
  END;
$$;
-- STATEMENT
REVOKE ALL ON FUNCTION private.effective_legacy_billing_plan(public.billing_accounts)
  FROM PUBLIC, anon, authenticated;

-- STATEMENT
CREATE OR REPLACE FUNCTION private.set_new_workspace_billing_plan()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_account public.billing_accounts%ROWTYPE;
BEGIN
  SELECT * INTO STRICT v_account FROM public.billing_accounts WHERE id = NEW.billing_account_id;
  NEW.plan := private.effective_legacy_billing_plan(v_account);
  RETURN NEW;
END;
$$;
-- STATEMENT
REVOKE ALL ON FUNCTION private.set_new_workspace_billing_plan()
  FROM PUBLIC, anon, authenticated;

-- STATEMENT
DO $$
BEGIN
  DROP TRIGGER IF EXISTS zz_billing_workspace_plan_insert ON public.workspaces;
  CREATE TRIGGER zz_billing_workspace_plan_insert
    BEFORE INSERT ON public.workspaces FOR EACH ROW
    EXECUTE FUNCTION private.set_new_workspace_billing_plan();
END;
$$;

-- STATEMENT
CREATE OR REPLACE FUNCTION private.sync_workspace_billing_plan()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_plan text;
BEGIN
  v_plan := private.effective_legacy_billing_plan(NEW);
  UPDATE public.workspaces SET plan = v_plan
    WHERE billing_account_id = NEW.id AND plan IS DISTINCT FROM v_plan;
  RETURN NEW;
END;
$$;
-- STATEMENT
REVOKE ALL ON FUNCTION private.sync_workspace_billing_plan()
  FROM PUBLIC, anon, authenticated;

-- STATEMENT
DO $$
BEGIN
  DROP TRIGGER IF EXISTS billing_workspace_plan_sync ON public.billing_accounts;
  CREATE TRIGGER billing_workspace_plan_sync
    AFTER INSERT OR UPDATE ON public.billing_accounts FOR EACH ROW
    EXECUTE FUNCTION private.sync_workspace_billing_plan();
END;
$$;

-- STATEMENT
UPDATE public.workspaces w SET plan = private.effective_legacy_billing_plan(a)
FROM public.billing_accounts a WHERE a.id = w.billing_account_id
  AND w.plan IS DISTINCT FROM private.effective_legacy_billing_plan(a);
