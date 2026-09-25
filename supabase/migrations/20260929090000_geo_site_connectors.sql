-- GEO fixes and article publishing on WordPress and Webflow, not only GitHub.
--
--   geo_fix_proposals   provider github | wordpress | webflow. A CMS proposal
--                       carries field-level changes (cms_changes: before/after
--                       per field) instead of files, and the values it replaced
--                       (cms_snapshot) so it can be undone. CMS proposals go
--                       draft → applying → applied → verifying → verified; an
--                       undo sets rolled_back. Only a verification resolves a
--                       finding, exactly as for pull requests.
--   geo_fix_batches     provider widened the same way.
--   geo_agent_runs      provider + site_ref (which CMS object a run changes);
--                       kinds blog_setup (create a blog section) and article.
--   site_blog_settings  where a workspace's articles go on its website.
--   site_publications   one article published to one website, leased like
--                       every other background job (claim_site_publications).
--
-- Members read; the service role writes. Idempotent and non-destructive.

-- ── Proposals & batches: CMS providers ────────────────────────────────────
ALTER TABLE public.geo_fix_proposals DROP CONSTRAINT IF EXISTS geo_fix_proposals_provider_check;
ALTER TABLE public.geo_fix_proposals
  ADD CONSTRAINT geo_fix_proposals_provider_check
  CHECK (provider IN ('github', 'wordpress', 'webflow'));

ALTER TABLE public.geo_fix_proposals DROP CONSTRAINT IF EXISTS geo_fix_proposals_status_check;
ALTER TABLE public.geo_fix_proposals
  ADD CONSTRAINT geo_fix_proposals_status_check CHECK (status IN (
    'draft', 'applying', 'pr_open', 'merged', 'closed', 'verifying',
    'verified', 'not_verified', 'failed', 'discarded', 'stale', 'access_lost',
    'applied', 'rolled_back'
  ));

ALTER TABLE public.geo_fix_proposals ADD COLUMN IF NOT EXISTS cms_changes jsonb;
ALTER TABLE public.geo_fix_proposals ADD COLUMN IF NOT EXISTS cms_snapshot jsonb;
ALTER TABLE public.geo_fix_proposals ADD COLUMN IF NOT EXISTS site_ref jsonb;
ALTER TABLE public.geo_fix_proposals ADD COLUMN IF NOT EXISTS applied_at timestamptz;
ALTER TABLE public.geo_fix_proposals ADD COLUMN IF NOT EXISTS rolled_back_at timestamptz;
ALTER TABLE public.geo_fix_proposals
  ADD COLUMN IF NOT EXISTS rolled_back_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.geo_fix_proposals DROP CONSTRAINT IF EXISTS geo_fix_proposals_cms_shape_check;
ALTER TABLE public.geo_fix_proposals
  ADD CONSTRAINT geo_fix_proposals_cms_shape_check CHECK (
    provider = 'github' OR cms_changes IS NOT NULL
  );

-- One live proposal per finding, now counting a CMS change that is applied
-- but not yet verified.
DROP INDEX IF EXISTS public.geo_fix_proposals_one_live_idx;
CREATE UNIQUE INDEX IF NOT EXISTS geo_fix_proposals_one_live_idx
  ON public.geo_fix_proposals (workspace_id, fingerprint)
  WHERE status IN ('draft', 'applying', 'pr_open', 'merged', 'verifying', 'applied');

ALTER TABLE public.geo_fix_batches DROP CONSTRAINT IF EXISTS geo_fix_batches_provider_check;
ALTER TABLE public.geo_fix_batches
  ADD CONSTRAINT geo_fix_batches_provider_check
  CHECK (provider IN ('github', 'wordpress', 'webflow'));
ALTER TABLE public.geo_fix_batches DROP CONSTRAINT IF EXISTS geo_fix_batches_status_check;
ALTER TABLE public.geo_fix_batches
  ADD CONSTRAINT geo_fix_batches_status_check CHECK (status IN (
    'generating', 'draft', 'applying', 'pr_open', 'merged', 'verifying',
    'completed', 'closed', 'failed', 'discarded', 'stale', 'access_lost', 'applied'
  ));
