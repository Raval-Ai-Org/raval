-- At most one open subscription Checkout Session per billing account.
CREATE UNIQUE INDEX IF NOT EXISTS checkout_intents_open_plan_idx
  ON public.checkout_intents(account_id)
  WHERE kind='plan' AND consumed_at IS NULL;
