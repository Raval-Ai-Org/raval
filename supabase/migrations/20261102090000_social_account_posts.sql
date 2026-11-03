-- Social analytics without Google: every post on a brand's connected social
-- accounts, with the numbers the network reports, read from Post for Me's
-- account feed (posts made outside Mellox included).
--
-- social_account_posts  one row per post per account. `metrics` holds the
--                       normalised numbers (src/lib/social-insights/normalize.ts);
--                       a number the network doesn't report is absent, never 0.
--                       `content_item_id` is set when Mellox published it.
-- social_accounts.feed_synced_at
--                       when the feed was last read, so the existing
--                       sdr-reconcile sweep reads each account a few times a day.
--
-- Read by members (RLS); written only by the server (service role). Idempotent.

CREATE TABLE IF NOT EXISTS public.social_account_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  social_account_id uuid NOT NULL REFERENCES public.social_accounts(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (char_length(platform) BETWEEN 1 AND 40),
  platform_post_id text NOT NULL CHECK (char_length(platform_post_id) BETWEEN 1 AND 300),
  url text CHECK (url IS NULL OR char_length(url) <= 2000),
  caption text NOT NULL DEFAULT '' CHECK (char_length(caption) <= 600),
  thumbnail_url text CHECK (thumbnail_url IS NULL OR char_length(thumbnail_url) <= 2000),
  format text NOT NULL DEFAULT 'post' CHECK (format IN ('video', 'image', 'text', 'post')),
  posted_at timestamptz,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(metrics) <= 4000),
  content_item_id uuid REFERENCES public.content_items(id) ON DELETE SET NULL,
  provider_post_id text,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT social_account_posts_unique UNIQUE (social_account_id, platform_post_id)
);

CREATE INDEX IF NOT EXISTS social_account_posts_recent_idx
  ON public.social_account_posts(workspace_id, posted_at DESC);

ALTER TABLE public.social_account_posts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.social_account_posts FROM anon, authenticated;
GRANT SELECT ON public.social_account_posts TO authenticated;
GRANT ALL ON public.social_account_posts TO service_role;

DROP POLICY IF EXISTS "Members read social posts" ON public.social_account_posts;
CREATE POLICY "Members read social posts"
  ON public.social_account_posts FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

ALTER TABLE public.social_accounts ADD COLUMN IF NOT EXISTS feed_synced_at timestamptz;
