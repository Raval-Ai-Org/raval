CREATE TABLE IF NOT EXISTS public.billing_provider_health (
  environment text PRIMARY KEY CHECK (environment IN ('sandbox','production')),
  webhook_verified_at timestamptz,
  credential_fingerprint text,
  last_event_id text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.billing_provider_health ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.billing_provider_health FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.billing_provider_health TO service_role;
