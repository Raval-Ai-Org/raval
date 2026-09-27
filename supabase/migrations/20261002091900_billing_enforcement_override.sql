CREATE TABLE IF NOT EXISTS public.billing_enforcement_actions (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.billing_accounts(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL,
  previous_mode text CHECK (previous_mode IS NULL OR previous_mode IN ('off','shadow','on')),
  next_mode text CHECK (next_mode IS NULL OR next_mode IN ('off','shadow','on')),
  reason text NOT NULL CHECK (length(reason) BETWEEN 20 AND 300),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.billing_enforcement_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_enforcement_actions FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.billing_enforcement_actions TO service_role;
DROP TRIGGER IF EXISTS billing_enforcement_actions_immutable ON public.billing_enforcement_actions;
CREATE TRIGGER billing_enforcement_actions_immutable BEFORE UPDATE OR DELETE
  ON public.billing_enforcement_actions FOR EACH ROW
  EXECUTE FUNCTION private.guard_billing_admin_adjustment();

CREATE OR REPLACE FUNCTION public.set_billing_enforcement_override(
  p_action uuid, p_account uuid, p_actor uuid, p_mode text, p_reason text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_previous text; v_existing public.billing_enforcement_actions%ROWTYPE;
BEGIN
  IF p_action IS NULL OR p_account IS NULL OR p_actor IS NULL OR
     (p_mode IS NOT NULL AND p_mode NOT IN ('off','shadow','on')) OR
     length(coalesce(p_reason,'')) NOT BETWEEN 20 AND 300 THEN
    RAISE EXCEPTION 'invalid enforcement change' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v_existing FROM public.billing_enforcement_actions WHERE id=p_action;
  IF FOUND THEN
    IF v_existing.account_id<>p_account OR v_existing.actor_user_id<>p_actor OR
       v_existing.next_mode IS DISTINCT FROM p_mode OR v_existing.reason<>p_reason THEN
      RAISE EXCEPTION 'enforcement action key conflict' USING ERRCODE='23505';
    END IF;
    RETURN jsonb_build_object('ok',true,'replayed',true,'previous',v_existing.previous_mode,'next',v_existing.next_mode);
  END IF;
  SELECT enforcement_override INTO v_previous FROM public.billing_accounts WHERE id=p_account FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'billing account missing' USING ERRCODE='22023'; END IF;
  UPDATE public.billing_accounts SET enforcement_override=p_mode,updated_at=now(),capacity_reconciled_at=NULL
    WHERE id=p_account;
  INSERT INTO public.billing_enforcement_actions
    (id,account_id,actor_user_id,previous_mode,next_mode,reason)
    VALUES(p_action,p_account,p_actor,v_previous,p_mode,p_reason);
  RETURN jsonb_build_object('ok',true,'replayed',false,'previous',v_previous,'next',p_mode);
END;
$$;
REVOKE ALL ON FUNCTION public.set_billing_enforcement_override(uuid,uuid,uuid,text,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_billing_enforcement_override(uuid,uuid,uuid,text,text)
  TO service_role;
