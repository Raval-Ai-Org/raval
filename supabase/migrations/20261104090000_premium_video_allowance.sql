-- Premium videos: a monthly allowance of whole videos on the Premium,
-- Cinematic and Long options (src/lib/billing/video-charge.ts), granted with
-- the plan like every other meter and never rolled over. Additional meter
-- only; no historical grants, purchases or ledger rows are changed.
DO $$
DECLARE t text; d text;
  old_list text := '(''credits'',''video'',''pro_messages'',''flash_messages'',''creation'')';
  new_list text := '(''credits'',''video'',''pro_messages'',''flash_messages'',''creation'',''premium_video'')';
BEGIN
  FOREACH t IN ARRAY ARRAY['meter_grants','meter_balances','meter_holds','meter_ledger','billing_admin_adjustments','billing_studio_jobs'] LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I',t,t||'_meter_check');
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (meter IN %s)',t,t||'_meter_check',new_list);
  END LOOP;
  -- Extend only the exact validated meter list in the current RPC bodies,
  -- keeping their idempotency and permission checks.
  FOREACH t IN ARRAY ARRAY['private.meter_grant(jsonb)','private.meter_hold(jsonb)'] LOOP
    SELECT pg_get_functiondef(t::regprocedure) INTO d;
    IF position(new_list IN d)>0 THEN CONTINUE; END IF;
    IF position(old_list IN d)=0 THEN
      RAISE EXCEPTION 'Unrecognized meter validation in %',t;
    END IF;
    EXECUTE replace(d,old_list,new_list);
  END LOOP;
END $$;

-- A premium video can only be reserved by a Studio video, even if a future
-- server call accidentally chooses this meter for something else.
DO $$ DECLARE d text; BEGIN
  SELECT pg_get_functiondef('private.meter_hold(jsonb)'::regprocedure) INTO d;
  IF position('Premium videos are reserved for videos' IN d)=0 THEN
    EXECUTE replace(d,'IF v_account IS NULL OR v_meter NOT IN',
      'IF v_meter=''premium_video'' AND coalesce(p->>''action'','''')<>''studio_video'' THEN
         RETURN jsonb_build_object(''ok'',false,''code'',''invalid_action'',''reason'',''Premium videos are reserved for videos'');
       END IF;
       IF v_account IS NULL OR v_meter NOT IN');
  END IF;
END $$;
