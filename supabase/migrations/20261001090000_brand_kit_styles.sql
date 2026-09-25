-- Brand Kit and Styles.
--
-- A Style is a named, reusable recipe for how content looks and reads: writing
-- style, palette, fonts, layout, image and video look, plus the inspiration
-- posts it was learned from. Brand DNA (workspace_brand_dna) stays the source of
-- facts about the brand; a Style can inherit its colours, fonts, voice, logo and
-- rules from Brand DNA field by field (see src/lib/brand-kit/resolve.ts).
--
-- The Brand Kit is the workspace library the Styles draw on: logos, font files,
-- elements, inspiration images and videos, writing samples. Files live in the
-- generated-assets bucket under workspace/<id>/assets/brand-kit/.
--
-- Members read (RLS); only the server writes, after a role check
-- (src/server/fns/brand-kit.ts). Idempotent — safe to re-run.

CREATE TABLE IF NOT EXISTS public.brand_styles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  applies_to text[] NOT NULL DEFAULT '{}',
  is_default boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'draft',
  spec jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  cover_asset_id uuid,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT brand_styles_name_length CHECK (char_length(name) BETWEEN 1 AND 80),
  CONSTRAINT brand_styles_description_length CHECK (
    description IS NULL OR char_length(description) <= 400),
  CONSTRAINT brand_styles_status_check CHECK (status IN ('draft', 'analyzing', 'ready')),
  CONSTRAINT brand_styles_applies_to_check CHECK (
    applies_to <@ ARRAY['social','carousel','article','script','ad','image','video','ugc']::text[]),
  CONSTRAINT brand_styles_spec_size CHECK (pg_column_size(spec) <= 200000),
  -- An archived style can never be the default.
  CONSTRAINT brand_styles_default_not_archived CHECK (NOT (is_default AND archived_at IS NOT NULL))
);

-- At most one default style per workspace.
CREATE UNIQUE INDEX IF NOT EXISTS brand_styles_one_default_idx
  ON public.brand_styles (workspace_id) WHERE is_default;
CREATE INDEX IF NOT EXISTS brand_styles_workspace_idx
  ON public.brand_styles (workspace_id, archived_at, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.brand_kit_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- NULL = shared workspace library; otherwise attached to one style.
  style_id uuid REFERENCES public.brand_styles(id) ON DELETE SET NULL,
  kind text NOT NULL,
  label text,
  tags text[] NOT NULL DEFAULT '{}',
  storage_path text,
  -- Still frames of an inspiration video (same folder as storage_path).
  frame_paths text[] NOT NULL DEFAULT '{}',
  text_content text,
  source_url text,
  mime text,
  bytes integer,
  width integer,
  height integer,
  analysis jsonb,
  analysis_status text NOT NULL DEFAULT 'none',
  analysis_error text,
  analysis_started_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT brand_kit_assets_kind_check CHECK (kind IN (
    'logo', 'logo_dark', 'logo_mark', 'font_file', 'element', 'pattern',
    'product_photo', 'inspiration_image', 'inspiration_video', 'writing_sample')),
  CONSTRAINT brand_kit_assets_analysis_status_check CHECK (
    analysis_status IN ('none', 'pending', 'running', 'done', 'failed')),
  CONSTRAINT brand_kit_assets_path_check CHECK (
    storage_path IS NULL OR (
      storage_path LIKE 'workspace/' || workspace_id::text || '/assets/brand-kit/%'
      AND storage_path !~ '\.\.'
      AND storage_path !~ '//'
      AND char_length(storage_path) <= 300)),
  CONSTRAINT brand_kit_assets_frames_check CHECK (cardinality(frame_paths) <= 6),
  CONSTRAINT brand_kit_assets_has_content CHECK (
    storage_path IS NOT NULL OR text_content IS NOT NULL),
  CONSTRAINT brand_kit_assets_text_length CHECK (
    text_content IS NULL OR char_length(text_content) <= 20000),
  CONSTRAINT brand_kit_assets_label_length CHECK (label IS NULL OR char_length(label) <= 120)
);

CREATE INDEX IF NOT EXISTS brand_kit_assets_workspace_idx
  ON public.brand_kit_assets (workspace_id, kind, created_at DESC);
CREATE INDEX IF NOT EXISTS brand_kit_assets_style_idx
  ON public.brand_kit_assets (style_id) WHERE style_id IS NOT NULL;

-- ── Row-level security: members read, only the service role writes ───────
ALTER TABLE public.brand_styles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.brand_kit_assets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.brand_styles FROM anon, authenticated;
REVOKE ALL ON public.brand_kit_assets FROM anon, authenticated;
GRANT SELECT ON public.brand_styles TO authenticated;
GRANT SELECT ON public.brand_kit_assets TO authenticated;
GRANT ALL ON public.brand_styles TO service_role;
GRANT ALL ON public.brand_kit_assets TO service_role;

DROP POLICY IF EXISTS "Members read brand styles" ON public.brand_styles;
CREATE POLICY "Members read brand styles"
  ON public.brand_styles FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Members read brand kit assets" ON public.brand_kit_assets;
CREATE POLICY "Members read brand kit assets"
  ON public.brand_kit_assets FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

-- ── updated_at ────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS brand_styles_touch_updated_at ON public.brand_styles;
CREATE TRIGGER brand_styles_touch_updated_at
  BEFORE UPDATE ON public.brand_styles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS brand_kit_assets_touch_updated_at ON public.brand_kit_assets;
CREATE TRIGGER brand_kit_assets_touch_updated_at
  BEFORE UPDATE ON public.brand_kit_assets
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ── Set the default style atomically ─────────────────────────────────────
-- Clears the old default and sets the new one in one statement pair inside a
-- function, so the partial unique index never sees two defaults. Passing NULL
-- clears the default (generation then uses Brand DNA alone).
CREATE OR REPLACE FUNCTION public.set_default_brand_style(p_workspace_id uuid, p_style_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_style_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.brand_styles
    WHERE id = p_style_id AND workspace_id = p_workspace_id AND archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'style not found in workspace' USING ERRCODE = 'P0002';
  END IF;
  UPDATE public.brand_styles SET is_default = false
    WHERE workspace_id = p_workspace_id AND is_default AND id IS DISTINCT FROM p_style_id;
  IF p_style_id IS NOT NULL THEN
    UPDATE public.brand_styles SET is_default = true WHERE id = p_style_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_default_brand_style(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_default_brand_style(uuid, uuid) TO service_role;

-- ── Which style made a piece of content ──────────────────────────────────
ALTER TABLE public.studio_jobs
  ADD COLUMN IF NOT EXISTS style_id uuid REFERENCES public.brand_styles(id) ON DELETE SET NULL;
ALTER TABLE public.assets
  ADD COLUMN IF NOT EXISTS style_id uuid REFERENCES public.brand_styles(id) ON DELETE SET NULL;
