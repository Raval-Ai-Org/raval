-- Engage, Phase 1: replies to comments on the brand's own Instagram and
-- Facebook posts, with a person's approval (flag FEATURE_FLAG_ENGAGE_ENABLED).
--
--   workspace_connections   'meta' joins the provider check: one Facebook
--                           Login for Business connection per workspace.
--   meta_oauth_credentials  the long-lived user token, encrypted by the
--                           application (META_TOKEN_ENCRYPTION_KEY). Service
--                           role only.
--   meta_pages              the Pages the person granted, each with its
--                           linked Instagram professional account. Members read.
--   meta_page_tokens        each Page's token, encrypted. Service role only.
--   engage_comments         comments read from those posts, the draft Mox
--                           wrote and the reply a person sent. Members read;
--                           every write comes from the server after a role
--                           check. A reply is sent only by a person's click.
--
-- Idempotent and non-destructive.

-- ── Provider ──────────────────────────────────────────────────────────────
ALTER TABLE public.workspace_connections DROP CONSTRAINT IF EXISTS workspace_connections_provider_check;
ALTER TABLE public.workspace_connections ADD CONSTRAINT workspace_connections_provider_check
  CHECK (provider IN ('github','wordpress','webflow','framer','shopify','google','canva','notion','wix','meta'));

CREATE UNIQUE INDEX IF NOT EXISTS workspace_meta_one_active_idx
  ON public.workspace_connections (workspace_id)
  WHERE provider = 'meta' AND status <> 'revoked';

-- ── Credentials (service role only) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.meta_oauth_credentials (
  connection_id uuid PRIMARY KEY REFERENCES public.workspace_connections(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- AES-256-GCM, format v1:iv:tag:ciphertext.
  user_token_enc text NOT NULL,
  user_token_expires_at timestamptz,
  scopes text[] NOT NULL DEFAULT '{}'::text[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.meta_oauth_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_oauth_credentials FROM anon, authenticated;
GRANT ALL ON public.meta_oauth_credentials TO service_role;

-- ── Pages and their Instagram accounts ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.meta_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.workspace_connections(id) ON DELETE CASCADE,
  page_id text NOT NULL CHECK (page_id ~ '^[0-9]{1,32}$'),
  page_name text NOT NULL CHECK (char_length(page_name) <= 200),
  ig_user_id text CHECK (ig_user_id IS NULL OR ig_user_id ~ '^[0-9]{1,32}$'),
  ig_username text CHECK (ig_username IS NULL OR char_length(ig_username) <= 100),
  synced_at timestamptz,
  last_error text CHECK (last_error IS NULL OR char_length(last_error) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meta_pages_unique UNIQUE (workspace_id, page_id)
);

CREATE INDEX IF NOT EXISTS meta_pages_connection_idx ON public.meta_pages (connection_id);

ALTER TABLE public.meta_pages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_pages FROM anon, authenticated;
GRANT SELECT ON public.meta_pages TO authenticated;
GRANT ALL ON public.meta_pages TO service_role;

DROP POLICY IF EXISTS "Members read Meta pages" ON public.meta_pages;
CREATE POLICY "Members read Meta pages"
  ON public.meta_pages FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

CREATE TABLE IF NOT EXISTS public.meta_page_tokens (
  page_row_id uuid PRIMARY KEY REFERENCES public.meta_pages(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  page_token_enc text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.meta_page_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_page_tokens FROM anon, authenticated;
GRANT ALL ON public.meta_page_tokens TO service_role;

-- ── Comments ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.engage_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  page_row_id uuid NOT NULL REFERENCES public.meta_pages(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('instagram', 'facebook')),
  external_id text NOT NULL CHECK (external_id ~ '^[0-9_]{1,80}$'),
  post_id text NOT NULL CHECK (post_id ~ '^[0-9_]{1,80}$'),
  post_caption text CHECK (post_caption IS NULL OR char_length(post_caption) <= 2200),
  post_permalink text CHECK (post_permalink IS NULL OR post_permalink ~ '^https://'),
  author_name text CHECK (author_name IS NULL OR char_length(author_name) <= 200),
  body text NOT NULL CHECK (char_length(body) <= 8000),
  commented_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'drafted', 'sending', 'replied', 'dismissed', 'unknown')),
  draft text CHECK (draft IS NULL OR char_length(draft) <= 8000),
  drafted_at timestamptz,
  reply_text text CHECK (reply_text IS NULL OR char_length(reply_text) <= 8000),
  reply_external_id text,
  replied_at timestamptz,
  replied_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  last_error text CHECK (last_error IS NULL OR char_length(last_error) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT engage_comments_unique UNIQUE (workspace_id, platform, external_id)
);

CREATE INDEX IF NOT EXISTS engage_comments_inbox_idx
  ON public.engage_comments (workspace_id, status, commented_at DESC);

ALTER TABLE public.engage_comments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.engage_comments FROM anon, authenticated;
GRANT SELECT ON public.engage_comments TO authenticated;
GRANT ALL ON public.engage_comments TO service_role;

DROP POLICY IF EXISTS "Members read engage comments" ON public.engage_comments;
CREATE POLICY "Members read engage comments"
  ON public.engage_comments FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

-- ── updated_at ────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS meta_credentials_touch_updated_at ON public.meta_oauth_credentials;
CREATE TRIGGER meta_credentials_touch_updated_at BEFORE UPDATE ON public.meta_oauth_credentials
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS meta_pages_touch_updated_at ON public.meta_pages;
CREATE TRIGGER meta_pages_touch_updated_at BEFORE UPDATE ON public.meta_pages
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS engage_comments_touch_updated_at ON public.engage_comments;
CREATE TRIGGER engage_comments_touch_updated_at BEFORE UPDATE ON public.engage_comments
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
