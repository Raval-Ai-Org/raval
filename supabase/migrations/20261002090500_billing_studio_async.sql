-- Durable links let a later Studio poll or billing hook settle the original
-- account hold. Browser clients cannot read or change this billing metadata.
CREATE TABLE IF NOT EXISTS public.billing_studio_jobs (
  job_id uuid PRIMARY KEY REFERENCES public.studio_jobs(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.billing_accounts(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  hold_id uuid UNIQUE REFERENCES public.meter_holds(id) ON DELETE RESTRICT,
  charge_id uuid,
  charge_key text NOT NULL,
  action text NOT NULL,
  meter text NOT NULL CHECK (meter IN ('credits','video')),
  amount bigint NOT NULL CHECK (amount > 0),
  route text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('off','shadow','on')),
  shadow_decision text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  CHECK (mode <> 'on' OR hold_id IS NOT NULL),
  UNIQUE (account_id, charge_key)
);
CREATE INDEX IF NOT EXISTS billing_studio_jobs_unsettled_idx
  ON public.billing_studio_jobs (created_at) WHERE settled_at IS NULL;
ALTER TABLE public.billing_studio_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_studio_jobs FROM anon, authenticated;
GRANT ALL ON public.billing_studio_jobs TO service_role;

ALTER TABLE public.billing_shadow_events ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS billing_shadow_events_key_idx
  ON public.billing_shadow_events (account_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- Release an expired hold only after its Studio job is terminal. A live job
-- keeps the hold for the poller or operator, even if provider work runs long.
CREATE OR REPLACE FUNCTION private.meter_release_expired_holds()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_hold public.meter_holds%ROWTYPE; v_result jsonb; v_count integer := 0;
BEGIN
  FOR v_hold IN SELECT h.* FROM public.meter_holds h
    WHERE h.state='held' AND h.expires_at<=now()
      AND h.action NOT IN ('ugc_render','geo_agent_run','backlink_order','schedule_run')
      AND NOT EXISTS (
        SELECT 1 FROM public.billing_studio_jobs b
        JOIN public.studio_jobs j ON j.id=b.job_id
        WHERE b.hold_id=h.id AND b.settled_at IS NULL
          AND j.status IN ('queued','running')
      )
    ORDER BY h.expires_at,h.id LIMIT 100 FOR UPDATE OF h SKIP LOCKED
  LOOP
    v_result := private.meter_release(jsonb_build_object(
      'account_id',v_hold.account_id,'hold_id',v_hold.id,
      'idempotency_key','expire:'||v_hold.id,'expired',true,'reason','Expired unused hold'));
    IF coalesce((v_result->>'ok')::boolean,false) THEN v_count := v_count+1; END IF;
  END LOOP;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION private.meter_release_expired_holds() FROM PUBLIC,anon,authenticated;
