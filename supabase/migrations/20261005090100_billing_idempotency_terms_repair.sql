-- Restore the billing idempotency-term checks omitted from the deployed functions.
CREATE OR REPLACE FUNCTION private.meter_grant(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_account uuid := nullif(p->>'account_id','')::uuid;
  v_meter text := p->>'meter';
  v_key text := p->>'idempotency_key';
  v_source text := p->>'source';
  v_restriction text := p->>'restriction';
  v_amount bigint := coalesce((p->>'amount')::bigint, 0);
  v_after public.meter_balances%ROWTYPE;
  v_existing uuid;
  v_replay public.meter_grants%ROWTYPE;
  v_grant uuid;
  v_debt_paid bigint;
  v_added bigint;
BEGIN
  IF v_account IS NULL OR v_meter NOT IN ('credits','video','pro_messages','flash_messages')
     OR v_source NOT IN ('plan','rollover','trial','signup','pack','pack_bonus','addon','referral','promo','adjustment','migration')
     OR v_restriction NOT IN ('any','ai_only') OR v_amount <= 0 OR coalesce(v_key,'') = '' THEN
    RETURN jsonb_build_object('ok',false,'code','invalid','reason','Invalid grant.');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('meter:'||v_account::text||':'||v_meter));
  SELECT id INTO v_existing FROM public.meter_grants WHERE account_id=v_account AND idempotency_key=v_key;
  IF v_existing IS NOT NULL THEN
    SELECT * INTO v_replay FROM public.meter_grants WHERE id=v_existing;
    IF v_replay.meter IS DISTINCT FROM v_meter
       OR v_replay.amount IS DISTINCT FROM v_amount
       OR v_replay.source IS DISTINCT FROM v_source
       OR v_replay.restriction IS DISTINCT FROM v_restriction
       OR v_replay.workspace_id IS DISTINCT FROM nullif(p->>'workspace_id','')::uuid
       OR v_replay.provider_ref IS DISTINCT FROM p->>'provider_ref' THEN
      RETURN jsonb_build_object('ok',false,'code','idempotency_conflict',
        'reason','Grant key was used for different terms.');
    END IF;
    SELECT * INTO v_after FROM public.meter_balances WHERE account_id=v_account AND meter=v_meter;
    RETURN jsonb_build_object('ok',true,'replayed',true,'grant_id',v_existing,
      'available',v_after.available,'held',v_after.held,'available_any',v_after.available_any,'debt',v_after.debt);
  END IF;
  INSERT INTO public.meter_balances(account_id,meter) VALUES(v_account,v_meter) ON CONFLICT DO NOTHING;
  SELECT * INTO v_after FROM public.meter_balances WHERE account_id=v_account AND meter=v_meter FOR UPDATE;
  v_debt_paid := least(v_amount,v_after.debt);
  v_added := v_amount-v_debt_paid;
  INSERT INTO public.meter_grants(account_id,meter,source,restriction,amount,remaining,period_start,expires_at,
    workspace_id,provider_ref,idempotency_key)
  VALUES(v_account,v_meter,v_source,v_restriction,v_amount,v_added,
    nullif(p->>'period_start','')::timestamptz,nullif(p->>'expires_at','')::timestamptz,
    nullif(p->>'workspace_id','')::uuid,p->>'provider_ref',v_key) RETURNING id INTO v_grant;
  UPDATE public.meter_balances SET available=available+v_added,
    available_any=available_any+CASE WHEN v_restriction='any' THEN v_added ELSE 0 END,
    debt=debt-v_debt_paid,updated_at=now()
  WHERE account_id=v_account AND meter=v_meter RETURNING * INTO v_after;
  INSERT INTO public.meter_ledger(account_id,meter,kind,delta_available,delta_held,available_after,held_after,
    grant_id,workspace_id,reason,actor,idempotency_key)
  VALUES(v_account,v_meter,'grant',v_added,0,v_after.available,v_after.held,v_grant,
    nullif(p->>'workspace_id','')::uuid,left(p->>'reason',300),nullif(p->>'actor','')::uuid,'grant:'||v_key);
  RETURN jsonb_build_object('ok',true,'replayed',false,'grant_id',v_grant,
    'available',v_after.available,'held',v_after.held,'available_any',v_after.available_any,'debt',v_after.debt);
END;
$$;

