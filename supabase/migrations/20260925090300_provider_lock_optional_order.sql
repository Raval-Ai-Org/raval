-- acquire_provider_lock: make p_order_id optional.
--
-- The lock exists to serialise access to the shared provider basket. That is
-- useful on its own — an operator taking the basket for maintenance, or a
-- reconciliation pass — and none of those callers has an order id to give.
-- Without a default, PostgREST could not resolve the call at all.
--
-- The signature is unchanged, so the existing grants and callers still apply.
CREATE OR REPLACE FUNCTION public.acquire_provider_lock(
  p_provider text,
  p_holder text,
  p_order_id uuid DEFAULT NULL,
  p_lease_seconds integer DEFAULT 180
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.provider_basket_lock%ROWTYPE;
  v_token uuid;
  v_takeover boolean := false;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('provider_basket_lock:' || p_provider));

  SELECT * INTO v_row FROM public.provider_basket_lock
   WHERE provider = p_provider FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'unknown_provider');
  END IF;

  IF v_row.quarantined THEN
    RETURN jsonb_build_object('ok', false, 'code', 'quarantined',
                              'reason', v_row.quarantine_reason);
  END IF;

  IF v_row.token IS NOT NULL AND v_row.lease_until > now() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'busy',
      'holder', v_row.holder, 'order_id', v_row.order_id,
      'lease_until', v_row.lease_until);
  END IF;

  -- A live token whose lease has expired means the previous holder died.
  v_takeover := v_row.token IS NOT NULL AND v_row.released_at IS NULL;
  v_token := gen_random_uuid();

  UPDATE public.provider_basket_lock
     SET holder = p_holder,
         token = v_token,
         order_id = p_order_id,
         phase = 'acquired',
         acquired_at = now(),
         renewed_at = now(),
         released_at = NULL,
         lease_until = now() + make_interval(secs => greatest(p_lease_seconds, 60)),
         takeover_count = takeover_count + (CASE WHEN v_takeover THEN 1 ELSE 0 END)
   WHERE provider = p_provider;

  RETURN jsonb_build_object('ok', true, 'token', v_token, 'takeover', v_takeover,
                            'previous_order_id', v_row.order_id);
END;
$$;

REVOKE ALL ON FUNCTION public.acquire_provider_lock(text, text, uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_provider_lock(text, text, uuid, integer) TO service_role;
