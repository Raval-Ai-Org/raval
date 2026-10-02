-- Social trends — what is working on each social platform this month.
--
-- One shared snapshot for the whole product (scope 'global'), collected from
-- recent published coverage by src/server/studio/social-trends.server.ts and
-- refreshed every few days from the existing run-schedules cron hook. Studio,
-- "Write it for me", ideas and Autopilot read it; nothing searches per request.
--
-- It holds no workspace data, so it has no workspace_id. RLS is on with no
-- policies: only the service role (the collector and the server-side readers)
-- can touch it.
--
-- Idempotent and non-destructive: safe to re-run.

CREATE TABLE IF NOT EXISTS public.social_trend_snapshots (
  scope text PRIMARY KEY,
  status text NOT NULL DEFAULT 'idle'
    CHECK (status IN ('idle', 'collecting', 'ready', 'failed')),
  -- Lease for the collector: one refresh at a time, re-claimable if it dies.
  claimed_at timestamptz,
  collected_at timestamptz,
  -- [{platform, kind, title, detail, url}] — every item cites a real source.
  trends jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- [{title, url, publishedDate}] the search returned for that collection.
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.social_trend_snapshots ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.social_trend_snapshots FROM anon, authenticated;
GRANT ALL ON public.social_trend_snapshots TO service_role;

INSERT INTO public.social_trend_snapshots (scope)
VALUES ('global')
ON CONFLICT (scope) DO NOTHING;
