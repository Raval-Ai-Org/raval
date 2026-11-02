-- Deleting a workspace failed for three reasons, all in the database:
--
-- 1. Money tables (backlink orders, credit balance and ledger, Stripe customer)
--    referenced workspaces ON DELETE RESTRICT, and the ledger refuses deletes
--    outright. Their rule stays: a money record is never erased as a side effect
--    of deleting a workspace. So the record now outlives the workspace, keyed
--    by the old id (which workspace_deletions records), instead of blocking it.
--    RLS already hides it from everyone once nobody is a member.
-- 2. Deleting the original of duplicated workspaces set every duplicate's
--    duplicate_of to NULL at once, and two unflagged rows with the same owner
--    and domain break workspaces_owner_domain_unique. The duplicates are now
--    re-pointed before the delete.
-- 3. canva_import_pages.asset_id was RESTRICT, which is checked mid-cascade;
--    NO ACTION is checked at the end of the statement, after the pages go.
--
-- A backlink order that has started spending still blocks the delete, with
-- a plain reason: its provider cycle and refunds need the workspace.

ALTER TABLE public.link_orders DROP CONSTRAINT IF EXISTS link_orders_workspace_id_fkey;
ALTER TABLE public.link_order_lines DROP CONSTRAINT IF EXISTS link_order_lines_workspace_id_fkey;
ALTER TABLE public.link_order_events DROP CONSTRAINT IF EXISTS link_order_events_workspace_id_fkey;
ALTER TABLE public.workspace_credit_balances
  DROP CONSTRAINT IF EXISTS workspace_credit_balances_workspace_id_fkey;
ALTER TABLE public.workspace_credit_ledger
  DROP CONSTRAINT IF EXISTS workspace_credit_ledger_workspace_id_fkey;
ALTER TABLE public.billing_customers DROP CONSTRAINT IF EXISTS billing_customers_workspace_id_fkey;

ALTER TABLE public.canva_import_pages DROP CONSTRAINT IF EXISTS canva_import_pages_asset_id_fkey;
ALTER TABLE public.canva_import_pages
  ADD CONSTRAINT canva_import_pages_asset_id_fkey
  FOREIGN KEY (asset_id) REFERENCES public.assets(id) ON DELETE NO ACTION;

CREATE OR REPLACE FUNCTION private.before_workspace_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_canonical uuid;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.link_orders
     WHERE workspace_id = OLD.id
       AND status NOT IN ('cart', 'cancelled', 'failed', 'published', 'partially_published')
  ) THEN
    RAISE EXCEPTION 'workspace_link_order_in_progress' USING ERRCODE = '55006';
  END IF;

  -- An unpaid basket is not a money record.
  DELETE FROM public.link_orders o
   WHERE o.workspace_id = OLD.id
     AND o.status = 'cart'
     AND NOT EXISTS (SELECT 1 FROM public.workspace_credit_ledger l WHERE l.order_id = o.id);

  -- Each duplicate points at its owner's other unflagged workspace for that
  -- domain. With none, the oldest duplicate takes the original's place. The
  -- original still exists until this trigger returns, so the heir points at
  -- itself for now (still flagged, so the unique index holds) and
  -- after_workspace_delete clears that once the original is gone.
  FOR r IN
    SELECT id, owner_id, domain FROM public.workspaces
     WHERE duplicate_of = OLD.id AND id <> OLD.id
     ORDER BY created_at, id
  LOOP
    v_canonical := NULL;
    IF r.domain IS NOT NULL THEN
      SELECT id INTO v_canonical FROM public.workspaces
       WHERE id NOT IN (OLD.id, r.id)
         AND (duplicate_of IS NULL OR duplicate_of = id)
         AND owner_id = r.owner_id
         AND domain = r.domain
       ORDER BY (duplicate_of IS NULL) DESC, created_at, id
       LIMIT 1;
      v_canonical := coalesce(v_canonical, r.id);
    END IF;
    UPDATE public.workspaces SET duplicate_of = v_canonical WHERE id = r.id;
  END LOOP;

  RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION private.after_workspace_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.workspaces SET duplicate_of = NULL WHERE duplicate_of = id;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.before_workspace_delete() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.after_workspace_delete() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS workspaces_before_delete ON public.workspaces;
CREATE TRIGGER workspaces_before_delete
  BEFORE DELETE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION private.before_workspace_delete();

DROP TRIGGER IF EXISTS workspaces_after_delete ON public.workspaces;
CREATE TRIGGER workspaces_after_delete
  AFTER DELETE ON public.workspaces
  FOR EACH STATEMENT EXECUTE FUNCTION private.after_workspace_delete();
