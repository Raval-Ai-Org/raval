-- Billing v2 foundation. This migration creates account-owned money records but
-- makes no production purchases or plan changes. Existing backlink balances are
-- copied only when no legacy holds are live; otherwise fail before copying.

CREATE TABLE IF NOT EXISTS public.billing_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL UNIQUE,
  plan_id text NOT NULL DEFAULT 'free' CHECK (plan_id IN ('free','starter','growth','agency','scale','paused')),
  entitled_plan_id text CHECK (entitled_plan_id IS NULL OR entitled_plan_id IN ('free','starter','growth','agency','scale','paused')),
  billing_interval text CHECK (billing_interval IS NULL OR billing_interval IN ('month','year')),
  status text NOT NULL DEFAULT 'free' CHECK (status IN ('free','trialing','active','past_due','paused','canceled')),
  downgrade_to text CHECK (downgrade_to IS NULL OR downgrade_to IN ('free','starter','growth','agency','scale','paused')),
  downgrade_at timestamptz,
  trial_ends_at timestamptz,
  trial_used boolean NOT NULL DEFAULT false,
  current_period_start timestamptz,
  current_period_end timestamptz,
  grant_anchor timestamptz,
  next_grant_at timestamptz,
  grace_until timestamptz,
  cancel_at timestamptz,
  pause_started_at timestamptz,
  resume_plan_id text CHECK (resume_plan_id IS NULL OR resume_plan_id IN ('starter','growth','agency','scale')),
  comped_plan_id text CHECK (comped_plan_id IS NULL OR comped_plan_id IN ('starter','growth','agency','scale')),
  comped_until timestamptz,
  pro_overage_mode text NOT NULL DEFAULT 'credits' CHECK (pro_overage_mode IN ('credits','flash')),
  enforcement_override text CHECK (enforcement_override IS NULL OR enforcement_override IN ('off','shadow','on')),
  provider text NOT NULL DEFAULT 'paddle',
  provider_customer_id text UNIQUE,
  provider_subscription_id text UNIQUE,
  founding boolean NOT NULL DEFAULT false,
  referral_code text UNIQUE,
  referred_by_account_id uuid REFERENCES public.billing_accounts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION private.ensure_billing_account(p_user uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF p_user IS NULL THEN RAISE EXCEPTION 'billing owner required' USING ERRCODE = '22023'; END IF;
  INSERT INTO public.billing_accounts (owner_user_id, referral_code)
  VALUES (p_user, upper(substr(md5(p_user::text), 1, 10)))
  ON CONFLICT (owner_user_id) DO NOTHING;
  SELECT id INTO v_id FROM public.billing_accounts WHERE owner_user_id = p_user;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION private.ensure_billing_account(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.ensure_billing_account(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.ensure_billing_account(p_user uuid)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT private.ensure_billing_account(p_user);
$$;
REVOKE ALL ON FUNCTION public.ensure_billing_account(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_billing_account(uuid) TO service_role;

ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS billing_account_id uuid REFERENCES public.billing_accounts(id);
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS frozen_at timestamptz;
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS frozen_reason text;
ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS monthly_credit_cap bigint CHECK (monthly_credit_cap IS NULL OR monthly_credit_cap >= 0);

-- The trigger assigns a newly created brand to its owner's account. A service
-- path cannot transfer it by changing owner_id or billing_account_id later.
CREATE OR REPLACE FUNCTION private.guard_workspace_columns()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.domain := private.normalize_domain(NEW.website_url);
  IF TG_OP = 'INSERT' THEN
    NEW.billing_account_id := private.ensure_billing_account(NEW.owner_id);
  ELSIF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    IF auth.uid() IS NOT NULL THEN
      RAISE EXCEPTION 'workspace owner is server-managed' USING ERRCODE = '42501';
    END IF;
    RAISE EXCEPTION 'workspace ownership transfer is not supported; owner is server-managed' USING ERRCODE = '23514';
  ELSIF auth.uid() IS NOT NULL AND (
    NEW.plan IS DISTINCT FROM OLD.plan OR
    NEW.duplicate_of IS DISTINCT FROM OLD.duplicate_of OR
    NEW.billing_account_id IS DISTINCT FROM OLD.billing_account_id OR
    NEW.frozen_at IS DISTINCT FROM OLD.frozen_at OR
    NEW.frozen_reason IS DISTINCT FROM OLD.frozen_reason OR
    NEW.monthly_credit_cap IS DISTINCT FROM OLD.monthly_credit_cap
  ) THEN
    RAISE EXCEPTION 'workspace billing columns are server-managed' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.guard_workspace_columns() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.guard_workspace_columns() TO service_role;

INSERT INTO public.billing_accounts (owner_user_id, referral_code)
SELECT DISTINCT owner_id, upper(substr(md5(owner_id::text), 1, 10)) FROM public.workspaces
ON CONFLICT (owner_user_id) DO NOTHING;

UPDATE public.workspaces w SET billing_account_id = a.id
FROM public.billing_accounts a
WHERE a.owner_user_id = w.owner_id AND w.billing_account_id IS DISTINCT FROM a.id;
ALTER TABLE public.workspaces ALTER COLUMN billing_account_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS workspaces_billing_account_idx ON public.workspaces (billing_account_id);

-- Non-owners must not learn account ids through their existing workspace SELECT.
-- Existing callers select named columns; preserve those privileges columnwise.
REVOKE SELECT ON public.workspaces FROM authenticated;
DO $$
DECLARE v_columns text;
BEGIN
  SELECT string_agg(format('%I', column_name), ', ' ORDER BY ordinal_position)
  INTO v_columns FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'workspaces'
    AND column_name NOT IN ('billing_account_id', 'monthly_credit_cap', 'frozen_reason');
  EXECUTE 'GRANT SELECT (' || v_columns || ') ON public.workspaces TO authenticated';
END;
$$;

CREATE TABLE IF NOT EXISTS public.billing_subscription_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES public.billing_accounts(id) ON DELETE RESTRICT,
  catalog_key text NOT NULL, quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  provider_price_id text, provider_item_id text UNIQUE, status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS billing_subscription_items_account_idx ON public.billing_subscription_items (account_id);

CREATE TABLE IF NOT EXISTS public.billing_price_map (
  catalog_key text NOT NULL, interval text NOT NULL CHECK (interval IN ('month','year','one_time')),
  environment text NOT NULL CHECK (environment IN ('sandbox','production')),
  provider_price_id text NOT NULL UNIQUE, provider_product_id text NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0), active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (catalog_key, interval, environment)
);

CREATE TABLE IF NOT EXISTS public.meter_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES public.billing_accounts(id) ON DELETE RESTRICT,
  meter text NOT NULL CHECK (meter IN ('credits','video','pro_messages','flash_messages')),
  source text NOT NULL CHECK (source IN ('plan','rollover','trial','signup','pack','pack_bonus','addon','referral','promo','adjustment','migration')),
  restriction text NOT NULL CHECK (restriction IN ('any','ai_only')),
  amount bigint NOT NULL CHECK (amount > 0), remaining bigint NOT NULL CHECK (remaining >= 0),
  clawed_back bigint NOT NULL DEFAULT 0 CHECK (clawed_back >= 0),
  period_start timestamptz, expires_at timestamptz, workspace_id uuid,
  provider_ref text, idempotency_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, idempotency_key), CHECK (remaining + clawed_back <= amount),
  CHECK (meter <> 'credits' OR restriction IN ('any','ai_only'))
);
CREATE INDEX IF NOT EXISTS meter_grants_available_idx ON public.meter_grants (account_id, meter, expires_at) WHERE remaining > 0;

CREATE TABLE IF NOT EXISTS public.meter_balances (
  account_id uuid NOT NULL REFERENCES public.billing_accounts(id) ON DELETE RESTRICT,
  meter text NOT NULL CHECK (meter IN ('credits','video','pro_messages','flash_messages')),
  available bigint NOT NULL DEFAULT 0 CHECK (available >= 0),
  held bigint NOT NULL DEFAULT 0 CHECK (held >= 0),
  available_any bigint NOT NULL DEFAULT 0 CHECK (available_any >= 0),
  debt bigint NOT NULL DEFAULT 0 CHECK (debt >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (account_id, meter),
  CHECK (available_any <= available)
);

CREATE TABLE IF NOT EXISTS public.meter_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES public.billing_accounts(id) ON DELETE RESTRICT,
  meter text NOT NULL CHECK (meter IN ('credits','video','pro_messages','flash_messages')),
  workspace_id uuid, user_id uuid, action text NOT NULL, amount bigint NOT NULL CHECK (amount > 0),
  captured_amount bigint NOT NULL DEFAULT 0 CHECK (captured_amount >= 0),
  state text NOT NULL DEFAULT 'held' CHECK (state IN ('held','captured','released','expired')),
  expires_at timestamptz NOT NULL, idempotency_key text NOT NULL,
  allocations jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), finalized_at timestamptz,
  UNIQUE (account_id, idempotency_key), CHECK (captured_amount <= amount)
);
CREATE INDEX IF NOT EXISTS meter_holds_live_idx ON public.meter_holds (expires_at) WHERE state = 'held';