ALTER TABLE public.geo_fix_batches ADD COLUMN IF NOT EXISTS cms_changes jsonb;
ALTER TABLE public.geo_fix_batches ADD COLUMN IF NOT EXISTS cms_snapshot jsonb;

-- ── Agent runs: provider, CMS target, new kinds ───────────────────────────
ALTER TABLE public.geo_agent_runs ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'github';
ALTER TABLE public.geo_agent_runs ADD COLUMN IF NOT EXISTS site_ref jsonb;
ALTER TABLE public.geo_agent_runs DROP CONSTRAINT IF EXISTS geo_agent_runs_provider_check;
ALTER TABLE public.geo_agent_runs
  ADD CONSTRAINT geo_agent_runs_provider_check
  CHECK (provider IN ('github', 'wordpress', 'webflow'));
ALTER TABLE public.geo_agent_runs DROP CONSTRAINT IF EXISTS geo_agent_runs_kind_check;
ALTER TABLE public.geo_agent_runs
  ADD CONSTRAINT geo_agent_runs_kind_check
  CHECK (kind IN ('finding', 'batch', 'blog_setup', 'article'));

-- ── Connector site facts used to match a CMS site to a scanned host ───────
ALTER TABLE public.webflow_sites ADD COLUMN IF NOT EXISTS domains text[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE public.webflow_sites ADD COLUMN IF NOT EXISTS short_name text;
ALTER TABLE public.wordpress_sites ADD COLUMN IF NOT EXISTS api_namespaces text[] NOT NULL DEFAULT '{}'::text[];
ALTER TABLE public.wordpress_sites ADD COLUMN IF NOT EXISTS plugin_checked_at timestamptz;

-- ── Blog settings ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.site_blog_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  host text NOT NULL,
  provider text NOT NULL,
  status text NOT NULL DEFAULT 'missing',
  status_detail text,
  blog_url text,
  -- WordPress: the posts page and default category.
  wp_posts_page_id bigint,
  wp_category_id bigint,
  -- Webflow: the blog collection and how article parts map to its fields.
  webflow_collection_id text,
  webflow_field_map jsonb,
  -- GitHub: where posts live and how they are written.
  source_id uuid REFERENCES public.workspace_sources(id) ON DELETE SET NULL,
  content_dir text,
  post_format text,
  route_prefix text,
  frontmatter jsonb,
  setup_run_id uuid REFERENCES public.geo_agent_runs(id) ON DELETE SET NULL,
  detected_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_blog_settings_provider_check CHECK (provider IN ('github', 'wordpress', 'webflow')),
  CONSTRAINT site_blog_settings_status_check
    CHECK (status IN ('missing', 'detected', 'creating', 'created', 'needs_design', 'failed')),
  CONSTRAINT site_blog_settings_post_format_check
    CHECK (post_format IS NULL OR post_format IN ('md', 'mdx', 'data_module', 'html')),
  CONSTRAINT site_blog_settings_detail_length
    CHECK (status_detail IS NULL OR char_length(status_detail) <= 1000),
  CONSTRAINT site_blog_settings_workspace_host_unique UNIQUE (workspace_id, host)
);

