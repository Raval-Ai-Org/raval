-- Moving a post to another day on the Content Calendar is planning, not an
-- edit. The calendar keeps the planned day in `meta.calendar_date` /
-- `meta.calendar_time`, and the lifecycle trigger treated any `meta` change as
-- a content change — so dragging an approved post to Thursday silently sent it
-- back to draft and the approval had to be given again.
--
-- Rule now: approval is invalidated when the post itself changes (title, body,
-- hashtags, channel, media, or any other `meta` key) while the status is left
-- unchanged. The two calendar keys are ignored for that comparison only.
-- Transitions are exactly as before. Idempotent.
CREATE OR REPLACE FUNCTION public.enforce_content_item_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'approved'
     AND NEW.status = OLD.status
     AND (
       OLD.title IS DISTINCT FROM NEW.title OR
       OLD.body IS DISTINCT FROM NEW.body OR
       OLD.hashtags IS DISTINCT FROM NEW.hashtags OR
       OLD.channel IS DISTINCT FROM NEW.channel OR
       OLD.media_url IS DISTINCT FROM NEW.media_url OR
       (COALESCE(OLD.meta, '{}'::jsonb) - 'calendar_date' - 'calendar_time')
         IS DISTINCT FROM
       (COALESCE(NEW.meta, '{}'::jsonb) - 'calendar_date' - 'calendar_time')
     )
  THEN
    NEW.status := 'draft';
  END IF;

  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.status = 'draft' AND NEW.status IN ('pending', 'approved')) OR
    (OLD.status = 'pending' AND NEW.status IN ('draft', 'approved', 'rejected', 'failed')) OR
    (OLD.status = 'approved' AND NEW.status IN ('draft', 'scheduled', 'publishing', 'published')) OR
    (OLD.status = 'rejected' AND NEW.status IN ('draft', 'pending')) OR
    (OLD.status = 'scheduled' AND NEW.status IN ('approved', 'draft', 'publishing', 'failed')) OR
    (OLD.status = 'publishing' AND NEW.status IN ('published', 'partial_failed', 'failed')) OR
    (OLD.status = 'published' AND NEW.status = 'draft') OR
    (OLD.status = 'failed' AND NEW.status IN ('draft', 'pending', 'approved')) OR
    (OLD.status = 'partial_failed' AND NEW.status IN ('approved', 'scheduled', 'draft'))
  ) THEN
    RAISE EXCEPTION 'Invalid content status transition: % -> %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_content_item_lifecycle ON public.content_items;
CREATE TRIGGER enforce_content_item_lifecycle
  BEFORE UPDATE ON public.content_items
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_content_item_lifecycle();
