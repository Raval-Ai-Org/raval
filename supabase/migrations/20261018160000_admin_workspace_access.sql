-- Mellox admin panel: workspace suspension / read-only mode and read-only
-- support views ("view-only impersonation").
--
-- Access state lives in its OWN table, not on public.workspaces: a workspace
-- owner can update their own workspace row, and must never be able to lift a
-- suspension by writing a column. This table has RLS on and no policy, so only
-- the service role (the app's request path and the admin functions) reads it.
--
-- Support views do not mint a token and never act as the customer. A session is
-- a short, audited permission for one admin to read an allow-listed snapshot of
-- one workspace; it cannot write anything by construction (the only function
-- that reads it is STABLE-style read-only, and nothing here writes workspace
-- data). Same rules as the other admin migrations: change + audit in one
-- transaction, service-role only, idempotent.

CREATE TABLE IF NOT EXISTS public.workspace_access_state (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces (id) ON DELETE CASCADE,
  mode         text NOT NULL
    CONSTRAINT workspace_access_state_mode_check CHECK (mode IN ('read_only', 'suspended')),
  reason       text CONSTRAINT workspace_access_state_reason_len CHECK (reason IS NULL OR char_length(reason) <= 500),
  changed_by   uuid,
  changed_at   timestamptz NOT NULL DEFAULT now()
);

-- A workspace with no row is active.
ALTER TABLE public.workspace_access_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_access_state FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.workspace_access_state TO service_role;

CREATE TABLE IF NOT EXISTS public.admin_view_sessions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL,
  workspace_id  uuid NOT NULL REFERENCES public.workspaces (id) ON DELETE CASCADE,
  reason        text NOT NULL CONSTRAINT admin_view_sessions_reason_len CHECK (char_length(reason) BETWEEN 10 AND 500),
  started_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  ended_at      timestamptz
);

CREATE INDEX IF NOT EXISTS admin_view_sessions_admin_idx
  ON public.admin_view_sessions (admin_user_id, started_at DESC);

ALTER TABLE public.admin_view_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_view_sessions FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.admin_view_sessions TO service_role;

/* ─────────────────────── suspension / read-only ─────────────────────── */

