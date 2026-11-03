-- Library hearts (ADR-0038): what a brand's team loved, or wanted less of,
-- so the next posts lean toward it.
--
-- content_reactions  one reaction per piece per workspace (the whole brand
--                    shares it, like memory). `subject_key` is the post's
--                    group id, or the asset id for media that belongs to no
--                    post. `traits` and `caption_sample` are copied by the
--                    server from the stored content and Studio job rows, never
--                    from the browser. `visual_source_id` is the Inspo source
--                    a love created, so un-loving removes only that one.
--
-- Read by members (RLS); written only by the server after an editor check
-- (src/server/fns/taste.ts). Idempotent.

CREATE TABLE IF NOT EXISTS public.content_reactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  subject_key text NOT NULL CHECK (char_length(subject_key) BETWEEN 1 AND 120),
  content_item_id uuid REFERENCES public.content_items(id) ON DELETE CASCADE,
  asset_id uuid REFERENCES public.assets(id) ON DELETE CASCADE,
  reaction text NOT NULL CHECK (reaction IN ('love', 'less')),
  traits jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (pg_column_size(traits) <= 4000),
  caption_sample text NOT NULL DEFAULT '' CHECK (char_length(caption_sample) <= 600),
  visual_source_id uuid REFERENCES public.brand_visual_sources(id) ON DELETE SET NULL,
  set_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_reactions_subject_unique UNIQUE (workspace_id, subject_key),
  CONSTRAINT content_reactions_has_subject CHECK (content_item_id IS NOT NULL OR asset_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS content_reactions_recent_idx
  ON public.content_reactions(workspace_id, updated_at DESC);

ALTER TABLE public.content_reactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.content_reactions FROM anon, authenticated;
GRANT SELECT ON public.content_reactions TO authenticated;
GRANT ALL ON public.content_reactions TO service_role;

DROP POLICY IF EXISTS "Members read reactions" ON public.content_reactions;
CREATE POLICY "Members read reactions"
  ON public.content_reactions FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP TRIGGER IF EXISTS content_reactions_touch ON public.content_reactions;
CREATE TRIGGER content_reactions_touch BEFORE UPDATE ON public.content_reactions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
