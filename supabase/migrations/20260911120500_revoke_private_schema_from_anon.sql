-- 20260620101957 granted USAGE on schema private and EXECUTE on
-- private.is_workspace_member to anon. Later migrations only revoked FROM
-- PUBLIC, never FROM anon, so an anonymous caller could still probe workspace
-- membership by (workspace_id, user_id) pairs. Every policy that calls the
-- helper is scoped TO authenticated, so anon never needs it.
REVOKE EXECUTE ON FUNCTION private.is_workspace_member(uuid, uuid) FROM anon;
REVOKE USAGE ON SCHEMA private FROM anon;
