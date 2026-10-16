-- Entitlement overrides (admin console, phase 2).
--
-- An override is an exception to what a plan allows, set by Mellox staff:
-- allow or deny one feature, or set one numeric limit, for a whole billing
-- account (every brand) or for a single workspace. Each has a reason, a start,
-- and an optional end; once the end passes it simply stops applying (it is
-- evaluated when read, so there is nothing to clean up on a schedule).
--
-- The plan catalog stays the baseline (src/lib/billing/catalog.ts). With no
-- active row here, entitlements are exactly what the plan says.
--
-- Same rules as the admin foundation: RLS on with no policy, service role only,
-- and every change is made by a function that writes the admin audit row in the
-- same transaction. Which keys are valid is decided in the app (the catalog is
-- code); the table only guarantees the shape.

CREATE TABLE IF NOT EXISTS public.entitlement_overrides (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL REFERENCES public.billing_accounts (id) ON DELETE CASCADE,
  -- NULL = the whole account; otherwise one workspace of that account.
  workspace_id   uuid REFERENCES public.workspaces (id) ON DELETE CASCADE,
  kind           text NOT NULL CONSTRAINT entitlement_overrides_kind_check CHECK (kind IN ('feature', 'limit')),
  key            text NOT NULL CONSTRAINT entitlement_overrides_key_check CHECK (key ~ '^[A-Za-z0-9_]{1,64}$'),
  allowed        boolean,
  limit_value    integer CONSTRAINT entitlement_overrides_limit_range CHECK (limit_value IS NULL OR limit_value BETWEEN 0 AND 1000000),
  reason         text NOT NULL CONSTRAINT entitlement_overrides_reason_len CHECK (char_length(reason) BETWEEN 10 AND 300),
  starts_at      timestamptz NOT NULL DEFAULT now(),
  expires_at     timestamptz,
  created_by     uuid NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  revoked_at     timestamptz,
  revoked_by     uuid,
  revoke_reason  text CONSTRAINT entitlement_overrides_revoke_len CHECK (revoke_reason IS NULL OR char_length(revoke_reason) <= 300),
  CONSTRAINT entitlement_overrides_shape CHECK (
    (kind = 'feature' AND allowed IS NOT NULL AND limit_value IS NULL)
    OR (kind = 'limit' AND allowed IS NULL AND limit_value IS NOT NULL)
  ),
  CONSTRAINT entitlement_overrides_window CHECK (expires_at IS NULL OR expires_at > starts_at),
  CONSTRAINT entitlement_overrides_revoked_pair CHECK ((revoked_at IS NULL) = (revoked_by IS NULL))
);

