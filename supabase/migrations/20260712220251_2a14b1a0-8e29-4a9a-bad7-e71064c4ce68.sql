REVOKE EXECUTE ON FUNCTION public.set_persona_once(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.set_persona_once(text) TO authenticated;