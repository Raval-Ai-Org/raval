-- Stories as a first-class content type (ADR-0030, docs/stories.md).
--
--   content_publications.placement  where a delivery went: feed, reels or stories
--   content_publications.frames     a Story's frames, one provider Story per frame:
--                                   [{i, status, postId, platformPostId, permalink, error}]
--   autopilot_programs.stories      Story Autopilot settings (per day, window, mix…)
--   autopilot_programs.posts_per_week  may be 0 when a program only makes Stories
--   brand_styles.applies_to         a Style can apply to Stories
--
-- No new table, no new cron job: Stories are content_items (kind 'story'),
-- delivered through the existing Post for Me pipeline and advanced by the
-- existing run-schedules and sdr-reconcile hooks.
--
-- Idempotent and non-destructive: safe to re-run.

-- ── Deliveries ────────────────────────────────────────────────────────────
ALTER TABLE public.content_publications
  ADD COLUMN IF NOT EXISTS placement text NOT NULL DEFAULT 'feed';
ALTER TABLE public.content_publications
  ADD COLUMN IF NOT EXISTS frames jsonb;

ALTER TABLE public.content_publications
  DROP CONSTRAINT IF EXISTS content_publications_placement_check;
ALTER TABLE public.content_publications
  ADD CONSTRAINT content_publications_placement_check
  CHECK (placement IN ('feed', 'reels', 'stories'));

ALTER TABLE public.content_publications
  DROP CONSTRAINT IF EXISTS content_publications_frames_shape;
ALTER TABLE public.content_publications
  ADD CONSTRAINT content_publications_frames_shape
  CHECK (frames IS NULL OR (jsonb_typeof(frames) = 'array'
    AND jsonb_array_length(frames) BETWEEN 1 AND 20));

-- Hourly Story metrics while a Story is live, and Story analytics per workspace.
CREATE INDEX IF NOT EXISTS content_publications_live_stories_idx
  ON public.content_publications (delivered_at)
  WHERE placement = 'stories' AND status = 'published';
CREATE INDEX IF NOT EXISTS content_publications_workspace_placement_idx
  ON public.content_publications (workspace_id, placement, delivered_at DESC);

-- Rows written before this migration are feed posts, except Reels already
-- delivered as videos to Instagram or Facebook (Post for Me published them
-- there by default). Only rows still at the default are touched.
UPDATE public.content_publications p
   SET placement = 'reels'
  FROM public.content_items c
 WHERE c.id = p.content_item_id
   AND p.placement = 'feed'
   AND p.platform IN ('instagram', 'facebook')
   AND c.kind = 'video';

-- ── Story content ─────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS content_items_workspace_stories_idx
  ON public.content_items (workspace_id, scheduled_at)
  WHERE kind = 'story';

-- ── Story Autopilot ───────────────────────────────────────────────────────
ALTER TABLE public.autopilot_programs
  ADD COLUMN IF NOT EXISTS stories jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.autopilot_programs
  DROP CONSTRAINT IF EXISTS autopilot_programs_stories_shape;
ALTER TABLE public.autopilot_programs
  ADD CONSTRAINT autopilot_programs_stories_shape
  CHECK (jsonb_typeof(stories) = 'object' AND pg_column_size(stories) <= 4000);

ALTER TABLE public.autopilot_programs
  DROP CONSTRAINT IF EXISTS autopilot_programs_pace_check;
ALTER TABLE public.autopilot_programs
  ADD CONSTRAINT autopilot_programs_pace_check CHECK (posts_per_week BETWEEN 0 AND 14);

-- ── Brand Kit Styles ──────────────────────────────────────────────────────
ALTER TABLE public.brand_styles
  DROP CONSTRAINT IF EXISTS brand_styles_applies_to_check;
ALTER TABLE public.brand_styles
  ADD CONSTRAINT brand_styles_applies_to_check CHECK (
    applies_to <@ ARRAY['social','carousel','story','article','script','ad','image','video','ugc']::text[]);
