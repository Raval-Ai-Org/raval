-- Inbox DMs: Mox answers private messages people send the brand on Instagram
-- and Messenger, the same way it answers comments.
--
--   engage_comments  + kind ('comment' | 'dm'). A DM row is the newest
--                    unanswered message of one conversation: post_id holds the
--                    conversation id, external_id that message's id, sender_id
--                    the person to answer. Meta's message and conversation ids
--                    carry letters, so a DM row allows them.
--
-- DMs reuse everything comments have: drafts, auto-reply (mox_*), questions,
-- the hourly send cap and the audit. Quick replies never act on a DM.
-- Idempotent and non-destructive.

ALTER TABLE public.engage_comments ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'comment';
ALTER TABLE public.engage_comments DROP CONSTRAINT IF EXISTS engage_comments_kind_check;
ALTER TABLE public.engage_comments ADD CONSTRAINT engage_comments_kind_check
  CHECK (kind IN ('comment', 'dm'));

ALTER TABLE public.engage_comments ADD COLUMN IF NOT EXISTS sender_id text;
ALTER TABLE public.engage_comments DROP CONSTRAINT IF EXISTS engage_comments_sender_id_check;
ALTER TABLE public.engage_comments ADD CONSTRAINT engage_comments_sender_id_check
  CHECK (sender_id IS NULL OR sender_id ~ '^[0-9]{1,40}$');
ALTER TABLE public.engage_comments DROP CONSTRAINT IF EXISTS engage_comments_dm_sender_check;
ALTER TABLE public.engage_comments ADD CONSTRAINT engage_comments_dm_sender_check
  CHECK (kind <> 'dm' OR sender_id IS NOT NULL);

ALTER TABLE public.engage_comments DROP CONSTRAINT IF EXISTS engage_comments_external_id_check;
ALTER TABLE public.engage_comments ADD CONSTRAINT engage_comments_external_id_check
  CHECK (
    external_id ~ '^[0-9_]{1,80}$'
    OR (kind = 'dm' AND external_id ~ '^[A-Za-z0-9_=:.+/-]+$' AND char_length(external_id) <= 300)
  );
ALTER TABLE public.engage_comments DROP CONSTRAINT IF EXISTS engage_comments_post_id_check;
ALTER TABLE public.engage_comments ADD CONSTRAINT engage_comments_post_id_check
  CHECK (
    post_id ~ '^[0-9_]{1,80}$'
    OR (kind = 'dm' AND post_id ~ '^[A-Za-z0-9_=:.+/-]+$' AND char_length(post_id) <= 300)
  );

CREATE INDEX IF NOT EXISTS engage_comments_dm_conversation_idx
  ON public.engage_comments (workspace_id, post_id) WHERE kind = 'dm';