CREATE TABLE IF NOT EXISTS public.billing_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES public.billing_accounts(id) ON DELETE RESTRICT,
  workspace_id uuid, user_id uuid, action text NOT NULL, meter text NOT NULL,
  amount bigint NOT NULL CHECK (amount > 0), route text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.meter_ledger (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.billing_accounts(id) ON DELETE RESTRICT,
  meter text NOT NULL CHECK (meter IN ('credits','video','pro_messages','flash_messages')),
  kind text NOT NULL CHECK (kind IN ('grant','hold','capture','release','expire','refund','clawback','adjustment')),
  delta_available bigint NOT NULL, delta_held bigint NOT NULL,
  available_after bigint NOT NULL CHECK (available_after >= 0),
  held_after bigint NOT NULL CHECK (held_after >= 0),
  grant_id uuid, hold_id uuid, workspace_id uuid, user_id uuid, action text,
  charge_id uuid, reason text CHECK (reason IS NULL OR char_length(reason) <= 300),
  actor uuid, idempotency_key text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS meter_ledger_account_idx ON public.meter_ledger (account_id, created_at DESC);
CREATE OR REPLACE FUNCTION private.meter_ledger_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'meter_ledger is append-only' USING ERRCODE = '42501'; END;
$$;
REVOKE ALL ON FUNCTION private.meter_ledger_append_only() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS meter_ledger_immutable ON public.meter_ledger;
CREATE TRIGGER meter_ledger_immutable BEFORE UPDATE OR DELETE ON public.meter_ledger
  FOR EACH ROW EXECUTE FUNCTION private.meter_ledger_append_only();

CREATE TABLE IF NOT EXISTS public.checkout_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES public.billing_accounts(id) ON DELETE RESTRICT,
  created_by uuid NOT NULL, kind text NOT NULL, catalog_key text NOT NULL, interval text,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0), provider_price_id text,
  expires_at timestamptz NOT NULL, consumed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.billing_events (
  id text PRIMARY KEY, type text NOT NULL, occurred_at timestamptz, account_id uuid REFERENCES public.billing_accounts(id) ON DELETE SET NULL,
  payload jsonb NOT NULL, received_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz, error text
);
CREATE INDEX IF NOT EXISTS billing_events_unprocessed_idx ON public.billing_events (received_at) WHERE processed_at IS NULL;
CREATE TABLE IF NOT EXISTS public.billing_shadow_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, account_id uuid NOT NULL REFERENCES public.billing_accounts(id) ON DELETE CASCADE,
  workspace_id uuid, action text NOT NULL, meter text, amount bigint,
  decision text NOT NULL, reason text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS billing_shadow_events_account_idx ON public.billing_shadow_events (account_id, created_at DESC);
