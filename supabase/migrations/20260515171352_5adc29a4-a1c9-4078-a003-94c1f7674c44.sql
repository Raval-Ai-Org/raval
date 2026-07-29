ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS website_url text,
  ADD COLUMN IF NOT EXISTS first_prompt text,
  ADD COLUMN IF NOT EXISTS industry text,
  ADD COLUMN IF NOT EXISTS audience text,
  ADD COLUMN IF NOT EXISTS goals text,
  ADD COLUMN IF NOT EXISTS connected_provider text,
  ADD COLUMN IF NOT EXISTS onboarded_at timestamptz;