-- Where a person heard about Mellox (ADR-0049): onboarding's last question.
--
-- Per account, asked once: the browser writes it through the existing
-- profiles_update_own policy only while it is still NULL. Attribution only:
-- it never reaches a prompt or a generator. The values match SOURCES in
-- src/lib/onboarding/answers.ts.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS signup_source text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_signup_source_check'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_signup_source_check
      CHECK (signup_source IS NULL OR signup_source IN ('google', 'social', 'friend', 'ai', 'other'));
  END IF;
END $$;

COMMENT ON COLUMN public.profiles.signup_source IS
  'Where this person heard about Mellox (onboarding). NULL = not asked yet.';
