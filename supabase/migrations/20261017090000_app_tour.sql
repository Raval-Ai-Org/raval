-- The app tour: a new person gets a short look around the app, once.
--
-- `profiles.app_tour_seen_at` is per person (not per workspace), so the tour
-- shows once per account on any device. The browser sets it through the
-- existing profiles_update_own policy as soon as the tour opens.
--
-- Accounts that existed before the tour shipped are not new: they are marked
-- as seen here and can open the tour themselves from the account menu. The
-- cutoff is a fixed date, so replaying this migration changes nothing.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS app_tour_seen_at timestamptz;

COMMENT ON COLUMN public.profiles.app_tour_seen_at IS
  'When this person was shown the app tour. NULL = not yet (a new account).';

UPDATE public.profiles
SET app_tour_seen_at = created_at
WHERE app_tour_seen_at IS NULL
  AND created_at < TIMESTAMPTZ '2026-10-10 00:00:00+00';
