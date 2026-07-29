-- 1. Revoke anon access to is_workspace_member
REVOKE EXECUTE ON FUNCTION public.is_workspace_member(uuid, uuid) FROM anon;

-- 2. Audit logs: explicit deny for client INSERT and DELETE
DROP POLICY IF EXISTS audit_no_client_insert ON public.audit_logs;
CREATE POLICY audit_no_client_insert
ON public.audit_logs FOR INSERT TO authenticated, anon
WITH CHECK (false);

DROP POLICY IF EXISTS audit_no_client_delete ON public.audit_logs;
CREATE POLICY audit_no_client_delete
ON public.audit_logs FOR DELETE TO authenticated, anon
USING (false);

-- 3. Approvals: explicit deny for DELETE
DROP POLICY IF EXISTS approvals_no_delete ON public.approvals;
CREATE POLICY approvals_no_delete
ON public.approvals FOR DELETE TO authenticated, anon
USING (false);
