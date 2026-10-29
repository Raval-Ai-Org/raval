-- Adding a blog to a GitHub-built site (src/server/articles/blog-setup.server.ts).
--
-- site_blog_settings.setup holds how far that has got: the framework Mellox can
-- add a blog to, and the branch and pull request it opened. Members read; only
-- the service role writes (unchanged). Idempotent and non-destructive.

ALTER TABLE public.site_blog_settings ADD COLUMN IF NOT EXISTS setup jsonb;

ALTER TABLE public.site_blog_settings DROP CONSTRAINT IF EXISTS site_blog_settings_setup_shape;
ALTER TABLE public.site_blog_settings
  ADD CONSTRAINT site_blog_settings_setup_shape
  CHECK (setup IS NULL OR (jsonb_typeof(setup) = 'object' AND pg_column_size(setup) <= 4096));