CREATE OR REPLACE FUNCTION private.meter_hold(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_account uuid := nullif(p->>'account_id','')::uuid;
  v_meter text := p->>'meter';
  v_key text := p->>'idempotency_key';
  v_amount bigint := coalesce((p->>'amount')::bigint,0);
  v_workspace uuid := nullif(p->>'workspace_id','')::uuid;
  v_require_any boolean := coalesce((p->>'require_any')::boolean,false);
  v_cap bigint;
  v_used bigint;
  v_ws_account uuid;
  v_balance public.meter_balances%ROWTYPE;
  v_existing public.meter_holds%ROWTYPE;
  v_grant public.meter_grants%ROWTYPE;
  v_need bigint;
  v_take bigint;
  v_any bigint := 0;
  v_alloc jsonb := '[]'::jsonb;
  v_id uuid;
BEGIN
  IF v_account IS NULL OR v_meter NOT IN ('credits','video','pro_messages','flash_messages')
     OR v_amount <= 0 OR coalesce(v_key,'')='' OR coalesce(p->>'action','')='' THEN
    RETURN jsonb_build_object('ok',false,'code','invalid','reason','Invalid hold.');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('meter:'||v_account::text||':'||v_meter));
  SELECT * INTO v_existing FROM public.meter_holds WHERE account_id=v_account AND idempotency_key=v_key;
  IF FOUND THEN
    IF v_existing.meter IS DISTINCT FROM v_meter
       OR v_existing.amount IS DISTINCT FROM v_amount
       OR v_existing.action IS DISTINCT FROM p->>'action'
       OR v_existing.workspace_id IS DISTINCT FROM v_workspace
       OR v_existing.user_id IS DISTINCT FROM nullif(p->>'user_id','')::uuid THEN
      RETURN jsonb_build_object('ok',false,'code','idempotency_conflict',
        'reason','Hold key was used for a different action.');
    END IF;
    SELECT * INTO v_balance FROM public.meter_balances WHERE account_id=v_account AND meter=v_meter;
    RETURN jsonb_build_object('ok',true,'replayed',true,'id',v_existing.id,'state',v_existing.state,
      'available',v_balance.available,'held',v_balance.held,'available_any',v_balance.available_any);
  END IF;
  IF v_workspace IS NOT NULL THEN
    SELECT billing_account_id,monthly_credit_cap INTO v_ws_account,v_cap FROM public.workspaces WHERE id=v_workspace;
    IF v_ws_account IS DISTINCT FROM v_account THEN
      RETURN jsonb_build_object('ok',false,'code','invalid_workspace','reason','Workspace is not on this account.');
    END IF;
  END IF;
  INSERT INTO public.meter_balances(account_id,meter) VALUES(v_account,v_meter) ON CONFLICT DO NOTHING;
  SELECT * INTO v_balance FROM public.meter_balances WHERE account_id=v_account AND meter=v_meter FOR UPDATE;
  IF v_balance.debt > 0 THEN
    RETURN jsonb_build_object('ok',false,'code','debt','reason','Outstanding meter debt must be cleared first.',
      'available',v_balance.available,'held',v_balance.held);
  END IF;
  IF (CASE WHEN v_require_any THEN v_balance.available_any ELSE v_balance.available END) < v_amount THEN
    RETURN jsonb_build_object('ok',false,'code','insufficient_balance','reason','Not enough credits.',
      'available',CASE WHEN v_require_any THEN v_balance.available_any ELSE v_balance.available END,
      'held',v_balance.held,'needed',v_amount);
  END IF;
  IF v_meter='credits' AND v_workspace IS NOT NULL AND v_cap IS NOT NULL THEN
    SELECT coalesce(sum(amount),0) INTO v_used FROM public.billing_charges
      WHERE account_id=v_account AND workspace_id=v_workspace AND meter='credits'
        AND created_at >= date_trunc('month',now());
    SELECT v_used+coalesce(sum(amount-captured_amount),0) INTO v_used FROM public.meter_holds
      WHERE account_id=v_account AND workspace_id=v_workspace AND meter='credits' AND state='held';
    IF v_used+v_amount > v_cap THEN
      RETURN jsonb_build_object('ok',false,'code','brand_cap','reason','This brand reached its monthly credit cap.',
        'used',v_used,'max',v_cap);
    END IF;
  END IF;
  v_need := v_amount;
  FOR v_grant IN SELECT * FROM public.meter_grants
    WHERE account_id=v_account AND meter=v_meter AND remaining>0
      AND (expires_at IS NULL OR expires_at>now())
      AND (NOT v_require_any OR restriction='any')
    ORDER BY expires_at ASC NULLS LAST,
      CASE WHEN restriction='ai_only' THEN 0 ELSE 1 END, created_at, id
    FOR UPDATE
  LOOP
    EXIT WHEN v_need=0;
    v_take := least(v_need,v_grant.remaining);
    UPDATE public.meter_grants SET remaining=remaining-v_take WHERE id=v_grant.id;
    v_alloc := v_alloc || jsonb_build_array(jsonb_build_object('grant_id',v_grant.id,'remaining',v_take));
    IF v_grant.restriction='any' THEN v_any := v_any+v_take; END IF;
    v_need := v_need-v_take;
  END LOOP;
  IF v_need>0 THEN RAISE EXCEPTION 'grant balance drift' USING ERRCODE='P0001'; END IF;
  UPDATE public.meter_balances SET available=available-v_amount,held=held+v_amount,
    available_any=available_any-v_any,updated_at=now()
  WHERE account_id=v_account AND meter=v_meter RETURNING * INTO v_balance;
  INSERT INTO public.meter_holds(account_id,meter,workspace_id,user_id,action,amount,expires_at,idempotency_key,allocations)
  VALUES(v_account,v_meter,v_workspace,nullif(p->>'user_id','')::uuid,p->>'action',v_amount,
    coalesce(nullif(p->>'expires_at','')::timestamptz,now()+interval '15 minutes'),v_key,v_alloc)
  RETURNING id INTO v_id;
  INSERT INTO public.meter_ledger(account_id,meter,kind,delta_available,delta_held,available_after,held_after,
    hold_id,workspace_id,user_id,action,reason,idempotency_key)
  VALUES(v_account,v_meter,'hold',-v_amount,v_amount,v_balance.available,v_balance.held,
    v_id,v_workspace,nullif(p->>'user_id','')::uuid,p->>'action',left(p->>'reason',300),'hold:'||v_key);
  RETURN jsonb_build_object('ok',true,'replayed',false,'id',v_id,'state','held',
    'available',v_balance.available,'held',v_balance.held,'available_any',v_balance.available_any);
END;
$$;
