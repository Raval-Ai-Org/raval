ALTER TABLE public.billing_accounts
  ADD COLUMN IF NOT EXISTS last_paid_invoice_id text;
ALTER TABLE public.billing_payment_records
  ADD COLUMN IF NOT EXISTS provider_invoice_id text UNIQUE;
