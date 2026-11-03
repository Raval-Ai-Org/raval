-- Additional meter; no historical grants, purchases or ledger rows are changed.
-- Only server routes may write jobs. Workspace members retain their RLS reads.
REVOKE INSERT, UPDATE ON public.studio_jobs FROM authenticated,anon;
GRANT SELECT ON public.studio_jobs TO authenticated;
GRANT ALL ON public.studio_jobs TO service_role;
DO $$
DECLARE t text; d text;
BEGIN
  FOREACH t IN ARRAY ARRAY['meter_grants','meter_balances','meter_holds','meter_ledger','billing_admin_adjustments','billing_studio_jobs'] LOOP
    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I',t,t||'_meter_check');
    EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (meter IN (''credits'',''video'',''pro_messages'',''flash_messages'',''creation''))',t,t||'_meter_check');
  END LOOP;
  -- Preserve the current, repaired RPC bodies and their idempotency/permission
  -- checks. Extend only the exact validated meter list, never replace the RPCs
  -- with older copies from a previous migration.
  FOREACH t IN ARRAY ARRAY['private.meter_grant(jsonb)','private.meter_hold(jsonb)'] LOOP
    SELECT pg_get_functiondef(t::regprocedure) INTO d;
    IF position('(''credits'',''video'',''pro_messages'',''flash_messages'',''creation'')' IN d)>0 THEN CONTINUE; END IF;
    IF position('(''credits'',''video'',''pro_messages'',''flash_messages'')' IN d)=0 THEN
      RAISE EXCEPTION 'Unrecognized meter validation in %',t;
    END IF;
    EXECUTE replace(d,'(''credits'',''video'',''pro_messages'',''flash_messages'')','(''credits'',''video'',''pro_messages'',''flash_messages'',''creation'')');
  END LOOP;
END $$;