-- p_mode 'active' removes the restriction.
CREATE OR REPLACE FUNCTION public.admin_workspace_set_access(
  p_actor uuid,
  p_actor_role text,
  p_workspace uuid,
  p_mode text,
  p_reason text,
  p_request_id text,
  p_ip text,
  p_user_agent text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_before text;
BEGIN
  IF char_length(btrim(coalesce(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'A reason of at least 10 characters is required.' USING ERRCODE = '22023';
  END IF;
  IF p_mode NOT IN ('active', 'read_only', 'suspended') THEN
    RAISE EXCEPTION 'Unknown mode.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspaces WHERE id = p_workspace) THEN
    RAISE EXCEPTION 'No such workspace.' USING ERRCODE = 'P0002';
  END IF;

  SELECT mode INTO v_before FROM public.workspace_access_state WHERE workspace_id = p_workspace FOR UPDATE;

  IF p_mode = 'active' THEN
    DELETE FROM public.workspace_access_state WHERE workspace_id = p_workspace;
  ELSE
    INSERT INTO public.workspace_access_state (workspace_id, mode, reason, changed_by)
      VALUES (p_workspace, p_mode, btrim(p_reason), p_actor)
    ON CONFLICT (workspace_id) DO UPDATE SET
      mode = excluded.mode, reason = excluded.reason,
      changed_by = excluded.changed_by, changed_at = now();
  END IF;

  PERFORM private.admin_audit_write(
    p_actor, p_actor_role, 'workspace.access_' || p_mode, 'workspace', p_workspace::text, p_workspace,
    jsonb_build_object('mode', coalesce(v_before, 'active')), jsonb_build_object('mode', p_mode),
    p_reason, p_request_id, p_ip, p_user_agent);

  RETURN jsonb_build_object('workspace_id', p_workspace, 'mode', p_mode);
END;
$$;

/* ───────────────────────────── support views ───────────────────────────── */

-- One active view per admin: starting a new one ends the previous. Thirty
-- minutes at most; the reason is stored and audited.
CREATE OR REPLACE FUNCTION public.admin_view_start(
  p_actor uuid,
  p_actor_role text,
  p_workspace uuid,
  p_reason text,
  p_request_id text,
  p_ip text,
  p_user_agent text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.admin_view_sessions%ROWTYPE;
BEGIN
  IF char_length(btrim(coalesce(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'A reason of at least 10 characters is required.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspaces WHERE id = p_workspace) THEN
    RAISE EXCEPTION 'No such workspace.' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.admin_view_sessions SET ended_at = now()
   WHERE admin_user_id = p_actor AND ended_at IS NULL;

  INSERT INTO public.admin_view_sessions (admin_user_id, workspace_id, reason, expires_at)
    VALUES (p_actor, p_workspace, btrim(p_reason), now() + interval '30 minutes')
    RETURNING * INTO v_session;

  PERFORM private.admin_audit_write(
    p_actor, p_actor_role, 'support_view.started', 'workspace', p_workspace::text, p_workspace,
    NULL, jsonb_build_object('session_id', v_session.id, 'expires_at', v_session.expires_at),
    p_reason, p_request_id, p_ip, p_user_agent);

  RETURN jsonb_build_object('session_id', v_session.id, 'workspace_id', p_workspace,
                            'expires_at', v_session.expires_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_view_end(
  p_actor uuid,
  p_actor_role text,
  p_session uuid,
  p_request_id text,
  p_ip text,
  p_user_agent text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workspace uuid;
BEGIN
  UPDATE public.admin_view_sessions SET ended_at = now()
   WHERE id = p_session AND admin_user_id = p_actor AND ended_at IS NULL
   RETURNING workspace_id INTO v_workspace;
  IF v_workspace IS NULL THEN
    RETURN jsonb_build_object('ended', false);
  END IF;
  PERFORM private.admin_audit_write(
    p_actor, p_actor_role, 'support_view.ended', 'workspace', v_workspace::text, v_workspace,
    NULL, jsonb_build_object('session_id', p_session),
    NULL, p_request_id, p_ip, p_user_agent);
  RETURN jsonb_build_object('ended', true);
END;
$$;

-- The read. Checks the session belongs to this admin and is live, writes an
-- audit row for EVERY read, and returns an allow-listed snapshot. It never
-- returns message or post bodies, brand DNA, credentials, tokens, payment or
-- billing detail beyond the plan name.
CREATE OR REPLACE FUNCTION public.admin_view_read(
  p_actor uuid,
  p_actor_role text,
  p_session uuid,
  p_section text,
  p_request_id text,
  p_ip text,
  p_user_agent text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_session public.admin_view_sessions%ROWTYPE;
  v_ws uuid;
  v_out jsonb;
BEGIN
  SELECT * INTO v_session FROM public.admin_view_sessions
   WHERE id = p_session AND admin_user_id = p_actor;
  IF NOT FOUND OR v_session.ended_at IS NOT NULL OR v_session.expires_at <= now() THEN
    RAISE EXCEPTION 'This support view has ended.' USING ERRCODE = '42501';
  END IF;
  IF p_section NOT IN ('overview', 'content', 'accounts', 'jobs') THEN
    RAISE EXCEPTION 'Unknown section.' USING ERRCODE = '22023';
  END IF;
  v_ws := v_session.workspace_id;

  IF p_section = 'overview' THEN
    v_out := jsonb_build_object(
      'workspace', (SELECT jsonb_build_object(
          'name', w.name, 'domain', w.domain, 'industry', w.industry, 'plan', w.plan,
          'created_at', w.created_at, 'onboarded_at', w.onboarded_at, 'frozen_at', w.frozen_at)
        FROM public.workspaces w WHERE w.id = v_ws),
      'access_mode', coalesce((SELECT mode FROM public.workspace_access_state WHERE workspace_id = v_ws), 'active'),
      'members', coalesce((
        SELECT jsonb_agg(jsonb_build_object('email', u.email, 'role', m.role, 'joined_at', m.created_at)
                         ORDER BY m.created_at)
        FROM public.workspace_members m LEFT JOIN auth.users u ON u.id = m.user_id
        WHERE m.workspace_id = v_ws), '[]'::jsonb),
      'content_by_status', coalesce((
        SELECT jsonb_object_agg(status, n) FROM (
          SELECT status, count(*) AS n FROM public.content_items WHERE workspace_id = v_ws GROUP BY status) c),
        '{}'::jsonb),
      'accounts_by_status', coalesce((
        SELECT jsonb_object_agg(status, n) FROM (
          SELECT status, count(*) AS n FROM public.social_accounts
          WHERE workspace_id = v_ws AND disconnected_at IS NULL GROUP BY status) a), '{}'::jsonb),
      'jobs_7d_by_status', coalesce((
        SELECT jsonb_object_agg(status, n) FROM (
          SELECT status, count(*) AS n FROM public.studio_jobs
          WHERE workspace_id = v_ws AND created_at > now() - interval '7 days' GROUP BY status) j),
        '{}'::jsonb),
      'ai_30d', (SELECT jsonb_build_object('calls', count(*), 'cost_usd', coalesce(sum(est_cost_usd), 0))
                 FROM public.ai_usage_events
                 WHERE workspace_id = v_ws AND created_at > now() - interval '30 days'));
  ELSIF p_section = 'content' THEN
    v_out := jsonb_build_object('items', coalesce((
      SELECT jsonb_agg(c ORDER BY c.created_at DESC) FROM (
        SELECT id, kind, channel, status, left(coalesce(title, ''), 120) AS title,
               created_at, scheduled_at
        FROM public.content_items WHERE workspace_id = v_ws
        ORDER BY created_at DESC LIMIT 30) c), '[]'::jsonb));
  ELSIF p_section = 'accounts' THEN
    v_out := jsonb_build_object(
      'social', coalesce((
        SELECT jsonb_agg(s ORDER BY s.connected_at DESC) FROM (
          SELECT platform, status, username, connected_at, last_synced_at,
                 left(coalesce(reconnect_reason, ''), 200) AS reconnect_reason
          FROM public.social_accounts WHERE workspace_id = v_ws AND disconnected_at IS NULL
          ORDER BY connected_at DESC LIMIT 30) s), '[]'::jsonb),
      'connections', coalesce((
        SELECT jsonb_agg(c ORDER BY c.last_verified_at DESC NULLS LAST) FROM (
          SELECT provider, status, account_login, last_verified_at,
                 left(coalesce(last_error, ''), 200) AS last_error
          FROM public.workspace_connections WHERE workspace_id = v_ws AND revoked_at IS NULL
          ORDER BY last_verified_at DESC NULLS LAST LIMIT 30) c), '[]'::jsonb));
  ELSE
    v_out := jsonb_build_object('jobs', coalesce((
      SELECT jsonb_agg(j ORDER BY j.created_at DESC) FROM (
        SELECT id, type, stage, status, created_at, updated_at,
               left(coalesce(error ->> 'message', ''), 200) AS error
        FROM public.studio_jobs WHERE workspace_id = v_ws
        ORDER BY created_at DESC LIMIT 30) j), '[]'::jsonb));
  END IF;

  PERFORM private.admin_audit_write(
    p_actor, p_actor_role, 'support_view.read', 'workspace', v_ws::text, v_ws,
    NULL, jsonb_build_object('session_id', p_session, 'section', p_section),
    NULL, p_request_id, p_ip, p_user_agent);

  RETURN jsonb_build_object('workspace_id', v_ws, 'expires_at', v_session.expires_at,
                            'section', p_section, 'data', v_out);
END;
$$;

/* ─────────────────────── who may call the functions ─────────────────────── */

REVOKE ALL ON FUNCTION
  public.admin_workspace_set_access(uuid, text, uuid, text, text, text, text, text),
  public.admin_view_start(uuid, text, uuid, text, text, text, text),
  public.admin_view_end(uuid, text, uuid, text, text, text),
  public.admin_view_read(uuid, text, uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.admin_workspace_set_access(uuid, text, uuid, text, text, text, text, text),
  public.admin_view_start(uuid, text, uuid, text, text, text, text),
  public.admin_view_end(uuid, text, uuid, text, text, text),
  public.admin_view_read(uuid, text, uuid, text, text, text, text)
  TO service_role;
