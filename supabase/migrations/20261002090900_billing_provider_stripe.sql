-- User decision: Stripe replaces the planned Paddle provider. Do not rewrite
-- accounts already linked to a payment provider; only unlinked accounts move.
ALTER TABLE public.billing_accounts ALTER COLUMN provider SET DEFAULT 'stripe';
UPDATE public.billing_accounts
SET provider = 'stripe', updated_at = now()
WHERE provider = 'paddle'
  AND provider_customer_id IS NULL
  AND provider_subscription_id IS NULL;