CREATE TABLE IF NOT EXISTS public.allowance_usage (
  account_id uuid NOT NULL REFERENCES public.billing_accounts(id) ON DELETE RESTRICT,
  window_start timestamptz NOT NULL, scans_used integer NOT NULL DEFAULT 0 CHECK (scans_used >= 0),
  extra_pages_scanned integer NOT NULL DEFAULT 0 CHECK (extra_pages_scanned >= 0),
  PRIMARY KEY (account_id, window_start)
);
CREATE TABLE IF NOT EXISTS public.brand_scan_allowances (
  account_id uuid NOT NULL REFERENCES public.billing_accounts(id) ON DELETE RESTRICT,
  normalized_domain text NOT NULL, kind text NOT NULL CHECK (kind IN ('brand_dna','brand_voice','first_upgrade_rescan')),
  used_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (account_id, normalized_domain, kind)
);
CREATE TABLE IF NOT EXISTS public.upgrade_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES public.billing_accounts(id) ON DELETE RESTRICT,
  workspace_id uuid NOT NULL, requested_by uuid NOT NULL, feature text NOT NULL,
  required_plan text, message text, status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), referrer_account_id uuid NOT NULL REFERENCES public.billing_accounts(id) ON DELETE RESTRICT,
  referred_account_id uuid NOT NULL UNIQUE REFERENCES public.billing_accounts(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending', rewarded_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.account_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id uuid NOT NULL REFERENCES public.billing_accounts(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL, kind text NOT NULL, payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  window_key text, read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, user_id, kind, window_key)
);

