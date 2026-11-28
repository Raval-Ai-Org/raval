-- 20261128120000_engage_dm_id_check.sql
-- The DM id checks used `{1,300}`, past Postgres' largest regex repeat (255),
-- so every Messenger and Instagram DM insert failed. Same rule, length checked
-- with char_length instead.

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
