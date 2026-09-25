-- Account money operations. All writes serialize per (account, meter), take
-- stable idempotency keys, and are callable through service-role-only wrappers.

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

CREATE OR REPLACE FUNCTION private.meter_release(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_account uuid := nullif(p->>'account_id','')::uuid;
  v_key text := p->>'idempotency_key';
  v_hold public.meter_holds%ROWTYPE;
  v_balance public.meter_balances%ROWTYPE;
  v_allocation jsonb;
  v_grant public.meter_grants%ROWTYPE;
  v_unused bigint;
  v_returned bigint := 0;
  v_any bigint := 0;
  v_piece bigint;
  v_room bigint;
  v_return_piece bigint;
  v_debt_repaid bigint := 0;
BEGIN
  IF v_account IS NULL OR coalesce(v_key,'')='' THEN
    RETURN jsonb_build_object('ok',false,'code','invalid','reason','Invalid release.');
  END IF;
  SELECT * INTO v_hold FROM public.meter_holds WHERE account_id=v_account
    AND (id=nullif(p->>'hold_id','')::uuid OR idempotency_key=p->>'hold_key') LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','missing_hold','reason','Hold not found.'); END IF;
  PERFORM pg_advisory_xact_lock(hashtext('meter:'||v_account::text||':'||v_hold.meter));
  SELECT * INTO v_balance FROM public.meter_balances WHERE account_id=v_account AND meter=v_hold.meter FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.meter_ledger WHERE account_id=v_account AND idempotency_key='release:'||v_key) THEN
    RETURN jsonb_build_object('ok',true,'replayed',true,'available',v_balance.available,'held',v_balance.held);
  END IF;
  SELECT * INTO v_hold FROM public.meter_holds WHERE id=v_hold.id FOR UPDATE;
  IF v_hold.state<>'held' THEN
    RETURN jsonb_build_object('ok',false,'code','settled','reason','Hold is already finalized.');
  END IF;
  v_unused := v_hold.amount-v_hold.captured_amount;
  FOR v_allocation IN SELECT value FROM jsonb_array_elements(v_hold.allocations) LOOP
    v_piece := (v_allocation->>'remaining')::bigint;
    IF v_piece<=0 THEN CONTINUE; END IF;
    SELECT * INTO v_grant FROM public.meter_grants WHERE id=(v_allocation->>'grant_id')::uuid FOR UPDATE;
    v_room := greatest(0,v_grant.amount-v_grant.clawed_back-v_grant.remaining);
    v_debt_repaid := v_debt_repaid+greatest(0,v_piece-v_room);
    IF v_grant.expires_at IS NULL OR v_grant.expires_at>now() THEN
      v_return_piece := least(v_piece,v_room);
      UPDATE public.meter_grants SET remaining=remaining+v_return_piece WHERE id=v_grant.id;
      v_returned := v_returned+v_return_piece;
      IF v_grant.restriction='any' THEN v_any := v_any+v_return_piece; END IF;
    END IF;
  END LOOP;
  UPDATE public.meter_balances SET available=available+v_returned,held=held-v_unused,
    available_any=available_any+v_any,debt=greatest(0,debt-v_debt_repaid),updated_at=now()
  WHERE account_id=v_account AND meter=v_hold.meter RETURNING * INTO v_balance;
  UPDATE public.meter_holds SET state=CASE WHEN captured_amount>0 THEN 'captured' ELSE
    CASE WHEN coalesce((p->>'expired')::boolean,false) THEN 'expired' ELSE 'released' END END,
    finalized_at=now(),allocations='[]'::jsonb WHERE id=v_hold.id;
  INSERT INTO public.meter_ledger(account_id,meter,kind,delta_available,delta_held,available_after,held_after,
    hold_id,workspace_id,user_id,action,reason,idempotency_key)
  VALUES(v_account,v_hold.meter,'release',v_returned,-v_unused,v_balance.available,v_balance.held,
    v_hold.id,v_hold.workspace_id,v_hold.user_id,v_hold.action,left(p->>'reason',300),'release:'||v_key);
  RETURN jsonb_build_object('ok',true,'replayed',false,'available',v_balance.available,
    'held',v_balance.held,'available_any',v_balance.available_any,'released',v_unused);
END;
$$;

