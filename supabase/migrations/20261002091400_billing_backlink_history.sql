-- Historical workspace captures stay in the old ledger. New captures are
-- account-wide charges with workspace attribution; neither side overlaps.
CREATE OR REPLACE FUNCTION public.backlink_spent_credits(p_workspace uuid)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT coalesce((SELECT lifetime_spent FROM public.workspace_credit_balances
                   WHERE workspace_id=p_workspace),0)
       + coalesce((SELECT sum(amount) FROM public.billing_charges
                   WHERE workspace_id=p_workspace AND action='backlink_order' AND meter='credits'),0);
$$;
REVOKE ALL ON FUNCTION public.backlink_spent_credits(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.backlink_spent_credits(uuid) TO service_role;
