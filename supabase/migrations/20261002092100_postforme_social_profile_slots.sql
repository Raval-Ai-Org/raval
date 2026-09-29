-- Post for Me is the active social distribution provider. Social accounts are
-- unlimited on every plan, so profile slots no longer limit anything. Existing
-- SocialAPI connections are left untouched: SocialAPI stays as a legacy adapter
-- until each brand reconnects through Post for Me.

UPDATE public.billing_social_profile_slots slot
SET state = 'released', expires_at = NULL, updated_at = now()
WHERE state = 'active' AND NOT EXISTS (
  SELECT 1 FROM public.social_accounts account
  WHERE account.workspace_id = slot.workspace_id AND account.provider = 'postforme'
    AND account.status IN ('active', 'reconnect_required')
);

CREATE OR REPLACE FUNCTION public.release_billing_social_profile_slot_if_empty(p_workspace uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_account uuid;
BEGIN
  SELECT a.id INTO v_account FROM public.billing_accounts a
    JOIN public.workspaces w ON w.billing_account_id=a.id
    WHERE w.id=p_workspace FOR UPDATE OF a;
  IF NOT FOUND THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM public.social_accounts
      WHERE workspace_id=p_workspace AND provider='postforme'
        AND status IN ('active','reconnect_required')) THEN RETURN false; END IF;
  UPDATE public.billing_social_profile_slots SET state='released',expires_at=NULL,updated_at=now()
    WHERE workspace_id=p_workspace AND state='active';
  RETURN FOUND;
END;
$$;
REVOKE ALL ON FUNCTION public.release_billing_social_profile_slot_if_empty(uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.release_billing_social_profile_slot_if_empty(uuid)
  TO service_role;