CREATE OR REPLACE FUNCTION private.meter_capture(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_account uuid := nullif(p->>'account_id','')::uuid;
  v_key text := p->>'idempotency_key';
  v_hold public.meter_holds%ROWTYPE;
  v_balance public.meter_balances%ROWTYPE;
  v_amount bigint;
  v_need bigint;
  v_take bigint;
  v_alloc jsonb := '[]'::jsonb;
  v_part jsonb;
  v_rem bigint;
  v_charge uuid := coalesce(nullif(p->>'charge_id','')::uuid,gen_random_uuid());
  v_result jsonb;
BEGIN
  IF v_account IS NULL OR coalesce(v_key,'')='' THEN
    RETURN jsonb_build_object('ok',false,'code','invalid','reason','Invalid capture.');
  END IF;
  SELECT * INTO v_hold FROM public.meter_holds WHERE account_id=v_account
    AND (id=nullif(p->>'hold_id','')::uuid OR idempotency_key=p->>'hold_key') LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','missing_hold','reason','Hold not found.'); END IF;
  PERFORM pg_advisory_xact_lock(hashtext('meter:'||v_account::text||':'||v_hold.meter));
  SELECT * INTO v_balance FROM public.meter_balances WHERE account_id=v_account AND meter=v_hold.meter FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.meter_ledger WHERE account_id=v_account AND idempotency_key='capture:'||v_key) THEN
    RETURN jsonb_build_object('ok',true,'replayed',true,'available',v_balance.available,'held',v_balance.held);
  END IF;
  SELECT * INTO v_hold FROM public.meter_holds WHERE id=v_hold.id FOR UPDATE;
  v_amount := coalesce((p->>'amount')::bigint,v_hold.amount-v_hold.captured_amount);
  IF v_hold.state<>'held' OR v_amount<=0 OR v_amount>v_hold.amount-v_hold.captured_amount THEN
    RETURN jsonb_build_object('ok',false,'code','invalid_capture','reason','Capture exceeds the live hold.');
  END IF;
  v_need := v_amount;
  FOR v_part IN SELECT value FROM jsonb_array_elements(v_hold.allocations) LOOP
    v_rem := (v_part->>'remaining')::bigint;
    v_take := least(v_need,v_rem);
    v_alloc := v_alloc || jsonb_build_array(jsonb_set(v_part,'{remaining}',to_jsonb(v_rem-v_take)));
    v_need := v_need-v_take;
  END LOOP;
  IF v_need>0 THEN RAISE EXCEPTION 'hold allocation drift' USING ERRCODE='P0001'; END IF;
  UPDATE public.meter_holds SET captured_amount=captured_amount+v_amount,allocations=v_alloc,
    state=CASE WHEN captured_amount+v_amount=amount THEN 'captured' ELSE 'held' END,
    finalized_at=CASE WHEN captured_amount+v_amount=amount THEN now() ELSE NULL END
    WHERE id=v_hold.id;
  UPDATE public.meter_balances SET held=held-v_amount,updated_at=now()
    WHERE account_id=v_account AND meter=v_hold.meter RETURNING * INTO v_balance;
  INSERT INTO public.billing_charges(id,account_id,workspace_id,user_id,action,meter,amount,route)
  VALUES(v_charge,v_account,v_hold.workspace_id,v_hold.user_id,v_hold.action,v_hold.meter,v_amount,p->>'route');
  INSERT INTO public.meter_ledger(account_id,meter,kind,delta_available,delta_held,available_after,held_after,
    hold_id,workspace_id,user_id,action,charge_id,reason,idempotency_key)
  VALUES(v_account,v_hold.meter,'capture',0,-v_amount,v_balance.available,v_balance.held,
    v_hold.id,v_hold.workspace_id,v_hold.user_id,v_hold.action,v_charge,left(p->>'reason',300),'capture:'||v_key);
  IF coalesce((p->>'finalize')::boolean,true) AND v_hold.amount-v_hold.captured_amount>v_amount THEN
    v_result := private.meter_release(jsonb_build_object('account_id',v_account,'hold_id',v_hold.id,
      'idempotency_key','finalize:'||v_key,'reason','Unused hold released after capture'));
    IF coalesce((v_result->>'ok')::boolean,false)=false THEN
      RAISE EXCEPTION 'capture finalization failed' USING ERRCODE='P0001';
    END IF;
    SELECT * INTO v_balance FROM public.meter_balances WHERE account_id=v_account AND meter=v_hold.meter;
  END IF;
  RETURN jsonb_build_object('ok',true,'replayed',false,'charge_id',v_charge,
    'available',v_balance.available,'held',v_balance.held,'available_any',v_balance.available_any);
