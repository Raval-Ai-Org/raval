-- Reserve a brand-level SocialAPI profile before starting provider OAuth.
-- Pending reservations prevent two brands from passing the same account cap.
CREATE TABLE IF NOT EXISTS public.billing_social_profile_slots (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.billing_accounts(id) ON DELETE RESTRICT,
  state text NOT NULL CHECK (state IN ('pending','active','released')),
  expires_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS billing_social_profile_slots_account_idx
  ON public.billing_social_profile_slots(account_id,state,expires_at);
ALTER TABLE public.billing_social_profile_slots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_social_profile_slots FROM anon,authenticated;
GRANT ALL ON public.billing_social_profile_slots TO service_role;

INSERT INTO public.billing_social_profile_slots(workspace_id,account_id,state)
SELECT DISTINCT w.id,w.billing_account_id,'active'
FROM public.workspaces w
JOIN public.social_accounts s ON s.workspace_id=w.id
WHERE s.provider='socialapi' AND s.status IN ('active','reconnect_required')
ON CONFLICT(workspace_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.reserve_billing_social_profile_slot(
  p_workspace uuid,p_limit integer
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_account uuid; v_used integer; v_slot public.billing_social_profile_slots%ROWTYPE;
BEGIN
  SELECT a.id INTO v_account FROM public.billing_accounts a
    JOIN public.workspaces w ON w.billing_account_id=a.id
    WHERE w.id=p_workspace FOR UPDATE OF a;
  IF NOT FOUND THEN RAISE EXCEPTION 'billing_account_missing'; END IF;
  SELECT * INTO v_slot FROM public.billing_social_profile_slots
    WHERE workspace_id=p_workspace;
  IF FOUND AND (v_slot.state='active' OR
      (v_slot.state='pending' AND v_slot.expires_at>now())) THEN
    UPDATE public.billing_social_profile_slots SET
      expires_at=CASE WHEN state='pending' THEN now()+interval '35 minutes' ELSE NULL END,
      updated_at=now() WHERE workspace_id=p_workspace;
    RETURN;
  END IF;
  SELECT count(*) INTO v_used FROM public.billing_social_profile_slots
    WHERE account_id=v_account AND (state='active' OR
      (state='pending' AND expires_at>now()));
  IF v_used>=p_limit THEN RAISE EXCEPTION 'billing_social_profile_limit'; END IF;
  INSERT INTO public.billing_social_profile_slots
    (workspace_id,account_id,state,expires_at,updated_at)
    VALUES(p_workspace,v_account,'pending',now()+interval '35 minutes',now())
  ON CONFLICT(workspace_id) DO UPDATE SET
    account_id=excluded.account_id,state='pending',expires_at=excluded.expires_at,
    updated_at=now();
END;
$$;
REVOKE ALL ON FUNCTION public.reserve_billing_social_profile_slot(uuid,integer)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_billing_social_profile_slot(uuid,integer)
  TO service_role;

CREATE OR REPLACE FUNCTION public.activate_billing_social_profile_slot(p_workspace uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  UPDATE public.billing_social_profile_slots SET state='active',expires_at=NULL,updated_at=now()
    WHERE workspace_id=p_workspace AND (state='active' OR
      (state='pending' AND expires_at>now()));
  IF NOT FOUND THEN RAISE EXCEPTION 'billing_social_profile_slot_missing'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.activate_billing_social_profile_slot(uuid)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.activate_billing_social_profile_slot(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.release_billing_social_profile_slot_if_empty(p_workspace uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_account uuid;
BEGIN
  SELECT a.id INTO v_account FROM public.billing_accounts a
    JOIN public.workspaces w ON w.billing_account_id=a.id
    WHERE w.id=p_workspace FOR UPDATE OF a;
  IF NOT FOUND THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM public.social_accounts
      WHERE workspace_id=p_workspace AND provider='socialapi'
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
