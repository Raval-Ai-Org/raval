-- "Upgrade now" before online payments exist.
--
-- An owner who clicks Upgrade now (or buys a pack) while card checkout is not
-- configured creates a purchase request. A Mellox admin collects payment
-- offline, then activates the plan or pack from the admin console. Activation
-- is recorded once per operation id (append-only), so a double click can never
-- grant twice. When Stripe is configured, the same buttons open checkout
-- instead and these tables stay as history.

CREATE TABLE IF NOT EXISTS public.billing_purchase_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.billing_accounts(id) ON DELETE RESTRICT,
  requested_by uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('plan','credit_pack','video_pack','addon')),
  catalog_key text NOT NULL CHECK (length(catalog_key) BETWEEN 1 AND 50),
  billing_interval text CHECK (billing_interval IS NULL OR billing_interval IN ('month','year')),
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 100),
  contact text CHECK (contact IS NULL OR length(contact) <= 120),
  note text CHECK (note IS NULL OR length(note) <= 500),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','declined','canceled')),
  admin_note text CHECK (admin_note IS NULL OR length(admin_note) <= 500),
  handled_by uuid,
  handled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS billing_purchase_requests_status_idx
  ON public.billing_purchase_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS billing_purchase_requests_account_idx
  ON public.billing_purchase_requests (account_id, created_at DESC);
-- One open request per account and item: clicking twice reuses the first.
CREATE UNIQUE INDEX IF NOT EXISTS billing_purchase_requests_one_pending
  ON public.billing_purchase_requests (account_id, kind, catalog_key)
  WHERE status = 'pending';
ALTER TABLE public.billing_purchase_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_purchase_requests FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.billing_purchase_requests TO service_role;

CREATE TABLE IF NOT EXISTS public.billing_manual_activations (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES public.billing_accounts(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('plan','credit_pack','video_pack','end_plan')),
  catalog_key text NOT NULL,
  billing_interval text CHECK (billing_interval IS NULL OR billing_interval IN ('month','year')),
  months integer CHECK (months IS NULL OR months BETWEEN 1 AND 36),
  active_until timestamptz,
  request_id uuid REFERENCES public.billing_purchase_requests(id) ON DELETE RESTRICT,
  reference text CHECK (reference IS NULL OR length(reference) <= 200),
  reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS billing_manual_activations_account_idx
  ON public.billing_manual_activations (account_id, created_at DESC);
ALTER TABLE public.billing_manual_activations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_manual_activations FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.billing_manual_activations TO service_role;
DROP TRIGGER IF EXISTS billing_manual_activations_immutable ON public.billing_manual_activations;
CREATE TRIGGER billing_manual_activations_immutable BEFORE UPDATE OR DELETE
  ON public.billing_manual_activations FOR EACH ROW
  EXECUTE FUNCTION private.guard_billing_admin_adjustment();

-- Teammate "Ask the owner" requests: at most one open request per person and feature.
CREATE UNIQUE INDEX IF NOT EXISTS upgrade_requests_one_open
  ON public.upgrade_requests (account_id, requested_by, feature)
  WHERE status = 'open';
