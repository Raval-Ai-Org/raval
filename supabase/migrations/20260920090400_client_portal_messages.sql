-- Extend the existing client event stream into a persisted two-way inbox.
-- Client feedback remains on client_events so existing approval workflows and
-- workspace RLS continue to apply; no parallel messaging table is needed.
ALTER TABLE public.client_events
  ADD COLUMN IF NOT EXISTS actor_type text NOT NULL DEFAULT 'client'
    CHECK (actor_type IN ('client', 'team')),
  ADD COLUMN IF NOT EXISTS marketer_read_at timestamptz,
  ADD COLUMN IF NOT EXISTS client_read_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_client_events_unread_marketer
  ON public.client_events(share_id, marketer_read_at, created_at DESC)
  WHERE actor_type = 'client';

CREATE INDEX IF NOT EXISTS idx_client_events_unread_client
  ON public.client_events(share_id, client_read_at, created_at DESC)
  WHERE actor_type = 'team';