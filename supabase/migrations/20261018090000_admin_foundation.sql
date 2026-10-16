-- Mellox admin panel, phase 1: who the admins are, what they did, and the
-- narrow reads and writes the admin console is allowed to make.
--
-- Rules this migration keeps (docs/admin/ADMIN-PANEL-PLAN.md):
--   * Admin tables are service-role only: RLS on, no policy, no grant for
--     anon/authenticated. A customer's JWT can never read them.
--   * The audit log is append-only even for service_role (same approach as
--     workspace_credit_ledger).
--   * A change and its audit row are written in ONE transaction, inside the
--     function that makes the change. No audit row, no change.
--   * Functions are SECURITY DEFINER with an empty search_path and are
--     executable by service_role only; the app checks the admin's permission
--     before calling them (src/server/admin/route.ts).
--
-- Everything is idempotent (IF NOT EXISTS / OR REPLACE / DROP … IF EXISTS).

/* ───────────────────────────── tables ───────────────────────────── */

CREATE TABLE IF NOT EXISTS public.admin_users (
  user_id            uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  role               text NOT NULL
    CONSTRAINT admin_users_role_check CHECK (role IN (
      'super_admin', 'operations', 'support', 'finance', 'engineering', 'analyst')),
  status             text NOT NULL DEFAULT 'active'
    CONSTRAINT admin_users_status_check CHECK (status IN ('active', 'disabled')),
  extra_permissions  text[] NOT NULL DEFAULT '{}',
  denied_permissions text[] NOT NULL DEFAULT '{}',
  note               text CONSTRAINT admin_users_note_len CHECK (note IS NULL OR char_length(note) <= 300),
  created_by         uuid,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  last_seen_at       timestamptz,
  disabled_at        timestamptz
);

CREATE INDEX IF NOT EXISTS admin_users_active_role_idx
  ON public.admin_users (role) WHERE status = 'active';

-- Ids are kept without a foreign key on purpose: the trail must outlive the
-- user, the workspace and the admin it talks about.
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at     timestamptz NOT NULL DEFAULT now(),
  actor_user_id  uuid,
  actor_role     text,
  action         text NOT NULL CONSTRAINT admin_audit_action_len CHECK (char_length(action) BETWEEN 1 AND 80),
  target_type    text,
  target_id      text,
  workspace_id   uuid,
  before_state   jsonb,
  after_state    jsonb,
  reason         text CONSTRAINT admin_audit_reason_len CHECK (reason IS NULL OR char_length(reason) <= 500),
  success        boolean NOT NULL DEFAULT true,
  error          text CONSTRAINT admin_audit_error_len CHECK (error IS NULL OR char_length(error) <= 500),
  request_id     text,
  ip             text,
  user_agent     text CONSTRAINT admin_audit_ua_len CHECK (user_agent IS NULL OR char_length(user_agent) <= 300),
  impersonating  uuid
);

