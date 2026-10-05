-- One look per brand (ADR-0032), step 1 of 2: each workspace's default Brand
-- Kit style becomes its look, stored on Brand DNA as dna->'look' (writing tone,
-- image look, video) and edited in Brain → Brand → Look & voice.
--
-- Only adds data: nothing is dropped here, so the app version that still reads
-- brand_styles keeps working. The tables go in
-- 20261012090000_drop_brand_styles.sql, once this version is live.
--
-- Idempotent: a workspace that already has a look is left alone.

DO $$
BEGIN
  IF to_regclass('public.brand_styles') IS NOT NULL THEN
    UPDATE public.workspace_brand_dna d
       SET dna = jsonb_set(
             d.dna,
             '{look}',
             jsonb_strip_nulls(jsonb_build_object(
               'v', 1,
               'writing', s.spec -> 'writing',
               'visual', (s.spec -> 'visual') #- '{typography,files}' #- '{logo,variant}',
               'video', s.spec -> 'video'
             ))
           )
      FROM public.brand_styles s
     WHERE s.workspace_id = d.workspace_id
       AND s.is_default
       AND s.archived_at IS NULL
       AND jsonb_typeof(s.spec) = 'object'
       AND NOT (d.dna ? 'look');
  END IF;
END;
$$;
