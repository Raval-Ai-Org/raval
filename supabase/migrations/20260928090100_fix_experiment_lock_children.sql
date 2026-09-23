-- Proof Engine: corrected assignment/change lock (ADR-0024).
--
-- The first version of private.experiment_lock_children() compared assignment
-- columns directly, which fails with "record new has no field" when the same
-- trigger fires on experiment_changes. It still refused the write, but with
-- the wrong error. This compares rows as jsonb instead. Idempotent.

CREATE OR REPLACE FUNCTION private.experiment_lock_children()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status text;
  v_row jsonb := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
BEGIN
  -- Deletes cascading from a deleted workspace or experiment (depth > 1).
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  SELECT status INTO v_status FROM public.experiments WHERE id = (v_row ->> 'experiment_id')::uuid;
  IF v_status IS NULL OR v_status = 'draft' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  -- Only the exclusion fields and `active` of an assignment may change.
  IF TG_TABLE_NAME = 'experiment_assignments' AND TG_OP = 'UPDATE'
     AND (to_jsonb(NEW) - 'excluded_at' - 'excluded_reason' - 'active')
       = (to_jsonb(OLD) - 'excluded_at' - 'excluded_reason' - 'active') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% is locked after the experiment leaves draft', TG_TABLE_NAME USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION private.experiment_lock_children() FROM PUBLIC, anon, authenticated;