-- ── Publications ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.site_publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  content_item_id uuid NOT NULL REFERENCES public.content_items(id) ON DELETE CASCADE,
  host text NOT NULL,
  provider text NOT NULL,
  slug text NOT NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'approved',
  status_detail text,
  scheduled_for timestamptz,
  external_id text,
  url text,
  -- GitHub: the pull request that adds the post.
  head_branch text,
  pr_number integer,
  pr_url text,
  -- What was sent (hash) and what the live page showed.
  payload_hash text,
  verification jsonb,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 8,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  locked_by text,
  last_error text,
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  published_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT site_publications_provider_check CHECK (provider IN ('github', 'wordpress', 'webflow')),
  CONSTRAINT site_publications_status_check CHECK (status IN (
    'approved', 'publishing', 'pr_open', 'published', 'verifying', 'verified',
    'needs_attention', 'failed', 'cancelled'
  )),
  CONSTRAINT site_publications_slug_check CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) <= 120),
  CONSTRAINT site_publications_head_branch_check
    CHECK (head_branch IS NULL OR head_branch LIKE 'mellox/%'),
  CONSTRAINT site_publications_error_length CHECK (last_error IS NULL OR char_length(last_error) <= 2000),
  CONSTRAINT site_publications_detail_length
    CHECK (status_detail IS NULL OR char_length(status_detail) <= 1000),
  CONSTRAINT site_publications_item_host_unique UNIQUE (workspace_id, content_item_id, host)
);

CREATE INDEX IF NOT EXISTS site_publications_workspace_idx
  ON public.site_publications (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS site_publications_due_idx
  ON public.site_publications (next_attempt_at)
  WHERE status IN ('approved', 'publishing', 'published', 'verifying');
CREATE INDEX IF NOT EXISTS site_publications_pr_idx
  ON public.site_publications (pr_number) WHERE pr_number IS NOT NULL;

-- ── Row-level security ────────────────────────────────────────────────────
ALTER TABLE public.site_blog_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.site_publications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.site_blog_settings, public.site_publications FROM anon, authenticated;
GRANT SELECT ON public.site_blog_settings, public.site_publications TO authenticated;
GRANT ALL ON public.site_blog_settings, public.site_publications TO service_role;

DROP POLICY IF EXISTS "Workspace members read blog settings" ON public.site_blog_settings;
CREATE POLICY "Workspace members read blog settings"
  ON public.site_blog_settings FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Workspace members read site publications" ON public.site_publications;
CREATE POLICY "Workspace members read site publications"
  ON public.site_publications FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP TRIGGER IF EXISTS site_blog_settings_touch_updated_at ON public.site_blog_settings;
CREATE TRIGGER site_blog_settings_touch_updated_at
  BEFORE UPDATE ON public.site_blog_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS site_publications_touch_updated_at ON public.site_publications;
CREATE TRIGGER site_publications_touch_updated_at
  BEFORE UPDATE ON public.site_publications
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ── Worker lease claim ────────────────────────────────────────────────────
-- Advanced by the existing geo-agents hook; status is changed by the worker
-- (compare-and-set), never here.
CREATE OR REPLACE FUNCTION public.claim_site_publications(
  p_worker text,
  p_max integer DEFAULT 2,
  p_lease_seconds integer DEFAULT 120,
  p_id uuid DEFAULT NULL
)
RETURNS SETOF public.site_publications
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.site_publications AS p
     SET lease_until = now() + make_interval(secs => greatest(p_lease_seconds, 30)),
         locked_by = p_worker,
         attempts = p.attempts + 1
   WHERE p.id IN (
     SELECT s.id
       FROM public.site_publications s
      WHERE s.status IN ('approved', 'publishing', 'published', 'verifying')
        AND (p_id IS NULL OR s.id = p_id)
        AND s.next_attempt_at <= now()
        AND (s.scheduled_for IS NULL OR s.scheduled_for <= now())
        AND (s.lease_until IS NULL OR s.lease_until < now())
        AND s.attempts < s.max_attempts
      ORDER BY s.next_attempt_at
      LIMIT greatest(p_max, 0)
      FOR UPDATE SKIP LOCKED
   )
  RETURNING p.*;
$$;

REVOKE ALL ON FUNCTION public.claim_site_publications(text, integer, integer, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_site_publications(text, integer, integer, uuid)
  TO service_role;

-- ── Realtime: live activity for agent runs and publications ───────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'geo_agent_events'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.geo_agent_events;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'site_publications'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.site_publications;
    END IF;
  END IF;
END;
$$;
