REVOKE EXECUTE ON FUNCTION public.log_audit(uuid, text, text, jsonb) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.my_workspace_role(uuid) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_audit(uuid, text, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_workspace_role(uuid) TO authenticated, service_role;