-- Promo trials: a code from Mellox gives a short trial with a few credits.
--
-- There is no Free plan (ADR-0050). A code is the only way in without paying
-- first, and it still needs a card: Stripe holds the subscription in
-- `trialing` and charges the chosen plan when the trial ends. While it runs the
-- account is on the trial tier (free features only, one brand, no video;
-- `src/lib/billing/promo.ts`).
--
-- Abuse guards, all enforced here as well as in code:
--   * one promo trial per billing account, ever (unique account_id);
--   * one promo trial per card, ever (billing_trial_cards, unique fingerprint);
--   * a code's own use cap, dates and switch, claimed with a compare-and-set
--     in redeem_promo_code so two sign-ups can't both take the last use.
-- Every table is service-role only: no browser reads codes or redemptions.

CREATE TABLE IF NOT EXISTS public.billing_promo_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{3,31}$'),
  label text NOT NULL DEFAULT '' CHECK (char_length(label) <= 80),
  trial_days integer NOT NULL CHECK (trial_days BETWEEN 1 AND 14),
  credits integer NOT NULL CHECK (credits BETWEEN 1 AND 200),
  max_redemptions integer CHECK (max_redemptions IS NULL OR max_redemptions BETWEEN 1 AND 100000),
  redeemed_count integer NOT NULL DEFAULT 0 CHECK (redeemed_count >= 0),
  starts_at timestamptz,
  expires_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 300),
  created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.billing_promo_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_id uuid NOT NULL REFERENCES public.billing_promo_codes (id) ON DELETE RESTRICT,
  account_id uuid NOT NULL UNIQUE REFERENCES public.billing_accounts (id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  subscription_id text NOT NULL UNIQUE,
  card_fingerprint text,
  status text NOT NULL DEFAULT 'trialing'
    CHECK (status IN ('trialing', 'converted', 'ended', 'refused')),
  trial_ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS billing_promo_redemptions_code_idx
  ON public.billing_promo_redemptions (code_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.billing_trial_cards (
  fingerprint text PRIMARY KEY CHECK (char_length(fingerprint) BETWEEN 4 AND 64),
  account_id uuid NOT NULL REFERENCES public.billing_accounts (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.billing_promo_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_promo_redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_trial_cards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_promo_codes FROM anon, authenticated;
REVOKE ALL ON public.billing_promo_redemptions FROM anon, authenticated;
REVOKE ALL ON public.billing_trial_cards FROM anon, authenticated;

-- Which tier an account's trial or staff pass runs on. NULL = the plan itself.
ALTER TABLE public.billing_accounts ADD COLUMN IF NOT EXISTS trial_tier text;
ALTER TABLE public.billing_accounts ADD COLUMN IF NOT EXISTS comped_tier text;
ALTER TABLE public.billing_accounts DROP CONSTRAINT IF EXISTS billing_accounts_trial_tier_check;
ALTER TABLE public.billing_accounts ADD CONSTRAINT billing_accounts_trial_tier_check
  CHECK (trial_tier IS NULL OR trial_tier = 'promo');
ALTER TABLE public.billing_accounts DROP CONSTRAINT IF EXISTS billing_accounts_comped_tier_check;
ALTER TABLE public.billing_accounts ADD CONSTRAINT billing_accounts_comped_tier_check
  CHECK (comped_tier IS NULL OR comped_tier = 'trial');

-- Claim one use of a code for one account's trial. Returns the redemption id,
-- or NULL when the code is off, outside its dates, used up, or the account or
-- card already had a promo trial. Repeating the same subscription returns the
-- same row, so a webhook replay is harmless.
CREATE OR REPLACE FUNCTION public.redeem_promo_code(
  p_code uuid,
  p_account uuid,
  p_user uuid,
  p_subscription text,
  p_fingerprint text,
  p_trial_ends timestamptz
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing uuid;
  v_id uuid;
BEGIN
  SELECT id INTO v_existing FROM billing_promo_redemptions
   WHERE subscription_id = p_subscription AND account_id = p_account;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;
  IF EXISTS (SELECT 1 FROM billing_promo_redemptions WHERE account_id = p_account) THEN
    RETURN NULL;
  END IF;
  IF p_fingerprint IS NOT NULL AND EXISTS (
    SELECT 1 FROM billing_trial_cards WHERE fingerprint = p_fingerprint AND account_id <> p_account
  ) THEN
    RETURN NULL;
  END IF;

  UPDATE billing_promo_codes
     SET redeemed_count = redeemed_count + 1, updated_at = now()
   WHERE id = p_code
     AND active
     AND (starts_at IS NULL OR starts_at <= now())
     AND (expires_at IS NULL OR expires_at > now())
     AND (max_redemptions IS NULL OR redeemed_count < max_redemptions);
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  INSERT INTO billing_promo_redemptions
    (code_id, account_id, user_id, subscription_id, card_fingerprint, trial_ends_at)
  VALUES (p_code, p_account, p_user, p_subscription, p_fingerprint, p_trial_ends)
  RETURNING id INTO v_id;
  IF p_fingerprint IS NOT NULL THEN
    INSERT INTO billing_trial_cards (fingerprint, account_id)
    VALUES (p_fingerprint, p_account)
    ON CONFLICT (fingerprint) DO NOTHING;
  END IF;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.redeem_promo_code(uuid, uuid, uuid, text, text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_promo_code(uuid, uuid, uuid, text, text, timestamptz)
  TO service_role;

-- The three launch codes. Staff add, pause and cap codes in /admin/promos.
INSERT INTO public.billing_promo_codes (code, label, trial_days, credits, max_redemptions, note)
VALUES
  ('MOX1-AB3CXC', '1-day trial', 1, 10, 500, 'Launch code: 1 day, 10 credits'),
  ('MOX2-D9T8HK', '2-day trial', 2, 15, 500, 'Launch code: 2 days, 15 credits'),
  ('MOX3-ZD6S9M', '3-day trial', 3, 25, 500, 'Launch code: 3 days, 25 credits')
ON CONFLICT (code) DO NOTHING;
