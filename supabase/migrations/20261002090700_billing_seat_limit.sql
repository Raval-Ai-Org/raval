-- Accepting an invitation is the authoritative point where a seat is used.
-- Locking the account serializes accepts across all of its brands.
-- Direct browser writes would bypass that account lock.
REVOKE INSERT, UPDATE ON public.workspace_members FROM authenticated;
REVOKE ALL ON FUNCTION public.accept_workspace_invite(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.accept_billed_workspace_invite(
  p_token uuid,
  p_user uuid,
  p_email text,
  p_seat_limit integer DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_invite public.workspace_invites%ROWTYPE;
  v_account public.billing_accounts%ROWTYPE;
  v_workspace uuid;
  v_existing text;
  v_already_seated boolean;
  v_used integer;
BEGIN
  SELECT * INTO v_invite FROM public.workspace_invites
    WHERE token=p_token FOR UPDATE;
  IF NOT FOUND OR lower(v_invite.email)<>lower(trim(p_email)) THEN
    RAISE EXCEPTION 'billing_invite_invalid';
  END IF;
  v_workspace := v_invite.workspace_id;
  SELECT a.* INTO v_account FROM public.billing_accounts a
    JOIN public.workspaces w ON w.billing_account_id=a.id
    WHERE w.id=v_workspace FOR UPDATE OF a;
  IF NOT FOUND THEN RAISE EXCEPTION 'billing_account_missing'; END IF;
  SELECT role INTO v_existing FROM public.workspace_members
    WHERE workspace_id=v_workspace AND user_id=p_user;
  IF v_invite.role IN ('admin','editor') AND
     coalesce(v_existing,'viewer')='viewer' AND
     p_user<>v_account.owner_user_id AND p_seat_limit IS NOT NULL THEN
    SELECT EXISTS(
      SELECT 1 FROM public.workspace_members m
      JOIN public.workspaces w ON w.id=m.workspace_id
      WHERE w.billing_account_id=v_account.id
        AND m.user_id=p_user AND m.role IN ('owner','admin','editor')
    ) INTO v_already_seated;
    IF NOT v_already_seated THEN
      SELECT 1+count(DISTINCT m.user_id) INTO v_used
      FROM public.workspace_members m
      JOIN public.workspaces w ON w.id=m.workspace_id
      WHERE w.billing_account_id=v_account.id
        AND m.user_id<>v_account.owner_user_id
        AND m.role IN ('owner','admin','editor');
      IF v_used>=p_seat_limit THEN RAISE EXCEPTION 'billing_seat_limit'; END IF;
    END IF;
  END IF;
  IF v_existing IS NULL THEN
    INSERT INTO public.workspace_members(workspace_id,user_id,role)
      VALUES(v_workspace,p_user,v_invite.role::public.app_role);
  ELSIF (CASE v_existing WHEN 'viewer' THEN 1 WHEN 'editor' THEN 2
           WHEN 'admin' THEN 3 ELSE 4 END)
      < (CASE v_invite.role WHEN 'viewer' THEN 1 WHEN 'editor' THEN 2 ELSE 3 END) THEN
    UPDATE public.workspace_members SET role=v_invite.role::public.app_role
      WHERE workspace_id=v_workspace AND user_id=p_user;
  END IF;
  UPDATE public.workspace_invites SET accepted_at=coalesce(accepted_at,now())
    WHERE id=v_invite.id;
  RETURN v_workspace;
END;
$$;
REVOKE ALL ON FUNCTION public.accept_billed_workspace_invite(uuid,uuid,text,integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.accept_billed_workspace_invite(uuid,uuid,text,integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.change_billed_workspace_member_role(
  p_workspace uuid,
  p_user uuid,
  p_role public.app_role,
  p_seat_limit integer DEFAULT NULL
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE
  v_account public.billing_accounts%ROWTYPE;
  v_existing public.app_role;
  v_used integer;
BEGIN
  IF p_role NOT IN ('admin','editor','viewer') THEN RAISE EXCEPTION 'billing_role_invalid'; END IF;
  SELECT a.* INTO v_account FROM public.billing_accounts a
    JOIN public.workspaces w ON w.billing_account_id=a.id
    WHERE w.id=p_workspace FOR UPDATE OF a;
  IF NOT FOUND THEN RAISE EXCEPTION 'billing_account_missing'; END IF;
  SELECT role INTO v_existing FROM public.workspace_members
    WHERE workspace_id=p_workspace AND user_id=p_user FOR UPDATE;
  IF NOT FOUND OR v_existing='owner' THEN RAISE EXCEPTION 'billing_member_missing'; END IF;
  IF v_existing='viewer' AND p_role IN ('admin','editor')
     AND p_user<>v_account.owner_user_id AND p_seat_limit IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.workspace_members m
       JOIN public.workspaces w ON w.id=m.workspace_id
       WHERE w.billing_account_id=v_account.id
         AND m.user_id=p_user AND m.role IN ('owner','admin','editor')
     ) THEN
    SELECT 1+count(DISTINCT m.user_id) INTO v_used
    FROM public.workspace_members m
    JOIN public.workspaces w ON w.id=m.workspace_id
    WHERE w.billing_account_id=v_account.id
      AND m.user_id<>v_account.owner_user_id
      AND m.role IN ('owner','admin','editor');
    IF v_used>=p_seat_limit THEN RAISE EXCEPTION 'billing_seat_limit'; END IF;
  END IF;
  UPDATE public.workspace_members SET role=p_role
    WHERE workspace_id=p_workspace AND user_id=p_user;
END;
$$;
REVOKE ALL ON FUNCTION public.change_billed_workspace_member_role(uuid,uuid,public.app_role,integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.change_billed_workspace_member_role(uuid,uuid,public.app_role,integer)
  TO service_role;
