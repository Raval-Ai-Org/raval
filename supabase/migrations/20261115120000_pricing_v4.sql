-- Pricing v4 (ADR-0050): one credit, three plans, no Free plan.
--
-- Text work is included in every plan, so a Studio job can be billed at 0
-- credits with no meter hold. Its billing link is still written (cancellation,
-- crash recovery and settlement all read it), so the link may have no hold
-- when nothing was charged. A charged job still needs its hold.
--
-- Nothing here touches balances: the credits meter keeps its units and one
-- credit is 30 of them (UNITS_PER_CREDIT), so old balances convert as they are.
ALTER TABLE public.billing_studio_jobs DROP CONSTRAINT IF EXISTS billing_studio_jobs_check;
ALTER TABLE public.billing_studio_jobs DROP CONSTRAINT IF EXISTS billing_studio_jobs_hold_check;
ALTER TABLE public.billing_studio_jobs ADD CONSTRAINT billing_studio_jobs_hold_check
  CHECK (mode <> 'on' OR hold_id IS NOT NULL OR amount = 0);
