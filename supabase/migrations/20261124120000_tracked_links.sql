-- Tracked links (Round 9, flag FEATURE_FLAG_TRACKED_LINKS_ENABLED).
--
-- A link to the brand's own site in a Studio caption is swapped for a short
-- Mellox link (/l/<slug>) when the draft is written, on networks where links
-- can be clicked. Opening it counts one click and sends the person on to the
-- exact page. Goals show the count as measured ("Clicks on your links").
--
-- Members read their workspace's rows. Only the service role writes: rows are
-- made by the Studio runner and a click is counted by
-- `track_link_click(slug)`, called from the public /l route. Idempotent.

CREATE TABLE IF NOT EXISTS public.tracked_links (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  slug            text NOT NULL
    CONSTRAINT tracked_links_slug_format CHECK (slug ~ '^[A-Za-z0-9]{6,16}$'),
  target_url      text NOT NULL
    CONSTRAINT tracked_links_target_https CHECK (target_url ~ '^https://' AND char_length(target_url) <= 2000),
  job_id          uuid,
  platform        text,
  clicks          integer NOT NULL DEFAULT 0 CHECK (clicks >= 0),
  last_clicked_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS tracked_links_slug_key ON public.tracked_links (slug);
CREATE INDEX IF NOT EXISTS tracked_links_workspace_idx
  ON public.tracked_links (workspace_id, created_at DESC);

ALTER TABLE public.tracked_links ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tracked_links FROM anon, authenticated;
GRANT SELECT ON public.tracked_links TO authenticated;
GRANT ALL ON public.tracked_links TO service_role;

DROP POLICY IF EXISTS "Members read tracked links" ON public.tracked_links;
CREATE POLICY "Members read tracked links"
  ON public.tracked_links FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

-- One click: count it and answer where to go. Unknown slug → no row.
CREATE OR REPLACE FUNCTION public.track_link_click(p_slug text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE target text;
BEGIN
  IF p_slug IS NULL OR p_slug !~ '^[A-Za-z0-9]{6,16}$' THEN RETURN NULL; END IF;
  UPDATE public.tracked_links
     SET clicks = clicks + 1, last_clicked_at = now()
   WHERE slug = p_slug
   RETURNING target_url INTO target;
  RETURN target;
END $$;
REVOKE ALL ON FUNCTION public.track_link_click(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.track_link_click(text) TO service_role;

-- Where to go without counting (a link preview bot, a crawler).
CREATE OR REPLACE FUNCTION public.tracked_link_target(p_slug text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT target_url FROM public.tracked_links
   WHERE p_slug ~ '^[A-Za-z0-9]{6,16}$' AND slug = p_slug;
$$;
REVOKE ALL ON FUNCTION public.tracked_link_target(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tracked_link_target(text) TO service_role;
