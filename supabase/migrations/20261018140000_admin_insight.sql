-- Mellox admin panel, phases 4, 5 and 7 (read side): analytics, integration
-- state and a universal lookup.
--
-- Read-only, service-role only, over rows that already exist. Nothing here
-- selects a credential column: integration views name their columns, and
-- free-text fields are truncated.

/* ───────────────────────────── analytics ───────────────────────────── */

-- "Active" here means a person who used an AI feature (ai_usage_events), or who
-- signed in; the page labels each figure with what it counts, because the
-- platform stores no general page-view history.
CREATE OR REPLACE FUNCTION public.admin_analytics(p_days int)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH win AS (
    SELECT least(greatest(coalesce(p_days, 30), 7), 90) AS days
  ),
  cohort AS (
    SELECT u.id FROM auth.users u, win
    WHERE u.created_at >= now() - make_interval(days => win.days)
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'days', (SELECT days FROM win),
    'signups_by_day', coalesce((
      SELECT jsonb_agg(d ORDER BY d.day) FROM (
        SELECT (u.created_at AT TIME ZONE 'UTC')::date AS day, count(*) AS signups
        FROM auth.users u, win
        WHERE u.created_at >= now() - make_interval(days => win.days)
        GROUP BY 1) d), '[]'::jsonb),
    'ai_active', jsonb_build_object(
      'day',   (SELECT count(DISTINCT user_id) FROM public.ai_usage_events WHERE created_at >= now() - interval '1 day'),
      'week',  (SELECT count(DISTINCT user_id) FROM public.ai_usage_events WHERE created_at >= now() - interval '7 days'),
      'month', (SELECT count(DISTINCT user_id) FROM public.ai_usage_events WHERE created_at >= now() - interval '30 days')),
    'signed_in', jsonb_build_object(
      'day',   (SELECT count(*) FROM auth.users WHERE last_sign_in_at >= now() - interval '1 day'),
      'week',  (SELECT count(*) FROM auth.users WHERE last_sign_in_at >= now() - interval '7 days'),
      'month', (SELECT count(*) FROM auth.users WHERE last_sign_in_at >= now() - interval '30 days')),
    'funnel', jsonb_build_object(
      'signed_up',    (SELECT count(*) FROM cohort),
      'has_workspace', (SELECT count(*) FROM cohort c WHERE EXISTS (
                          SELECT 1 FROM public.workspace_members m WHERE m.user_id = c.id)),
      'used_ai',      (SELECT count(*) FROM cohort c WHERE EXISTS (
                          SELECT 1 FROM public.ai_usage_events e WHERE e.user_id = c.id)),
      'paying',       (SELECT count(*) FROM cohort c WHERE EXISTS (
                          SELECT 1 FROM public.billing_accounts b
                          WHERE b.owner_user_id = c.id AND b.plan_id NOT IN ('free', 'paused')
                            AND b.status IN ('active', 'trialing', 'past_due')))),
    'plans', coalesce((
      SELECT jsonb_agg(p ORDER BY p.accounts DESC) FROM (
        SELECT plan_id, status, count(*) AS accounts
        FROM public.billing_accounts GROUP BY plan_id, status) p), '[]'::jsonb),
    'adoption', coalesce((
      SELECT jsonb_agg(a ORDER BY a.workspaces DESC) FROM (
        SELECT e.kind, count(DISTINCT e.workspace_id) AS workspaces, count(DISTINCT e.user_id) AS users
        FROM public.ai_usage_events e, win
        WHERE e.created_at >= now() - make_interval(days => win.days)
          AND e.workspace_id IS NOT NULL
        GROUP BY e.kind) a), '[]'::jsonb)
  );
$$;

/* ───────────────────────────── integrations ───────────────────────────── */

CREATE OR REPLACE FUNCTION public.admin_integrations()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'generated_at', now(),
    'social', coalesce((
      SELECT jsonb_agg(s ORDER BY s.accounts DESC) FROM (
        SELECT platform, status, count(*) AS accounts
        FROM public.social_accounts WHERE disconnected_at IS NULL
        GROUP BY platform, status) s), '[]'::jsonb),
    'connections', coalesce((
      SELECT jsonb_agg(c ORDER BY c.connections DESC) FROM (
        SELECT provider, status, count(*) AS connections
        FROM public.workspace_connections WHERE revoked_at IS NULL
        GROUP BY provider, status) c), '[]'::jsonb),
    'problems', coalesce((
      SELECT jsonb_agg(p ORDER BY p.at DESC) FROM (
        SELECT * FROM (
          SELECT 'social'::text AS source, s.platform AS provider, s.status,
                 s.workspace_id, left(coalesce(s.reconnect_reason, ''), 200) AS message,
                 s.updated_at AS at
          FROM public.social_accounts s
          WHERE s.disconnected_at IS NULL AND s.status <> 'active'
          UNION ALL
          SELECT 'connection', w.provider, w.status, w.workspace_id,
                 left(coalesce(w.last_error, ''), 200), w.updated_at
          FROM public.workspace_connections w
          WHERE w.revoked_at IS NULL AND w.last_error IS NOT NULL
        ) u ORDER BY u.at DESC LIMIT 25) p), '[]'::jsonb)
  );
$$;

/* ───────────────────────────── lookup ───────────────────────────── */

-- One box for support: an id (user, workspace or Studio job) or a fragment of
-- an email, name, workspace name or domain. Uses position(), not LIKE, so
-- "%" and "_" are plain characters. Matching on email is only for admins who may
-- see emails, so a search can't be used to confirm an address by guessing.
CREATE OR REPLACE FUNCTION public.admin_lookup(p_query text, p_match_email boolean)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH q AS (SELECT lower(btrim(coalesce(p_query, ''))) AS t)
  SELECT CASE WHEN char_length((SELECT t FROM q)) < 3 THEN
    jsonb_build_object('users', '[]'::jsonb, 'workspaces', '[]'::jsonb, 'jobs', '[]'::jsonb)
  ELSE jsonb_build_object(
    'users', coalesce((
      SELECT jsonb_agg(u) FROM (
        SELECT a.id, a.email, p.name, a.created_at
        FROM auth.users a LEFT JOIN public.profiles p ON p.id = a.id, q
        WHERE a.id::text = q.t
           OR (p_match_email AND position(q.t IN lower(coalesce(a.email, ''))) > 0)
           OR position(q.t IN lower(coalesce(p.name, ''))) > 0
        ORDER BY a.created_at DESC LIMIT 10) u), '[]'::jsonb),
    'workspaces', coalesce((
      SELECT jsonb_agg(w) FROM (
        SELECT x.id, x.name, x.domain, x.created_at
        FROM public.workspaces x, q
        WHERE x.id::text = q.t
           OR position(q.t IN lower(coalesce(x.name, ''))) > 0
           OR position(q.t IN lower(coalesce(x.domain, ''))) > 0
        ORDER BY x.created_at DESC LIMIT 10) w), '[]'::jsonb),
    'jobs', coalesce((
      SELECT jsonb_agg(j) FROM (
        SELECT s.id, s.type, s.status, s.workspace_id, s.updated_at
        FROM public.studio_jobs s, q
        WHERE s.id::text = q.t
        LIMIT 5) j), '[]'::jsonb))
  END;
$$;

REVOKE ALL ON FUNCTION
  public.admin_analytics(int),
  public.admin_integrations(),
  public.admin_lookup(text, boolean)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.admin_analytics(int),
  public.admin_integrations(),
  public.admin_lookup(text, boolean)
  TO service_role;
