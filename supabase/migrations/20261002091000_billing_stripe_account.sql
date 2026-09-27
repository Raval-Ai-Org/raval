-- Stripe account purchases are recorded independently of the historical
-- workspace checkout. The checkout intent is the only trusted bridge from a
-- signed Stripe event to an account and catalog item.
ALTER TABLE public.checkout_intents
  ADD COLUMN IF NOT EXISTS provider_session_id text UNIQUE;

CREATE TABLE IF NOT EXISTS public.billing_payment_records (
  provider_payment_id text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.billing_accounts(id) ON DELETE RESTRICT,
  checkout_intent_id uuid REFERENCES public.checkout_intents(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('credit_pack','video_pack','subscription','addon')),
  catalog_key text NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents >= 0),
  grant_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  refunded_cents integer NOT NULL DEFAULT 0 CHECK (refunded_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (refunded_cents <= amount_cents)
);
CREATE INDEX IF NOT EXISTS billing_payment_records_account_idx
  ON public.billing_payment_records(account_id, created_at DESC);

ALTER TABLE public.billing_payment_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_payment_records FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.billing_payment_records TO service_role;
GRANT SELECT ON public.billing_payment_records TO authenticated;
DROP POLICY IF EXISTS billing_payment_owner_read ON public.billing_payment_records;
CREATE POLICY billing_payment_owner_read ON public.billing_payment_records
  FOR SELECT TO authenticated USING (EXISTS (
    SELECT 1 FROM public.billing_accounts a
    WHERE a.id = account_id AND a.owner_user_id = auth.uid()
  ));
