REVOKE EXECUTE ON FUNCTION public.is_workspace_member(uuid, uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.is_workspace_member(uuid, uuid) TO authenticated;