-- The old ledger's SET NULL foreign keys attempt UPDATEs against its
-- append-only trigger on deletion. Keep historical ids as plain UUIDs.
ALTER TABLE public.workspace_credit_ledger DROP CONSTRAINT IF EXISTS workspace_credit_ledger_actor_fkey;
ALTER TABLE public.workspace_credit_ledger DROP CONSTRAINT IF EXISTS workspace_credit_ledger_order_id_fkey;
ALTER TABLE public.workspace_credit_ledger DROP CONSTRAINT IF EXISTS workspace_credit_ledger_line_id_fkey;

-- Owner reads account records; service role writes money. Nonowners get a
-- sanitized wallet projection from the server after workspace membership check.
DO $$
DECLARE v_name text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'billing_accounts','billing_subscription_items','billing_price_map','meter_grants',
    'meter_balances','meter_holds','billing_charges','meter_ledger','checkout_intents',
    'billing_events','billing_shadow_events','allowance_usage','brand_scan_allowances',
    'upgrade_requests','referrals','account_notifications'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_name);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', v_name);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', v_name);
  END LOOP;
END;
$$;
GRANT SELECT ON public.billing_accounts, public.billing_subscription_items,
  public.meter_grants, public.meter_balances, public.meter_holds, public.billing_charges,
  public.meter_ledger, public.allowance_usage, public.account_notifications TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.meter_ledger_id_seq, public.billing_shadow_events_id_seq TO service_role;

DROP POLICY IF EXISTS billing_accounts_owner_read ON public.billing_accounts;
CREATE POLICY billing_accounts_owner_read ON public.billing_accounts FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid());
DO $$
DECLARE v_name text;
BEGIN
  FOREACH v_name IN ARRAY ARRAY[
    'billing_subscription_items','meter_grants','meter_balances','meter_holds',
    'billing_charges','meter_ledger','allowance_usage','account_notifications'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS billing_owner_read ON public.%I', v_name);
    EXECUTE format('CREATE POLICY billing_owner_read ON public.%I FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.billing_accounts a WHERE a.id = account_id AND a.owner_user_id = auth.uid()))', v_name);
  END LOOP;
END;
$$;

-- Grant the owner a read-only starting wallet from existing Stripe purchases.
-- Never silently drop a held legacy balance: an operator must settle the live
-- order first or migrate its exact hold in a separate reviewed operation.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.workspace_credit_balances WHERE held > 0) THEN
    RAISE EXCEPTION 'billing migration refused: legacy backlink holds are live' USING ERRCODE = 'P0001';
  END IF;
END;
$$;
