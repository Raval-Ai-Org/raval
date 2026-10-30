-- Campaign notices (ADR-0039): a campaign's pieces are made and wait for a
-- person whether or not Autopilot is on, so the person who started the
-- campaign is emailed when posts wait for their OK, at most once a day per
-- campaign. `last_notified_at` is the claim, compare-and-set by the sender
-- (src/server/campaigns/notify.server.ts). Idempotent.

ALTER TABLE public.workspace_campaigns
  ADD COLUMN IF NOT EXISTS last_notified_at timestamptz;
