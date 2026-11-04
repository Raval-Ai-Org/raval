-- Defense in depth for multi-tenant isolation: the anonymous role gets no
-- table privileges on any table that holds a workspace's rows (plus profiles
-- and workspaces). Row-level security already hid these rows from a signed-out
-- caller, but the early tables still carried Supabase's default grants, so one
-- missing or loosened policy would have exposed a whole table. Idempotent.
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND (
         c.relname IN ('profiles', 'workspaces')
         OR EXISTS (
           SELECT 1 FROM pg_attribute a
            WHERE a.attrelid = c.oid AND a.attname = 'workspace_id' AND NOT a.attisdropped
         )
       )
  LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
  END LOOP;
END
$$;
