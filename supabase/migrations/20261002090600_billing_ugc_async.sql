-- Worker-owned video holds; one render/request, one wallet capture.
-- New billing requests stay invisible to every worker until the hold is linked.
ALTER TABLE public.ugc_renders
  ADD COLUMN IF NOT EXISTS billing_ready boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.claim_ugc_renders(
  p_worker text,
  p_max integer DEFAULT 5,
  p_lease_seconds integer DEFAULT 120,
  p_id uuid DEFAULT NULL
)
RETURNS SETOF public.ugc_renders
LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  UPDATE public.ugc_renders AS r
     SET lease_until = now() + make_interval(secs => greatest(p_lease_seconds, 30)),
         locked_by = p_worker,
         attempts = r.attempts + 1
   WHERE r.id IN (
     SELECT u.id FROM public.ugc_renders u
      WHERE u.billing_ready
        AND u.status IN ('queued', 'submitting', 'processing', 'persisting')
        AND (p_id IS NULL OR u.id = p_id)
        AND u.next_attempt_at <= now()
        AND (u.lease_until IS NULL OR u.lease_until < now())
      ORDER BY u.next_attempt_at
      LIMIT greatest(p_max, 0)
      FOR UPDATE SKIP LOCKED
   )
  RETURNING r.*;
$$;
REVOKE ALL ON FUNCTION public.claim_ugc_renders(text, integer, integer, uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_ugc_renders(text, integer, integer, uuid)
  TO service_role;

CREATE TABLE IF NOT EXISTS public.billing_ugc_renders (
  render_id uuid PRIMARY KEY REFERENCES public.ugc_renders(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.billing_accounts(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  hold_id uuid UNIQUE REFERENCES public.meter_holds(id) ON DELETE RESTRICT,
  charge_id uuid,
  charge_key text NOT NULL,
  action text NOT NULL,
  units integer NOT NULL CHECK (units > 0),
  mode text NOT NULL CHECK (mode IN ('off','shadow','on')),
  shadow_decision text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  CHECK (mode <> 'on' OR hold_id IS NOT NULL),
  UNIQUE (account_id, charge_key)
);
CREATE INDEX IF NOT EXISTS billing_ugc_renders_unsettled_idx
  ON public.billing_ugc_renders (created_at) WHERE settled_at IS NULL;
ALTER TABLE public.billing_ugc_renders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_ugc_renders FROM anon, authenticated;
GRANT ALL ON public.billing_ugc_renders TO service_role;

-- The generic sweeper never releases a hold while its provider job is live.
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
