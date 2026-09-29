-- Charges for background AI jobs that finish after the request returns:
-- GEO Engineer runs, "Fix all" batches, competitor intelligence reports,
-- competitor profiles and Brand Kit voice re-analysis.
--
-- Same shape as billing_studio_jobs / billing_ugc_renders, but one table for
-- every kind: the hold is taken before the job starts, linked to the job's row
-- here, and captured (success) or released (failure) once the job ends. The
-- billing cron settles anything the workers did not.

CREATE TABLE IF NOT EXISTS public.billing_async_links (
  kind text NOT NULL CHECK (kind IN (
    'geo_agent_run','fix_batch','competitor_intel','competitor_profile','brand_voice'
  )),
  ref_id text NOT NULL CHECK (length(ref_id) BETWEEN 1 AND 120),
  account_id uuid NOT NULL REFERENCES public.billing_accounts(id) ON DELETE RESTRICT,
  workspace_id uuid,
  hold_id uuid UNIQUE REFERENCES public.meter_holds(id) ON DELETE RESTRICT,
  charge_id uuid,
  charge_key text NOT NULL,
  action text NOT NULL,
  amount bigint NOT NULL CHECK (amount > 0),
  mode text NOT NULL CHECK (mode IN ('shadow','on')),
  shadow_decision text,
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  captured bigint,
  PRIMARY KEY (kind, ref_id),
  CHECK (mode <> 'on' OR hold_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS billing_async_links_open_idx
  ON public.billing_async_links (created_at) WHERE settled_at IS NULL;
ALTER TABLE public.billing_async_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_async_links FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.billing_async_links TO service_role;

-- The expiry sweeper must never release a hold whose job is still owed a
-- settlement: those are settled by job state, not by the clock.
CREATE OR REPLACE FUNCTION private.meter_release_expired_holds()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_hold public.meter_holds%ROWTYPE; v_result jsonb; v_count integer := 0;
BEGIN
  FOR v_hold IN SELECT h.* FROM public.meter_holds h
    WHERE h.state='held' AND h.expires_at<=now()
      AND h.action NOT IN ('geo_agent_run','backlink_order','schedule_run')
      AND NOT EXISTS (
        SELECT 1 FROM public.billing_studio_jobs b
        JOIN public.studio_jobs j ON j.id=b.job_id
        WHERE b.hold_id=h.id AND b.settled_at IS NULL
          AND j.status IN ('queued','running')
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.billing_ugc_renders b
        JOIN public.ugc_renders r ON r.id=b.render_id
        WHERE b.hold_id=h.id AND b.settled_at IS NULL
          AND r.status IN ('queued','submitting','processing','persisting')
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.billing_async_links b
        WHERE b.hold_id=h.id AND b.settled_at IS NULL
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
