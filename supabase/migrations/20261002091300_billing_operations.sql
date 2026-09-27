-- Operational controls are service-only. Adjustments are immutable records;
-- the meter ledger remains the source of truth for balances.
CREATE TABLE IF NOT EXISTS public.billing_admin_adjustments (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.billing_accounts(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL,
  operation text NOT NULL CHECK (operation IN ('grant','clawback')),
  meter text NOT NULL CHECK (meter IN ('credits','video','pro_messages','flash_messages')),
  amount bigint NOT NULL CHECK (amount > 0),
  grant_id uuid REFERENCES public.meter_grants(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (length(reason) BETWEEN 20 AND 500),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.billing_admin_adjustments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_admin_adjustments FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.billing_admin_adjustments TO service_role;
CREATE OR REPLACE FUNCTION private.guard_billing_admin_adjustment()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'billing adjustment audit is append-only' USING ERRCODE='42501';
END;
$$;
DROP TRIGGER IF EXISTS billing_admin_adjustment_immutable ON public.billing_admin_adjustments;
CREATE TRIGGER billing_admin_adjustment_immutable BEFORE UPDATE OR DELETE
  ON public.billing_admin_adjustments FOR EACH ROW
  EXECUTE FUNCTION private.guard_billing_admin_adjustment();

CREATE OR REPLACE FUNCTION public.billing_rollout_report()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT jsonb_build_object(
    'accounts', (SELECT count(*) FROM public.billing_accounts),
    'enforcement_on', (SELECT count(*) FROM public.billing_accounts WHERE enforcement_override='on'),
    'shadow_denials', (SELECT count(*) FROM public.billing_shadow_events WHERE decision NOT IN ('allow','allowed')),
    'shadow_denials_7d', (SELECT count(*) FROM public.billing_shadow_events
                          WHERE decision NOT IN ('allow','allowed') AND created_at >= now()-interval '7 days'),
    'unprocessed_webhooks', (SELECT count(*) FROM public.billing_events WHERE processed_at IS NULL),
    'failed_webhooks', (SELECT count(*) FROM public.billing_events WHERE processed_at IS NULL AND error IS NOT NULL),
    'frozen_brands', (SELECT count(*) FROM public.workspaces WHERE frozen_at IS NOT NULL AND frozen_reason='plan_limit'),
    'suspended_seats', (SELECT count(DISTINCT user_id) FROM public.billing_suspended_members),
    'debt_accounts', (SELECT count(DISTINCT account_id) FROM public.meter_balances WHERE debt > 0),
    'expired_holds', (SELECT count(*) FROM public.meter_holds WHERE state='held' AND expires_at <= now()),
    'paid_cents', (SELECT coalesce(sum(amount_cents),0) FROM public.billing_payment_records),
    'refunded_cents', (SELECT coalesce(sum(refunded_cents),0) FROM public.billing_payment_records)
  );
$$;
REVOKE ALL ON FUNCTION public.billing_rollout_report() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.billing_rollout_report() TO service_role;
