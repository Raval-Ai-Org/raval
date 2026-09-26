-- Enforce account brand limits inside the same advisory lock as workspace
-- creation. The service role supplies the catalog-derived limit only in
-- enforcement-on mode; callers with an existing request/domain still replay.
CREATE OR REPLACE FUNCTION public.create_billed_workspace_for_user(
  p_user_id uuid,
  p_name text,
  p_website_url text,
  p_idempotency_key text,
  p_brand_limit integer
)
RETURNS TABLE (workspace_id uuid, created boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing uuid;
  v_domain text := private.normalize_domain(p_website_url);
  v_used integer;
BEGIN
  IF p_user_id IS NULL OR p_brand_limit IS NULL OR p_brand_limit < 0 THEN
    RAISE EXCEPTION 'invalid billing brand limit' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('workspace-create:' || p_user_id::text));

  IF p_idempotency_key IS NOT NULL THEN
    SELECT r.workspace_id INTO v_existing
      FROM public.workspace_create_requests r
     WHERE r.idempotency_key = p_idempotency_key AND r.user_id = p_user_id;
  END IF;
  IF v_existing IS NULL AND v_domain IS NOT NULL THEN
    SELECT w.id INTO v_existing
      FROM public.workspaces w
     WHERE w.owner_id = p_user_id AND w.domain = v_domain AND w.duplicate_of IS NULL
     LIMIT 1;
  END IF;
  IF v_existing IS NOT NULL THEN
    RETURN QUERY SELECT v_existing, false;
    RETURN;
  END IF;

  SELECT count(*)::integer INTO v_used
    FROM public.workspaces w
   WHERE w.owner_id = p_user_id AND w.duplicate_of IS NULL AND w.frozen_at IS NULL;
  IF v_used >= p_brand_limit THEN
    RAISE EXCEPTION 'billing_brand_limit' USING ERRCODE = 'P0001';
  END IF;
  RETURN QUERY SELECT * FROM private.create_workspace_for_user(
    p_user_id, p_name, p_website_url, p_idempotency_key
  );
END;
$$;
REVOKE ALL ON FUNCTION public.create_billed_workspace_for_user(uuid,text,text,text,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_billed_workspace_for_user(uuid,text,text,text,integer) TO service_role;
