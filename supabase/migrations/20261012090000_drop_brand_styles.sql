-- One look per brand (ADR-0032), step 2 of 2: Brand Styles are removed.
--
-- Run this only after the app version that no longer reads them is live: the
-- previous version selects studio_jobs.style_id and brand_styles.
--
--   1. The columns and guard that pointed at a style are removed.
--   2. brand_styles and brand_kit_assets are dropped. Their uploaded files under
--      workspace/<id>/assets/brand-kit/ are removed by
--      scripts/purge-brand-kit-files.mjs (storage is not reachable from SQL).
--
-- Each workspace's default style was copied to dna->'look' by
-- 20261011090000_brand_look_from_default_style.sql; it runs again here first,
-- so a style made between the two steps is not lost.
--
-- Idempotent: safe to re-run; every step checks what is still there.

-- ── 0. Default style → dna.look (again, for anything made since step 1) ───
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

-- ── 1. Autopilot no longer points at a style ──────────────────────────────
CREATE OR REPLACE FUNCTION private.autopilot_workspace_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec jsonb := to_jsonb(NEW);
  v_ws uuid := (v_rec ->> 'workspace_id')::uuid;
BEGIN
  IF (v_rec ->> 'program_id') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.autopilot_programs
     WHERE id = (v_rec ->> 'program_id')::uuid AND workspace_id = v_ws) THEN
    RAISE EXCEPTION 'autopilot row workspace does not match its program' USING ERRCODE = '23514';
  END IF;
  IF (v_rec ->> 'opportunity_id') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.marketing_opportunities
     WHERE id = (v_rec ->> 'opportunity_id')::uuid AND workspace_id = v_ws) THEN
    RAISE EXCEPTION 'autopilot row workspace does not match its opportunity' USING ERRCODE = '23514';
  END IF;
  IF (v_rec ->> 'action_id') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.autopilot_actions
     WHERE id = (v_rec ->> 'action_id')::uuid AND workspace_id = v_ws) THEN
    RAISE EXCEPTION 'autopilot row workspace does not match its action' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.autopilot_workspace_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS autopilot_programs_workspace_guard ON public.autopilot_programs;
CREATE TRIGGER autopilot_programs_workspace_guard
  BEFORE INSERT OR UPDATE OF workspace_id ON public.autopilot_programs
  FOR EACH ROW EXECUTE FUNCTION private.autopilot_workspace_guard();

ALTER TABLE public.autopilot_programs DROP COLUMN IF EXISTS style_id;
ALTER TABLE public.studio_jobs DROP COLUMN IF EXISTS style_id;
ALTER TABLE public.assets DROP COLUMN IF EXISTS style_id;

-- ── 2. The style tables ───────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.set_default_brand_style(uuid, uuid);
DROP TABLE IF EXISTS public.brand_kit_assets;
DROP TABLE IF EXISTS public.brand_styles;