-- One un-revoked override per target; a newer one replaces the older.
CREATE UNIQUE INDEX IF NOT EXISTS entitlement_overrides_one_open_idx
  ON public.entitlement_overrides (
    account_id,
    coalesce(workspace_id, '00000000-0000-0000-0000-000000000000'::uuid),
    kind,
    key
  ) WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS entitlement_overrides_account_idx
  ON public.entitlement_overrides (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS entitlement_overrides_workspace_idx
  ON public.entitlement_overrides (workspace_id, created_at DESC) WHERE workspace_id IS NOT NULL;

ALTER TABLE public.entitlement_overrides ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.entitlement_overrides FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.entitlement_overrides TO service_role;

/* ───────────────────────────── writes ───────────────────────────── */

CREATE OR REPLACE FUNCTION public.admin_override_create(
  p_actor uuid,
  p_actor_role text,
  p_account uuid,
  p_workspace uuid,
  p_kind text,
  p_key text,
  p_allowed boolean,
  p_limit_value integer,
  p_starts_at timestamptz,
  p_expires_at timestamptz,
  p_reason text,
  p_request_id text,
  p_ip text,
  p_user_agent text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_starts timestamptz := coalesce(p_starts_at, now());
  v_replaced public.entitlement_overrides%ROWTYPE;
  v_row public.entitlement_overrides%ROWTYPE;
  v_reason text := btrim(coalesce(p_reason, ''));
BEGIN
  IF char_length(v_reason) < 10 THEN
    RAISE EXCEPTION 'A reason of at least 10 characters is required.' USING ERRCODE = '22023';
  END IF;
  IF p_kind NOT IN ('feature', 'limit') THEN
    RAISE EXCEPTION 'Invalid override kind.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.billing_accounts WHERE id = p_account) THEN
    RAISE EXCEPTION 'No such billing account.' USING ERRCODE = 'P0002';
  END IF;
  IF p_workspace IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.workspaces WHERE id = p_workspace AND billing_account_id = p_account
  ) THEN
    RAISE EXCEPTION 'That workspace does not belong to this billing account.' USING ERRCODE = 'P0002';
  END IF;
  IF p_expires_at IS NOT NULL AND (p_expires_at <= v_starts OR p_expires_at <= now()) THEN
    RAISE EXCEPTION 'The end date must be in the future and after the start.' USING ERRCODE = '22023';
  END IF;

  -- The newer override replaces whatever was open for the same target.
  UPDATE public.entitlement_overrides
     SET revoked_at = now(), revoked_by = p_actor, revoke_reason = 'Replaced by a newer override'
   WHERE account_id = p_account
     AND workspace_id IS NOT DISTINCT FROM p_workspace
     AND kind = p_kind AND key = p_key AND revoked_at IS NULL
  RETURNING * INTO v_replaced;

  INSERT INTO public.entitlement_overrides (
    account_id, workspace_id, kind, key, allowed, limit_value,
    reason, starts_at, expires_at, created_by
  ) VALUES (
    p_account, p_workspace, p_kind, p_key, p_allowed, p_limit_value,
    v_reason, v_starts, p_expires_at, p_actor
  ) RETURNING * INTO v_row;

  PERFORM private.admin_audit_write(
    p_actor, p_actor_role, 'entitlement.override_created',
    CASE WHEN p_workspace IS NULL THEN 'billing_account' ELSE 'workspace' END,
    coalesce(p_workspace, p_account)::text,
    p_workspace,
    CASE WHEN v_replaced.id IS NULL THEN NULL ELSE jsonb_build_object(
      'replaced', v_replaced.id, 'allowed', v_replaced.allowed,
      'limit_value', v_replaced.limit_value, 'expires_at', v_replaced.expires_at) END,
    jsonb_build_object(
      'override_id', v_row.id, 'account_id', p_account, 'kind', p_kind, 'key', p_key,
      'allowed', v_row.allowed, 'limit_value', v_row.limit_value,
      'starts_at', v_row.starts_at, 'expires_at', v_row.expires_at),
    v_reason, p_request_id, p_ip, p_user_agent);

  RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_override_revoke(
  p_actor uuid,
  p_actor_role text,
  p_id uuid,
  p_reason text,
  p_request_id text,
  p_ip text,
  p_user_agent text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_row public.entitlement_overrides%ROWTYPE;
  v_reason text := btrim(coalesce(p_reason, ''));
BEGIN
  IF char_length(v_reason) < 10 THEN
    RAISE EXCEPTION 'A reason of at least 10 characters is required.' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_row FROM public.entitlement_overrides WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such override.' USING ERRCODE = 'P0002';
  END IF;
  IF v_row.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'This override was already ended.' USING ERRCODE = '23514';
  END IF;

  UPDATE public.entitlement_overrides
     SET revoked_at = now(), revoked_by = p_actor, revoke_reason = left(v_reason, 300)
   WHERE id = p_id
  RETURNING * INTO v_row;

  PERFORM private.admin_audit_write(
    p_actor, p_actor_role, 'entitlement.override_revoked',
    CASE WHEN v_row.workspace_id IS NULL THEN 'billing_account' ELSE 'workspace' END,
    coalesce(v_row.workspace_id, v_row.account_id)::text,
    v_row.workspace_id,
    jsonb_build_object('override_id', v_row.id, 'kind', v_row.kind, 'key', v_row.key,
      'allowed', v_row.allowed, 'limit_value', v_row.limit_value, 'expires_at', v_row.expires_at),
    jsonb_build_object('revoked', true),
    v_reason, p_request_id, p_ip, p_user_agent);

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION
  public.admin_override_create(uuid, text, uuid, uuid, text, text, boolean, integer, timestamptz, timestamptz, text, text, text, text),
  public.admin_override_revoke(uuid, text, uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.admin_override_create(uuid, text, uuid, uuid, text, text, boolean, integer, timestamptz, timestamptz, text, text, text, text),
  public.admin_override_revoke(uuid, text, uuid, text, text, text, text)
  TO service_role;
