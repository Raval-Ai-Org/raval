CREATE OR REPLACE FUNCTION public.log_audit(
  _workspace_id uuid,
  _action text,
  _entity text DEFAULT NULL,
  _payload jsonb DEFAULT '{}'::jsonb
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF _workspace_id IS NULL OR _action IS NULL OR length(btrim(_action)) = 0 THEN
    RAISE EXCEPTION 'workspace_id and action required';
  END IF;
  IF NOT public.is_workspace_member(_workspace_id, v_uid) THEN
    RAISE EXCEPTION 'not a workspace member';
  END IF;

  INSERT INTO public.audit_logs (workspace_id, user_id, action, entity, payload)
  VALUES (_workspace_id, v_uid, _action, _entity, COALESCE(_payload, '{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.log_audit(uuid, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_audit(uuid, text, text, jsonb) TO authenticated;

CREATE INDEX IF NOT EXISTS audit_logs_workspace_created_idx
  ON public.audit_logs (workspace_id, created_at DESC);