-- Format changes alter the reviewed post just like copy and media changes.
-- Keep the existing lifecycle trigger and all delivery transitions unchanged.
CREATE OR REPLACE FUNCTION public.invalidate_content_kind_approval()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'approved'
     AND NEW.status = OLD.status
     AND OLD.kind IS DISTINCT FROM NEW.kind
  THEN
    NEW.status := 'draft';
  END IF;
  RETURN NEW;
END;
$$;

-- Runs before enforce_content_item_lifecycle, which validates the transition.
DROP TRIGGER IF EXISTS content_items_invalidate_kind_approval ON public.content_items;
CREATE TRIGGER content_items_invalidate_kind_approval
  BEFORE UPDATE OF kind ON public.content_items
  FOR EACH ROW EXECUTE FUNCTION public.invalidate_content_kind_approval();
