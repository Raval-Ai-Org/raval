ALTER TABLE public.billing_accounts
  ADD COLUMN IF NOT EXISTS capacity_reconciled_at timestamptz;
CREATE INDEX IF NOT EXISTS billing_accounts_capacity_cursor_idx
  ON public.billing_accounts(capacity_reconciled_at, id);
