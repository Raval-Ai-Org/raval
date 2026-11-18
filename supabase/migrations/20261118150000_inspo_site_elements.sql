-- Inspo → Media "Site art": pictures the site really shows (a mascot, an
-- illustration, a hero object), downloaded once by the website read and kept
-- as the brand's own media. Same table, one more purpose. Idempotent.
ALTER TABLE public.brand_visual_sources
  DROP CONSTRAINT IF EXISTS brand_visual_sources_purpose_check;
ALTER TABLE public.brand_visual_sources
  ADD CONSTRAINT brand_visual_sources_purpose_check
  CHECK (purpose IN ('style','product','person','inspiration','avoid','element'));