-- The new pool can only be reserved by a creation action, even if a future
-- server call accidentally chooses it for research or premium-chat overage.
DO $$ DECLARE d text; BEGIN
  SELECT pg_get_functiondef('private.meter_hold(jsonb)'::regprocedure) INTO d;
  IF position('Creation points are reserved for content' IN d)=0 THEN
    EXECUTE replace(d,'IF v_account IS NULL OR v_meter NOT IN',
      'IF v_meter=''creation'' AND left(coalesce(p->>''action'',''''),9)<>''creation:'' THEN
         RETURN jsonb_build_object(''ok'',false,''code'',''invalid_action'',''reason'',''Creation points are reserved for content'');
       END IF;
       IF v_account IS NULL OR v_meter NOT IN');
  END IF;
END $$;

ALTER TABLE public.billing_studio_jobs DROP CONSTRAINT IF EXISTS billing_studio_jobs_amount_check;
ALTER TABLE public.billing_studio_jobs ADD CONSTRAINT billing_studio_jobs_amount_check CHECK (amount >= 0);

CREATE TABLE IF NOT EXISTS public.billing_creation_windows (
  account_id uuid NOT NULL REFERENCES public.billing_accounts(id) ON DELETE RESTRICT,
  window_start timestamptz NOT NULL, expires_at timestamptz NOT NULL,
  policy text NOT NULL CHECK (policy IN ('legacy','creation_v3')),
  PRIMARY KEY(account_id,window_start), CHECK(expires_at > window_start)
);
ALTER TABLE public.billing_creation_windows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_creation_windows FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.billing_creation_windows TO service_role;

CREATE OR REPLACE FUNCTION public.creation_plan_window(p jsonb)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a uuid := (p->>'account_id')::uuid; s timestamptz := (p->>'window_start')::timestamptz;
  e timestamptz := (p->>'expires_at')::timestamptz; v text;
BEGIN
  IF a IS NULL OR s IS NULL OR e IS NULL OR e<=s THEN RAISE EXCEPTION 'Invalid grant window'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('creation-window:'||a::text));
  SELECT policy INTO v FROM billing_creation_windows WHERE account_id=a AND window_start=s;
  IF FOUND THEN RETURN v; END IF;
  -- An interrupted/replayed old grant must retain exactly its old terms.
  v := CASE WHEN EXISTS(SELECT 1 FROM meter_grants WHERE account_id=a AND source='plan' AND meter='credits'
    AND (period_start=s OR idempotency_key LIKE 'plan:'||a::text||':%:'||(p->>'window_start')))
    THEN 'legacy' ELSE 'creation_v3' END;
  INSERT INTO billing_creation_windows(account_id,window_start,expires_at,policy) VALUES(a,s,e,v);
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.creation_plan_window(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.creation_plan_window(jsonb) TO service_role;

CREATE TABLE IF NOT EXISTS public.studio_caption_edits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.billing_accounts(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL, group_id uuid NOT NULL,
  user_id uuid NOT NULL, request_key text NOT NULL,
  slot integer NOT NULL CHECK(slot BETWEEN 1 AND 3),
  state text NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','captured','released')),
  job_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(account_id,user_id,request_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS studio_caption_edits_slot_idx ON public.studio_caption_edits(group_id,slot) WHERE state<>'released';
ALTER TABLE public.studio_caption_edits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.studio_caption_edits FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.studio_caption_edits TO service_role;
ALTER TABLE public.billing_studio_jobs ADD COLUMN IF NOT EXISTS caption_edit_id uuid REFERENCES public.studio_caption_edits(id);

CREATE OR REPLACE FUNCTION public.reserve_studio_caption_edit(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE parent public.studio_jobs%ROWTYPE; claim public.studio_caption_edits%ROWTYPE;
  a uuid := (p->>'account_id')::uuid; w uuid := (p->>'workspace_id')::uuid;
  u uuid := (p->>'user_id')::uuid; k text := p->>'request_key'; n integer; ident uuid; cost_charge uuid;
BEGIN
  IF a IS NULL OR w IS NULL OR u IS NULL OR coalesce(k,'')='' THEN RAISE EXCEPTION 'Invalid edit reservation'; END IF;
  SELECT * INTO parent FROM studio_jobs WHERE id=(p->>'parent_job_id')::uuid AND workspace_id=w AND status='succeeded';
  IF NOT FOUND OR parent.type NOT IN ('social','image','video','ad')
    OR NOT EXISTS(SELECT 1 FROM workspaces WHERE id=w AND billing_account_id=a)
    OR NOT EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id=w AND user_id=u AND role IN ('owner','admin','editor'))
    THEN RETURN jsonb_build_object('included',false); END IF;
  PERFORM pg_advisory_xact_lock(hashtext('caption-edit:'||parent.group_id::text));
  UPDATE studio_caption_edits SET state='released' WHERE group_id=parent.group_id
    AND state='reserved' AND job_id IS NULL AND created_at<now()-interval '15 minutes';
  SELECT * INTO claim FROM studio_caption_edits WHERE account_id=a AND user_id=u AND request_key=k;
  IF FOUND THEN
    IF claim.group_id<>parent.group_id THEN RAISE EXCEPTION 'Edit key has different terms'; END IF;
    RETURN jsonb_build_object('included',true,'id',claim.id,'replayed',true,'state',claim.state);
  END IF;
  -- Only a successfully paid creation earns edits. A free edit, a failed job
  -- or fabricated parent ID cannot mint more free provider work.
  SELECT b.charge_id INTO cost_charge FROM studio_jobs j JOIN billing_studio_jobs b ON b.job_id=j.id
    JOIN billing_charges c ON c.id=b.charge_id AND c.account_id=b.account_id AND c.meter=b.meter AND c.amount>0
    WHERE j.group_id=parent.group_id AND j.workspace_id=w AND j.status='succeeded'
      AND b.account_id=a AND b.workspace_id=w AND b.meter IN ('creation','video') AND b.amount>0 AND b.settled_at IS NOT NULL
      AND b.mode='on' ORDER BY b.created_at LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('included',false); END IF;
  SELECT min(s) INTO n FROM generate_series(1,3) s WHERE NOT EXISTS(
    SELECT 1 FROM studio_caption_edits x WHERE x.group_id=parent.group_id AND x.slot=s AND x.state<>'released');
  IF n IS NULL THEN RETURN jsonb_build_object('included',false); END IF;
  INSERT INTO studio_caption_edits(account_id,workspace_id,group_id,user_id,request_key,slot)
    VALUES(a,w,parent.group_id,u,k,n) RETURNING id INTO ident;
  RETURN jsonb_build_object('included',true,'id',ident,'replayed',false,'charge_id',cost_charge);
END $$;
REVOKE ALL ON FUNCTION public.reserve_studio_caption_edit(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_studio_caption_edit(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.studio_caption_edits_remaining(p_workspace uuid,p_group uuid)
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT CASE WHEN EXISTS(SELECT 1 FROM studio_jobs j JOIN billing_studio_jobs b ON b.job_id=j.id
    JOIN billing_charges c ON c.id=b.charge_id AND c.account_id=b.account_id AND c.meter=b.meter AND c.amount>0
    WHERE j.workspace_id=p_workspace AND j.group_id=p_group AND j.status='succeeded'
      AND b.workspace_id=p_workspace AND b.meter IN ('creation','video') AND b.mode='on' AND b.settled_at IS NOT NULL)
    THEN greatest(0,3-(SELECT count(*)::integer FROM studio_caption_edits WHERE workspace_id=p_workspace AND group_id=p_group AND state<>'released')) ELSE 0 END;
$$;
REVOKE ALL ON FUNCTION public.studio_caption_edits_remaining(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.studio_caption_edits_remaining(uuid,uuid) TO service_role;

ALTER TABLE public.billing_creation_windows ADD COLUMN IF NOT EXISTS cost_warning_at timestamptz;
CREATE OR REPLACE FUNCTION public.creation_cost_report()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.provider_usd DESC),'[]'::jsonb) FROM (
    SELECT w.account_id,w.window_start,w.expires_at,
      coalesce(CASE WHEN a.comped_until>now() THEN a.comped_plan_id ELSE NULL END,a.entitled_plan_id,a.plan_id) AS plan_id,a.billing_interval,
      coalesce(u.provider_usd,0) AS provider_usd,coalesce(u.calls,0) AS calls,
      coalesce(c.points,0) AS creation_points_spent
    FROM billing_creation_windows w JOIN billing_accounts a ON a.id=w.account_id
    LEFT JOIN LATERAL (
      SELECT sum(e.est_cost_usd) AS provider_usd,count(*) AS calls FROM ai_usage_events e
      WHERE e.billing_account_id=w.account_id AND e.created_at>=w.window_start AND e.created_at<w.expires_at
    ) u ON true
    LEFT JOIN LATERAL (
      SELECT sum(amount) AS points FROM billing_charges b WHERE b.account_id=w.account_id
        AND b.meter='creation' AND b.created_at>=w.window_start AND b.created_at<w.expires_at
    ) c ON true
    WHERE w.policy='creation_v3' AND w.window_start<=now() AND w.expires_at>now()
    ORDER BY coalesce(u.provider_usd,0) DESC LIMIT 100
  ) r;
$$;
REVOKE ALL ON FUNCTION public.creation_cost_report() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.creation_cost_report() TO service_role;