END;
$$;

CREATE OR REPLACE FUNCTION public.meter_grant(p jsonb) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public
AS $$ SELECT private.meter_grant(p); $$;
CREATE OR REPLACE FUNCTION public.meter_hold(p jsonb) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public
AS $$ SELECT private.meter_hold(p); $$;
CREATE OR REPLACE FUNCTION public.meter_capture(p jsonb) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public
AS $$ SELECT private.meter_capture(p); $$;
CREATE OR REPLACE FUNCTION public.meter_release(p jsonb) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public
AS $$ SELECT private.meter_release(p); $$;
REVOKE ALL ON FUNCTION private.meter_grant(jsonb),private.meter_hold(jsonb),private.meter_capture(jsonb),private.meter_release(jsonb)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.meter_grant(jsonb),public.meter_hold(jsonb),public.meter_capture(jsonb),public.meter_release(jsonb)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.meter_grant(jsonb),public.meter_hold(jsonb),public.meter_capture(jsonb),public.meter_release(jsonb)
  TO service_role;

CREATE OR REPLACE FUNCTION private.meter_expire_due()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_grant public.meter_grants%ROWTYPE; v_balance public.meter_balances%ROWTYPE; v_count integer := 0;
BEGIN
  FOR v_grant IN SELECT * FROM public.meter_grants
    WHERE remaining>0 AND expires_at<=now() ORDER BY expires_at,id FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM pg_advisory_xact_lock(hashtext('meter:'||v_grant.account_id::text||':'||v_grant.meter));
    SELECT * INTO v_grant FROM public.meter_grants WHERE id=v_grant.id FOR UPDATE;
    CONTINUE WHEN v_grant.remaining=0 OR v_grant.expires_at>now();
    UPDATE public.meter_grants SET remaining=0 WHERE id=v_grant.id;
    UPDATE public.meter_balances SET available=available-v_grant.remaining,
      available_any=available_any-CASE WHEN v_grant.restriction='any' THEN v_grant.remaining ELSE 0 END,
      updated_at=now() WHERE account_id=v_grant.account_id AND meter=v_grant.meter RETURNING * INTO v_balance;
    INSERT INTO public.meter_ledger(account_id,meter,kind,delta_available,delta_held,available_after,held_after,
      grant_id,workspace_id,reason,idempotency_key)
    VALUES(v_grant.account_id,v_grant.meter,'expire',-v_grant.remaining,0,v_balance.available,v_balance.held,
      v_grant.id,v_grant.workspace_id,'Grant expired','expire:'||v_grant.id);
    v_count := v_count+1;
  END LOOP;
  RETURN v_count;
END;
$$;

-- An unknown async job must keep its hold for an operator or its own worker.
-- Phase 2 links every async action to a live-job check before extending this.
CREATE OR REPLACE FUNCTION private.meter_release_expired_holds()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_hold public.meter_holds%ROWTYPE; v_result jsonb; v_count integer := 0;
BEGIN
  FOR v_hold IN SELECT * FROM public.meter_holds
    WHERE state='held' AND expires_at<=now()
      AND action NOT IN ('studio_job','ugc_render','geo_agent_run','backlink_order','schedule_run')
    ORDER BY expires_at,id LIMIT 100 FOR UPDATE SKIP LOCKED
  LOOP
    v_result := private.meter_release(jsonb_build_object('account_id',v_hold.account_id,'hold_id',v_hold.id,
      'idempotency_key','expire:'||v_hold.id,'expired',true,'reason','Expired unused hold'));
    IF coalesce((v_result->>'ok')::boolean,false) THEN v_count := v_count+1; END IF;
  END LOOP;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.meter_expire_due() RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path=public
