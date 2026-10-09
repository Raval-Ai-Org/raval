-- Resolve an invitee once, then use indexed membership checks. Only the
-- service role may call this function; it must not expose the auth directory.
CREATE OR REPLACE FUNCTION public.auth_user_id_for_email(p_email text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT id
  FROM auth.users
  WHERE lower(email) = lower(p_email)
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.auth_user_id_for_email(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auth_user_id_for_email(text) TO service_role;

CREATE OR REPLACE FUNCTION public.account_has_billable_member(p_account uuid, p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspace_members m
    JOIN public.workspaces w ON w.id = m.workspace_id
    WHERE w.billing_account_id = p_account
      AND m.user_id = p_user
      AND m.role IN ('owner', 'admin', 'editor')
  );
$$;

REVOKE ALL ON FUNCTION public.account_has_billable_member(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_has_billable_member(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.account_billable_seat_count(p_account uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT (1 + count(DISTINCT m.user_id))::integer
  FROM public.billing_accounts a
  LEFT JOIN public.workspaces w
    ON w.billing_account_id = a.id AND w.duplicate_of IS NULL
  LEFT JOIN public.workspace_members m
    ON m.workspace_id = w.id
   AND m.user_id <> a.owner_user_id
   AND m.role IN ('owner', 'admin', 'editor')
  WHERE a.id = p_account;
$$;

REVOKE ALL ON FUNCTION public.account_billable_seat_count(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_billable_seat_count(uuid) TO service_role;

-- Keep page assembly next to the data. This avoids an auth-admin request for
-- every visible member and returns an exact count even for an empty last page.
CREATE OR REPLACE FUNCTION public.workspace_members_page(
  p_workspace uuid,
  p_offset integer,
  p_limit integer
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_offset < 0 OR p_limit < 1 OR p_limit > 50 THEN
    RAISE EXCEPTION 'invalid member page';
  END IF;

  RETURN (
    WITH page_rows AS (
      SELECT m.user_id, m.role::text AS role, m.created_at AS joined_at,
             p.name, p.avatar_url, lower(u.email) AS email
      FROM public.workspace_members m
      LEFT JOIN public.profiles p ON p.id = m.user_id
      LEFT JOIN auth.users u ON u.id = m.user_id
      WHERE m.workspace_id = p_workspace
      ORDER BY m.created_at, m.user_id
      LIMIT p_limit OFFSET p_offset
    )
    SELECT jsonb_build_object(
      'members', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
          'user_id', r.user_id,
          'role', r.role,
          'joined_at', r.joined_at,
          'name', r.name,
          'avatar_url', r.avatar_url,
          'email', r.email
        ) ORDER BY r.joined_at, r.user_id)
        FROM page_rows r
      ), '[]'::jsonb),
      'total', (SELECT count(*) FROM public.workspace_members WHERE workspace_id = p_workspace)
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.workspace_members_page(uuid, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_members_page(uuid, integer, integer)
  TO service_role;

-- auth.users belongs to Supabase. On a hosted project the migration role does
-- not own it and may not index it; failing here would roll back everything
-- above. The lookup is correct without the index (auth already indexes
-- lower(email) per instance), so a refusal is noted and skipped.
DO $$
BEGIN
  CREATE INDEX IF NOT EXISTS auth_users_email_lower_lookup_idx
    ON auth.users (lower(email));
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'auth.users is not ours to index here; skipped auth_users_email_lower_lookup_idx';
END
$$;

CREATE INDEX IF NOT EXISTS workspace_members_listing_idx
  ON public.workspace_members (workspace_id, created_at, user_id);

CREATE INDEX IF NOT EXISTS workspace_invites_pending_listing_idx
  ON public.workspace_invites (workspace_id, created_at DESC, id DESC)
  WHERE accepted_at IS NULL;