CREATE INDEX IF NOT EXISTS admin_audit_log_created_idx ON public.admin_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_actor_idx ON public.admin_audit_log (actor_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_action_idx ON public.admin_audit_log (action, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_log_target_idx ON public.admin_audit_log (target_type, target_id, created_at DESC);

-- Internal notes about a customer. Written once, never edited.
CREATE TABLE IF NOT EXISTS public.admin_user_notes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  author_id  uuid NOT NULL,
  body       text NOT NULL CONSTRAINT admin_user_notes_body_len CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_user_notes_user_idx
  ON public.admin_user_notes (user_id, created_at DESC);

/* ───────────────────── append-only audit and notes ───────────────────── */

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.admin_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION private.admin_append_only() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS admin_audit_log_immutable ON public.admin_audit_log;
CREATE TRIGGER admin_audit_log_immutable
  BEFORE UPDATE OR DELETE ON public.admin_audit_log
  FOR EACH ROW EXECUTE FUNCTION private.admin_append_only();

DROP TRIGGER IF EXISTS admin_user_notes_immutable ON public.admin_user_notes;
CREATE TRIGGER admin_user_notes_immutable
  BEFORE UPDATE OR DELETE ON public.admin_user_notes
  FOR EACH ROW EXECUTE FUNCTION private.admin_append_only();

/* ───────────────────────────── security ───────────────────────────── */

ALTER TABLE public.admin_users      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_log  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_user_notes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.admin_users, public.admin_audit_log, public.admin_user_notes
  FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.admin_users, public.admin_audit_log, public.admin_user_notes TO service_role;

/* ───────────────────────────── audit helper ───────────────────────────── */

CREATE OR REPLACE FUNCTION private.admin_audit_write(
  p_actor uuid,
  p_actor_role text,
  p_action text,
  p_target_type text,
  p_target_id text,
  p_workspace uuid,
  p_before jsonb,
  p_after jsonb,
  p_reason text,
  p_request_id text,
  p_ip text,
  p_user_agent text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.admin_audit_log (
    actor_user_id, actor_role, action, target_type, target_id, workspace_id,
    before_state, after_state, reason, success, request_id, ip, user_agent
  ) VALUES (
    p_actor, p_actor_role, p_action, p_target_type, p_target_id, p_workspace,
    p_before, p_after, left(p_reason, 500), true, p_request_id, left(p_ip, 64), left(p_user_agent, 300)
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION private.admin_audit_write(uuid, text, text, text, text, uuid, jsonb, jsonb, text, text, text, text)
  FROM PUBLIC, anon, authenticated;

/* ───────────────────────────── reads ───────────────────────────── */

-- Escapes nothing and uses no LIKE: the search term is matched with position()
-- so a "%" or "_" typed by an admin is just a character.
CREATE OR REPLACE FUNCTION public.admin_user_directory(
  p_search text,
  p_filter text,
  p_sort text,
  p_limit int,
  p_offset int
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_search text := lower(btrim(coalesce(p_search, '')));
  v_limit int := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_total bigint;
  v_rows jsonb;
BEGIN
  WITH base AS (
    SELECT u.id, u.email, u.created_at, u.last_sign_in_at, u.banned_until,
           u.email_confirmed_at, u.raw_app_meta_data -> 'providers' AS providers,
           p.name, p.persona,
           (SELECT count(*) FROM public.workspace_members m WHERE m.user_id = u.id) AS workspace_count,
           EXISTS (SELECT 1 FROM public.admin_users a WHERE a.user_id = u.id AND a.status = 'active') AS is_admin
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.id = u.id
    WHERE (v_search = ''
           OR position(v_search IN lower(coalesce(u.email, ''))) > 0
           OR position(v_search IN lower(coalesce(p.name, ''))) > 0
           OR u.id::text = v_search)
      AND CASE coalesce(p_filter, 'all')
            WHEN 'suspended'   THEN u.banned_until IS NOT NULL AND u.banned_until > now()
            WHEN 'unconfirmed' THEN u.email_confirmed_at IS NULL
            WHEN 'recent'      THEN u.created_at > now() - interval '7 days'
            WHEN 'admins'      THEN EXISTS (SELECT 1 FROM public.admin_users a WHERE a.user_id = u.id AND a.status = 'active')
            ELSE true
          END
  )
  SELECT (SELECT count(*) FROM base),
         coalesce(jsonb_agg(to_jsonb(page) - '_n' ORDER BY page._n), '[]'::jsonb)
    INTO v_total, v_rows
  FROM (
    SELECT base.*,
           row_number() OVER (
             ORDER BY
               CASE WHEN p_sort = 'last_seen' THEN last_sign_in_at END DESC NULLS LAST,
               created_at DESC,
               id) AS _n
    FROM base
    ORDER BY _n
    LIMIT v_limit OFFSET v_offset
  ) page;

  RETURN jsonb_build_object('total', v_total, 'rows', v_rows);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_workspace_directory(
  p_search text,
  p_filter text,
  p_limit int,
  p_offset int
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_search text := lower(btrim(coalesce(p_search, '')));
  v_limit int := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_total bigint;
  v_rows jsonb;
BEGIN
  WITH base AS (
    SELECT w.id, w.name, w.domain, w.plan, w.created_at, w.frozen_at, w.frozen_reason,
           w.owner_id, o.email AS owner_email,
           b.plan_id AS billing_plan, b.status AS billing_status,
           (SELECT count(*) FROM public.workspace_members m WHERE m.workspace_id = w.id) AS member_count
    FROM public.workspaces w
    LEFT JOIN auth.users o ON o.id = w.owner_id
    LEFT JOIN public.billing_accounts b ON b.id = w.billing_account_id
    WHERE (v_search = ''
           OR position(v_search IN lower(coalesce(w.name, ''))) > 0
           OR position(v_search IN lower(coalesce(w.domain, ''))) > 0
           OR position(v_search IN lower(coalesce(o.email, ''))) > 0
           OR w.id::text = v_search)
      AND CASE coalesce(p_filter, 'all')
            WHEN 'frozen' THEN w.frozen_at IS NOT NULL
            WHEN 'paid'   THEN coalesce(b.plan_id, 'free') NOT IN ('free', 'paused')
            WHEN 'free'   THEN coalesce(b.plan_id, 'free') = 'free'
            WHEN 'recent' THEN w.created_at > now() - interval '7 days'
            ELSE true
          END
  )
  SELECT (SELECT count(*) FROM base),
         coalesce(jsonb_agg(to_jsonb(page) - '_n' ORDER BY page._n), '[]'::jsonb)
    INTO v_total, v_rows
  FROM (
    SELECT base.*, row_number() OVER (ORDER BY created_at DESC, id) AS _n
    FROM base
    ORDER BY _n
    LIMIT v_limit OFFSET v_offset
  ) page;

  RETURN jsonb_build_object('total', v_total, 'rows', v_rows);
END;
$$;

-- Real counts only. A figure with no source is simply not in this object.
CREATE OR REPLACE FUNCTION public.admin_overview()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'generated_at', now(),
    'users', jsonb_build_object(
      'total', (SELECT count(*) FROM auth.users),
      'new_7d', (SELECT count(*) FROM auth.users WHERE created_at > now() - interval '7 days'),
      'new_30d', (SELECT count(*) FROM auth.users WHERE created_at > now() - interval '30 days'),
      'active_7d', (SELECT count(*) FROM auth.users WHERE last_sign_in_at > now() - interval '7 days'),
      'suspended', (SELECT count(*) FROM auth.users WHERE banned_until IS NOT NULL AND banned_until > now()),
      'unconfirmed', (SELECT count(*) FROM auth.users WHERE email_confirmed_at IS NULL)
    ),
    'workspaces', jsonb_build_object(
      'total', (SELECT count(*) FROM public.workspaces),
      'new_7d', (SELECT count(*) FROM public.workspaces WHERE created_at > now() - interval '7 days'),
      'frozen', (SELECT count(*) FROM public.workspaces WHERE frozen_at IS NOT NULL)
    ),
    'billing', jsonb_build_object(
      'paying_accounts', (SELECT count(*) FROM public.billing_accounts WHERE plan_id NOT IN ('free', 'paused') AND status IN ('active', 'past_due')),
      'trialing_accounts', (SELECT count(*) FROM public.billing_accounts WHERE status = 'trialing'),
      'pending_requests', (SELECT count(*) FROM public.billing_purchase_requests WHERE status = 'pending')
    ),
    'jobs', jsonb_build_object(
      'studio_failed_24h', (SELECT count(*) FROM public.studio_jobs WHERE status = 'failed' AND updated_at > now() - interval '24 hours'),
      'studio_running', (SELECT count(*) FROM public.studio_jobs WHERE status IN ('queued', 'running'))
    ),
    'admins', jsonb_build_object(
      'active', (SELECT count(*) FROM public.admin_users WHERE status = 'active')
    )
  );
$$;

-- Emails for a batch of user ids (at most 100), so a page of rows costs one call.
CREATE OR REPLACE FUNCTION public.admin_emails_for(p_ids uuid[])
RETURNS TABLE (id uuid, email text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT u.id, u.email::text FROM auth.users u
  WHERE u.id = ANY (p_ids[1:100]);
$$;

CREATE OR REPLACE FUNCTION public.admin_user_stats(p_user uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'sessions', (SELECT count(*) FROM auth.sessions s WHERE s.user_id = p_user
                   AND (s.not_after IS NULL OR s.not_after > now())),
    'mfa_factors', (SELECT count(*) FROM auth.mfa_factors f WHERE f.user_id = p_user AND f.status = 'verified')
  );
$$;

CREATE OR REPLACE FUNCTION public.admin_workspace_members(p_workspace uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'user_id', m.user_id, 'email', u.email, 'role', m.role, 'joined_at', m.created_at
         ) ORDER BY m.created_at), '[]'::jsonb)
  FROM (
    SELECT * FROM public.workspace_members WHERE workspace_id = p_workspace
    ORDER BY created_at LIMIT 100
  ) m
  LEFT JOIN auth.users u ON u.id = m.user_id;
$$;

/* ───────────────────────────── writes ───────────────────────────── */

-- Add or change an admin. Guards:
--   * nobody edits their own row (no self-promotion, no self-lockout);
--   * the last active super admin in the table cannot be demoted or disabled.
-- (Accounts on the BILLING_ADMIN_USER_IDS environment list are super admins
-- outside this table and remain the way back in.)
CREATE OR REPLACE FUNCTION public.admin_team_save(
  p_actor uuid,
  p_actor_role text,
  p_user uuid,
  p_role text,
  p_status text,
  p_extra text[],
  p_denied text[],
  p_note text,
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
  v_before public.admin_users%ROWTYPE;
  v_after public.admin_users%ROWTYPE;
  v_others int;
BEGIN
  IF p_actor IS NULL OR p_actor = p_user THEN
    RAISE EXCEPTION 'You cannot change your own admin access.' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user) THEN
    RAISE EXCEPTION 'No such user.' USING ERRCODE = 'P0002';
  END IF;
  IF p_status NOT IN ('active', 'disabled') THEN
    RAISE EXCEPTION 'Invalid status.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_before FROM public.admin_users WHERE user_id = p_user FOR UPDATE;

  IF FOUND AND v_before.role = 'super_admin' AND v_before.status = 'active'
     AND (p_role <> 'super_admin' OR p_status <> 'active') THEN
    SELECT count(*) INTO v_others FROM public.admin_users
      WHERE role = 'super_admin' AND status = 'active' AND user_id <> p_user;
    IF v_others = 0 THEN
      RAISE EXCEPTION 'There must be at least one active super admin.' USING ERRCODE = '23514';
    END IF;
  END IF;

  INSERT INTO public.admin_users AS a (
    user_id, role, status, extra_permissions, denied_permissions, note, created_by, disabled_at
  ) VALUES (
    p_user, p_role, p_status, coalesce(p_extra, '{}'), coalesce(p_denied, '{}'),
    left(p_note, 300), p_actor, CASE WHEN p_status = 'disabled' THEN now() END
  )
  ON CONFLICT (user_id) DO UPDATE SET
    role = EXCLUDED.role,
    status = EXCLUDED.status,
    extra_permissions = EXCLUDED.extra_permissions,
    denied_permissions = EXCLUDED.denied_permissions,
    note = EXCLUDED.note,
    updated_at = now(),
    disabled_at = CASE WHEN EXCLUDED.status = 'disabled' THEN coalesce(a.disabled_at, now()) END
  RETURNING * INTO v_after;

  PERFORM private.admin_audit_write(
    p_actor, p_actor_role,
    CASE WHEN v_before.user_id IS NULL THEN 'admin.added' ELSE 'admin.changed' END,
    'admin', p_user::text, NULL,
    CASE WHEN v_before.user_id IS NULL THEN NULL ELSE jsonb_build_object(
      'role', v_before.role, 'status', v_before.status,
      'extra', v_before.extra_permissions, 'denied', v_before.denied_permissions) END,
    jsonb_build_object(
      'role', v_after.role, 'status', v_after.status,
      'extra', v_after.extra_permissions, 'denied', v_after.denied_permissions),
    p_reason, p_request_id, p_ip, p_user_agent);

  RETURN to_jsonb(v_after);
END;
$$;

-- Suspend (ban) or restore a customer. The ban is Supabase Auth's own, so it is
-- enforced at sign-in and token refresh without any change to the app. A
-- suspension also ends every open session.
CREATE OR REPLACE FUNCTION public.admin_user_set_suspended(
  p_actor uuid,
  p_actor_role text,
  p_user uuid,
  p_suspend boolean,
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
  v_before timestamptz;
  v_after timestamptz;
  v_sessions int := 0;
BEGIN
  IF p_actor = p_user THEN
    RAISE EXCEPTION 'You cannot suspend your own account.' USING ERRCODE = '42501';
  END IF;
  IF p_suspend AND EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = p_user AND status = 'active') THEN
    RAISE EXCEPTION 'Remove this person from the admin team before suspending them.' USING ERRCODE = '42501';
  END IF;

  SELECT banned_until INTO v_before FROM auth.users WHERE id = p_user FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such user.' USING ERRCODE = 'P0002';
  END IF;

  UPDATE auth.users
     SET banned_until = CASE WHEN p_suspend THEN now() + interval '100 years' END,
         updated_at = now()
   WHERE id = p_user
  RETURNING banned_until INTO v_after;

  IF p_suspend THEN
    DELETE FROM auth.sessions WHERE user_id = p_user;
    GET DIAGNOSTICS v_sessions = ROW_COUNT;
  END IF;

  PERFORM private.admin_audit_write(
    p_actor, p_actor_role,
    CASE WHEN p_suspend THEN 'user.suspended' ELSE 'user.unsuspended' END,
    'user', p_user::text, NULL,
    jsonb_build_object('suspended', v_before IS NOT NULL AND v_before > now()),
    jsonb_build_object('suspended', p_suspend, 'sessions_ended', v_sessions),
    p_reason, p_request_id, p_ip, p_user_agent);

  RETURN jsonb_build_object('suspended', p_suspend, 'sessions_ended', v_sessions);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_user_revoke_sessions(
  p_actor uuid,
  p_actor_role text,
  p_user uuid,
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
  v_count int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user) THEN
    RAISE EXCEPTION 'No such user.' USING ERRCODE = 'P0002';
  END IF;
  DELETE FROM auth.sessions WHERE user_id = p_user;
  GET DIAGNOSTICS v_count = ROW_COUNT;

  PERFORM private.admin_audit_write(
    p_actor, p_actor_role, 'user.sessions_revoked', 'user', p_user::text, NULL,
    NULL, jsonb_build_object('sessions_ended', v_count),
    p_reason, p_request_id, p_ip, p_user_agent);

  RETURN jsonb_build_object('sessions_ended', v_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_user_add_note(
  p_actor uuid,
  p_actor_role text,
  p_user uuid,
  p_body text,
  p_request_id text,
  p_ip text,
  p_user_agent text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_note public.admin_user_notes%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user) THEN
    RAISE EXCEPTION 'No such user.' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.admin_user_notes (user_id, author_id, body)
    VALUES (p_user, p_actor, btrim(p_body))
    RETURNING * INTO v_note;

  -- The audit row carries the note's id and length, not its text.
  PERFORM private.admin_audit_write(
    p_actor, p_actor_role, 'user.note_added', 'user', p_user::text, NULL,
    NULL, jsonb_build_object('note_id', v_note.id, 'length', char_length(v_note.body)),
    NULL, p_request_id, p_ip, p_user_agent);

  RETURN to_jsonb(v_note);
END;
$$;

/* ─────────────────────── who may call the functions ─────────────────────── */

REVOKE ALL ON FUNCTION
  public.admin_user_directory(text, text, text, int, int),
  public.admin_workspace_directory(text, text, int, int),
  public.admin_overview(),
  public.admin_emails_for(uuid[]),
  public.admin_user_stats(uuid),
  public.admin_workspace_members(uuid),
  public.admin_team_save(uuid, text, uuid, text, text, text[], text[], text, text, text, text, text),
  public.admin_user_set_suspended(uuid, text, uuid, boolean, text, text, text, text),
  public.admin_user_revoke_sessions(uuid, text, uuid, text, text, text, text),
  public.admin_user_add_note(uuid, text, uuid, text, text, text, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.admin_user_directory(text, text, text, int, int),
  public.admin_workspace_directory(text, text, int, int),
  public.admin_overview(),
  public.admin_emails_for(uuid[]),
  public.admin_user_stats(uuid),
  public.admin_workspace_members(uuid),
  public.admin_team_save(uuid, text, uuid, text, text, text[], text[], text, text, text, text, text),
  public.admin_user_set_suspended(uuid, text, uuid, boolean, text, text, text, text),
  public.admin_user_revoke_sessions(uuid, text, uuid, text, text, text, text),
  public.admin_user_add_note(uuid, text, uuid, text, text, text, text)
  TO service_role;
