-- One-time founder/Free transition approved on 2026-10-01.
-- Run against the intended production database with `supabase db query --file`.
-- One DO statement makes grants and capacity reconciliation atomic.

DO $$
DECLARE
  v_now timestamptz := now();
  v_next timestamptz := now() + interval '1 month';
  v_owner uuid := 'd8b7e3e6-e07e-4ddd-93ae-c846846118c1';
  v_founder uuid;
  v_account record;
  v_meter record;
  v_result jsonb;
BEGIN
  IF v_now::date <> date '2026-10-01' THEN
    RAISE EXCEPTION 'This transition is only valid on 2026-10-01 UTC';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_owner AND lower(email) = 'zainmudassariqbal@gmail.com') THEN
    RAISE EXCEPTION 'Founder email and user id do not match';
  END IF;
  SELECT id INTO STRICT v_founder FROM public.billing_accounts WHERE owner_user_id = v_owner;

  -- A paid plan must be changed through its purchase lifecycle, not this transition.
  IF EXISTS (SELECT 1 FROM public.billing_accounts WHERE provider_subscription_id IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.billing_payment_records)
     OR EXISTS (SELECT 1 FROM public.billing_manual_activations WHERE reason <> 'Launch grace month')
     OR EXISTS (SELECT 1 FROM public.meter_holds WHERE state = 'held') THEN
    RAISE EXCEPTION 'Paid activity or live holds require individual review';
  END IF;
  IF EXISTS (SELECT 1 FROM public.meter_grants
    WHERE remaining > 0 AND
      (source IN ('trial','pack','pack_bonus','addon','promo','adjustment','migration')
       OR (source = 'plan' AND idempotency_key NOT LIKE '%:free:%'))) THEN
    RAISE EXCEPTION 'Existing non-Free grants require individual review';
  END IF;

  PERFORM 1 FROM public.billing_accounts ORDER BY id FOR UPDATE;

  UPDATE public.billing_accounts SET
    plan_id = 'free', entitled_plan_id = 'free', status = 'free',
    comped_plan_id = NULL, comped_until = NULL,
    billing_interval = NULL, current_period_start = NULL, current_period_end = NULL,
    downgrade_to = NULL, downgrade_at = NULL,
    enforcement_override = 'on', capacity_reconciled_at = NULL, updated_at = v_now
  WHERE id <> v_founder;

  UPDATE public.billing_accounts SET
    plan_id = 'free', entitled_plan_id = 'free', status = 'free',
    comped_plan_id = 'scale', comped_until = '2099-01-01 00:00:00+00',
    billing_interval = 'month', current_period_start = v_now,
    current_period_end = '2099-01-01 00:00:00+00',
    grant_anchor = v_now, next_grant_at = v_next,
    enforcement_override = 'on', capacity_reconciled_at = NULL, updated_at = v_now
  WHERE id = v_founder;

  -- The old workspace field still feeds several compatibility readers.
  UPDATE public.workspaces w SET plan = CASE WHEN w.billing_account_id = v_founder THEN 'scale' ELSE 'free' END
  WHERE w.plan IS DISTINCT FROM CASE WHEN w.billing_account_id = v_founder THEN 'scale' ELSE 'free' END;

  -- Give accounts whose first Free window was never issued their 30 Flash messages.
  FOR v_account IN
    SELECT a.id FROM public.billing_accounts a
    WHERE a.id <> v_founder AND (a.next_grant_at IS NULL OR a.next_grant_at <= v_now)
  LOOP
    v_result := public.meter_grant(jsonb_build_object(
      'account_id', v_account.id, 'meter', 'flash_messages', 'amount', 30,
      'source', 'plan', 'restriction', 'ai_only',
      'period_start', v_now, 'expires_at', v_next,
      'idempotency_key', 'plan:' || v_account.id || ':free:flash_messages:2026-10-01',
      'reason', '2026-10-01 Free plan transition'));
    IF v_result->>'ok' <> 'true' THEN RAISE EXCEPTION 'Free grant failed for %: %', v_account.id, v_result; END IF;
    UPDATE public.billing_accounts SET grant_anchor = v_now, next_grant_at = v_next WHERE id = v_account.id;
  END LOOP;

  -- Scale's published monthly allowance: 50,000 credits, 100 VC,
  -- 1,200 Pro messages and 12,000 Flash messages.
  FOR v_meter IN SELECT * FROM (VALUES
    ('credits', 50000), ('video', 10000),
    ('pro_messages', 1200), ('flash_messages', 12000)
  ) AS allowances(meter, amount)
  LOOP
    v_result := public.meter_grant(jsonb_build_object(
      'account_id', v_founder, 'meter', v_meter.meter, 'amount', v_meter.amount,
      'source', 'plan', 'restriction', 'ai_only',
      'period_start', v_now, 'expires_at', v_next,
      'idempotency_key', 'plan:' || v_founder || ':scale:' || v_meter.meter || ':2026-10-01',
      'reason', 'Founder Scale entitlement'));
    IF v_result->>'ok' <> 'true' THEN RAISE EXCEPTION 'Scale grant failed for %: %', v_meter.meter, v_result; END IF;
  END LOOP;

  INSERT INTO public.billing_manual_activations
    (id, account_id, actor_user_id, kind, catalog_key, billing_interval, active_until, reason)
  VALUES (gen_random_uuid(), v_founder, v_owner, 'plan', 'scale', 'month', '2099-01-01 00:00:00+00',
    'Founder Scale entitlement approved 2026-10-01');

  FOR v_account IN SELECT id FROM public.billing_accounts LOOP
    v_result := public.reconcile_billing_capacity(v_account.id,
      CASE WHEN v_account.id = v_founder THEN 30 ELSE 1 END,
      CASE WHEN v_account.id = v_founder THEN NULL ELSE 1 END);
    UPDATE public.billing_accounts SET capacity_reconciled_at = v_now WHERE id = v_account.id;
  END LOOP;
END;
$$;
