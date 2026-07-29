CREATE TYPE public.client_status AS ENUM ('active', 'onboarding', 'paused');

ALTER TABLE public.workspaces
  ADD COLUMN client_status public.client_status NOT NULL DEFAULT 'onboarding';

-- Mark existing workspaces that completed onboarding as active
UPDATE public.workspaces SET client_status = 'active' WHERE onboarded_at IS NOT NULL;