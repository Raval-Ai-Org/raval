-- Atomic, idempotent persona setter. First writer wins; concurrent callers
-- get back the persisted value and never overwrite it.
CREATE OR REPLACE FUNCTION public.set_persona_once(_persona text)
RETURNS TABLE(persona text, persona_set_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF _persona IS NULL OR _persona NOT IN ('agency','founder','professional') THEN
    RAISE EXCEPTION 'invalid persona: %', _persona;
  END IF;

  -- Atomic first-writer-wins: only updates when persona is currently NULL.
  -- The row-level lock inside UPDATE serializes concurrent callers on the
  -- same profile row, so a second concurrent request observes the first
  -- write and its WHERE clause matches zero rows.
  UPDATE public.profiles
     SET persona = _persona,
         persona_set_at = now()
   WHERE id = v_uid
     AND persona IS NULL;

  RETURN QUERY
    SELECT p.persona, p.persona_set_at
      FROM public.profiles p
     WHERE p.id = v_uid;
END;
$$;

REVOKE ALL ON FUNCTION public.set_persona_once(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_persona_once(text) TO authenticated;