AS $$ SELECT private.meter_expire_due(); $$;
CREATE OR REPLACE FUNCTION public.meter_release_expired_holds() RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path=public
AS $$ SELECT private.meter_release_expired_holds(); $$;
REVOKE ALL ON FUNCTION private.meter_expire_due(),private.meter_release_expired_holds(),
  public.meter_expire_due(),public.meter_release_expired_holds() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.meter_expire_due(),public.meter_release_expired_holds() TO service_role;

CREATE OR REPLACE FUNCTION public.account_wallet(p_account uuid)
RETURNS TABLE(meter text, available bigint, held bigint, available_any bigint, debt bigint)
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  SELECT b.meter,b.available,b.held,b.available_any,b.debt FROM public.meter_balances b WHERE b.account_id=p_account;
$$;
REVOKE ALL ON FUNCTION public.account_wallet(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.account_wallet(uuid) TO service_role;

-- Refunds remove what remains of a paid grant. Already spent or held units
-- become debt and stop further holds; the next grant settles debt first.
CREATE OR REPLACE FUNCTION private.meter_clawback(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_account uuid := nullif(p->>'account_id','')::uuid;
  v_grant_id uuid := nullif(p->>'grant_id','')::uuid;
  v_key text := p->>'idempotency_key';
  v_amount bigint := coalesce((p->>'amount')::bigint,0);
  v_grant public.meter_grants%ROWTYPE;
  v_balance public.meter_balances%ROWTYPE;
  v_removed bigint;
  v_debt bigint;
BEGIN
  IF v_account IS NULL OR v_grant_id IS NULL OR coalesce(v_key,'')='' OR v_amount<=0 THEN
    RETURN jsonb_build_object('ok',false,'code','invalid','reason','Invalid clawback.');
  END IF;
  SELECT * INTO v_grant FROM public.meter_grants WHERE id=v_grant_id AND account_id=v_account;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'code','missing_grant','reason','Grant not found.'); END IF;
  PERFORM pg_advisory_xact_lock(hashtext('meter:'||v_account::text||':'||v_grant.meter));
  SELECT * INTO v_balance FROM public.meter_balances WHERE account_id=v_account AND meter=v_grant.meter FOR UPDATE;
  IF EXISTS (SELECT 1 FROM public.meter_ledger WHERE account_id=v_account AND idempotency_key='clawback:'||v_key) THEN
    RETURN jsonb_build_object('ok',true,'replayed',true,'available',v_balance.available,'debt',v_balance.debt);
  END IF;
  SELECT * INTO v_grant FROM public.meter_grants WHERE id=v_grant_id FOR UPDATE;
  IF v_amount>v_grant.amount-v_grant.clawed_back THEN
    RETURN jsonb_build_object('ok',false,'code','excessive_clawback','reason','Refund exceeds grant.');
  END IF;
  v_removed := least(v_amount,v_grant.remaining);
  v_debt := v_amount-v_removed;
  UPDATE public.meter_grants SET remaining=remaining-v_removed,clawed_back=clawed_back+v_amount
    WHERE id=v_grant_id;
  UPDATE public.meter_balances SET available=available-v_removed,
    available_any=available_any-CASE WHEN v_grant.restriction='any' THEN v_removed ELSE 0 END,
    debt=debt+v_debt,updated_at=now()
    WHERE account_id=v_account AND meter=v_grant.meter RETURNING * INTO v_balance;
  INSERT INTO public.meter_ledger(account_id,meter,kind,delta_available,delta_held,available_after,held_after,
    grant_id,workspace_id,reason,idempotency_key)
  VALUES(v_account,v_grant.meter,'clawback',-v_removed,0,v_balance.available,v_balance.held,
    v_grant.id,v_grant.workspace_id,left(p->>'reason',300),'clawback:'||v_key);
  RETURN jsonb_build_object('ok',true,'replayed',false,'available',v_balance.available,'held',v_balance.held,
    'available_any',v_balance.available_any,'debt',v_balance.debt);
END;
$$;
CREATE OR REPLACE FUNCTION public.meter_clawback(p jsonb) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public
AS $$ SELECT private.meter_clawback(p); $$;
REVOKE ALL ON FUNCTION private.meter_clawback(jsonb),public.meter_clawback(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.meter_clawback(jsonb) TO service_role;

-- Called before expiring the previous annual plan window. The service passes
-- the catalog allowance as cap; only plan grants may roll, never an earlier
-- rollover, signup grant or bonus. Held units are already absent from remaining.
CREATE OR REPLACE FUNCTION private.meter_rollover(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_account uuid := nullif(p->>'account_id','')::uuid;
  v_meter text := p->>'meter';
  v_window timestamptz := nullif(p->>'window_start','')::timestamptz;
  v_cap bigint := coalesce((p->>'cap')::bigint,0);
  v_key text;
  v_grant public.meter_grants%ROWTYPE;
  v_balance public.meter_balances%ROWTYPE;
  v_total bigint := 0;
  v_roll bigint;
  v_result jsonb;
BEGIN
  IF v_account IS NULL OR v_meter NOT IN ('credits','video') OR v_window IS NULL OR v_cap<0 THEN
    RETURN jsonb_build_object('ok',false,'code','invalid','reason','Invalid rollover.');
  END IF;
  v_key := 'rollover:'||v_account||':'||v_meter||':'||to_char(v_window AT TIME ZONE 'UTC','YYYYMMDDHH24MISS');
  PERFORM pg_advisory_xact_lock(hashtext('meter:'||v_account::text||':'||v_meter));
  IF EXISTS (SELECT 1 FROM public.meter_grants WHERE account_id=v_account AND idempotency_key=v_key) THEN
    RETURN jsonb_build_object('ok',true,'replayed',true);
  END IF;
  FOR v_grant IN SELECT * FROM public.meter_grants WHERE account_id=v_account AND meter=v_meter
      AND source='plan' AND remaining>0 AND period_start<v_window
      AND expires_at<=v_window AND expires_at>v_window-interval '40 days'
    ORDER BY expires_at,id FOR UPDATE
  LOOP
    v_total := v_total+v_grant.remaining;
    UPDATE public.meter_grants SET remaining=0 WHERE id=v_grant.id;
    UPDATE public.meter_balances SET available=available-v_grant.remaining,updated_at=now()
      WHERE account_id=v_account AND meter=v_meter RETURNING * INTO v_balance;
    INSERT INTO public.meter_ledger(account_id,meter,kind,delta_available,delta_held,available_after,held_after,
      grant_id,reason,idempotency_key)
    VALUES(v_account,v_meter,'expire',-v_grant.remaining,0,v_balance.available,v_balance.held,
      v_grant.id,'Prior annual plan window closed','rollover-expire:'||v_grant.id);
  END LOOP;
  v_roll := least(v_total,v_cap);
  IF v_roll>0 THEN
    v_result := private.meter_grant(jsonb_build_object('account_id',v_account,'meter',v_meter,
      'source','rollover','restriction','ai_only','amount',v_roll,'period_start',v_window,
      'expires_at',v_window+interval '1 month','idempotency_key',v_key));
    IF coalesce((v_result->>'ok')::boolean,false)=false THEN RAISE EXCEPTION 'rollover grant failed'; END IF;
  END IF;
  RETURN jsonb_build_object('ok',true,'replayed',false,'rolled',v_roll);
END;
$$;
CREATE OR REPLACE FUNCTION public.meter_rollover(p jsonb) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public
AS $$ SELECT private.meter_rollover(p); $$;
REVOKE ALL ON FUNCTION private.meter_rollover(jsonb),public.meter_rollover(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.meter_rollover(jsonb) TO service_role;

-- Historical backlink RPC compatibility. The same order and line keys are
-- preserved, and a key already in the old ledger is always a no-op.
CREATE OR REPLACE FUNCTION public.apply_credit_entry(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_ws uuid := nullif(p->>'workspace_id','')::uuid;
  v_account uuid;
  v_kind text := p->>'kind';
  v_key text := p->>'idempotency_key';
  v_amount bigint := coalesce((p->>'delta_available')::bigint,0);
  v_held bigint := coalesce((p->>'delta_held')::bigint,0);
  v_old public.workspace_credit_ledger%ROWTYPE;
  v_balance public.meter_balances%ROWTYPE;
  v_result jsonb;
BEGIN
  IF v_ws IS NULL OR coalesce(v_key,'')='' THEN
    RETURN jsonb_build_object('ok',false,'code','invalid','reason','Invalid credit entry.');
  END IF;
  SELECT billing_account_id INTO v_account FROM public.workspaces WHERE id=v_ws;
  IF v_account IS NULL THEN RETURN jsonb_build_object('ok',false,'code','invalid_workspace','reason','Workspace not found.'); END IF;
  SELECT * INTO v_old FROM public.workspace_credit_ledger WHERE workspace_id=v_ws AND idempotency_key=v_key;
  IF FOUND THEN
    SELECT * INTO v_balance FROM public.meter_balances WHERE account_id=v_account AND meter='credits';
    RETURN jsonb_build_object('ok',true,'replayed',true,'available',coalesce(v_balance.available,0),
      'held',coalesce(v_balance.held,0));
  END IF;
  IF v_kind='topup' AND v_amount>0 THEN
    v_result := private.meter_grant(jsonb_build_object('account_id',v_account,'meter','credits','source','pack',
      'restriction','any','amount',v_amount,'workspace_id',v_ws,'idempotency_key',v_key,'reason',p->>'reason'));
  ELSIF v_kind='hold' AND v_amount<0 AND v_held=-v_amount THEN
    v_result := private.meter_hold(jsonb_build_object('account_id',v_account,'meter','credits','action','backlink_order',
      'workspace_id',v_ws,'user_id',p->>'actor','amount',-v_amount,'require_any',true,
      'expires_at',now()+interval '90 days','idempotency_key',v_key,'reason',p->>'reason'));
  ELSIF v_kind='capture' AND v_held<0 THEN
    v_result := private.meter_capture(jsonb_build_object('account_id',v_account,'hold_key',
      'order:'||(p->>'order_id')||':hold','amount',-v_held,'finalize',false,
      'idempotency_key',v_key,'reason',p->>'reason'));
  ELSIF v_kind='release' AND v_held<0 THEN
    v_result := private.meter_release(jsonb_build_object('account_id',v_account,'hold_key',
      'order:'||(p->>'order_id')||':hold','idempotency_key',v_key,'reason',p->>'reason'));
  ELSIF v_kind='refund' AND v_amount>0 THEN
    v_result := private.meter_grant(jsonb_build_object('account_id',v_account,'meter','credits','source','adjustment',
      'restriction','any','amount',v_amount,'workspace_id',v_ws,'idempotency_key',v_key,'reason',p->>'reason'));
  ELSIF v_kind='adjustment' AND v_amount>0 AND v_held=0 THEN
    v_result := private.meter_grant(jsonb_build_object('account_id',v_account,'meter','credits','source','adjustment',
      'restriction','any','amount',v_amount,'workspace_id',v_ws,'idempotency_key',v_key,'reason',p->>'reason'));
  ELSE
    RETURN jsonb_build_object('ok',false,'code','unsupported','reason','Unsupported legacy credit entry.');
  END IF;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.apply_credit_entry(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.apply_credit_entry(jsonb) TO service_role;

-- Existing purchased balances move into their owner's account. With no live
-- legacy holds (checked in the preceding migration), available is the exact
-- remaining paid value. Replays are safe via migrate:ws keys.
DO $$
DECLARE v_row record; v_result jsonb;
BEGIN
  FOR v_row IN SELECT w.id AS workspace_id,w.billing_account_id,b.available
    FROM public.workspaces w JOIN public.workspace_credit_balances b ON b.workspace_id=w.id
    WHERE b.available>0
  LOOP
    v_result := private.meter_grant(jsonb_build_object('account_id',v_row.billing_account_id,
      'meter','credits','source','migration','restriction','any','amount',v_row.available,
      'workspace_id',v_row.workspace_id,'idempotency_key','migrate:ws:'||v_row.workspace_id));
    IF coalesce((v_result->>'ok')::boolean,false)=false THEN
      RAISE EXCEPTION 'backlink balance migration failed for %',v_row.workspace_id;
    END IF;
  END LOOP;
END;
$$;

-- Free accounts, including existing owners, receive one short-lived trial
-- balance. Later signup paths use the same stable key.
DO $$
DECLARE v_row record;
BEGIN
  FOR v_row IN SELECT id FROM public.billing_accounts LOOP
    PERFORM private.meter_grant(jsonb_build_object('account_id',v_row.id,'meter','credits',
      'source','signup','restriction','ai_only','amount',100,'expires_at',now()+interval '30 days',
      'idempotency_key','signup:'||v_row.id));
  END LOOP;
END;
$$;
