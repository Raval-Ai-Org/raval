-- Mellox admin panel, phase 6: feature flags and announcements.
--
-- Flags: a DB-backed layer for NEW gates (src/server/platform/flags.server.ts).
-- The older env-var flags in src/lib/feature-flags.ts are untouched, and an env
-- var named FEATURE_FLAG_<KEY> still outranks the row.
-- Announcements: messages staff show to signed-in people. They are the one admin
-- table customers may read, and only the rows that are live right now.
--
-- Same rules as the other admin migrations: a change and its audit row are
-- written in one transaction, functions are service-role only, idempotent.

CREATE TABLE IF NOT EXISTS public.platform_flags (
  key             text PRIMARY KEY
    CONSTRAINT platform_flags_key_check CHECK (key ~ '^[a-z][a-z0-9_.-]{2,59}$'),
  description     text NOT NULL DEFAULT ''
    CONSTRAINT platform_flags_description_len CHECK (char_length(description) <= 300),
  enabled         boolean NOT NULL DEFAULT false,
  rollout_percent integer NOT NULL DEFAULT 100
    CONSTRAINT platform_flags_rollout_check CHECK (rollout_percent BETWEEN 0 AND 100),
  workspace_ids   uuid[] NOT NULL DEFAULT '{}'
    CONSTRAINT platform_flags_workspaces_len CHECK (cardinality(workspace_ids) <= 200),
  expires_at      timestamptz,
  updated_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_flags ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_flags FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.platform_flags TO service_role;

CREATE TABLE IF NOT EXISTS public.platform_announcements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text NOT NULL
    CONSTRAINT platform_announcements_title_len CHECK (char_length(title) BETWEEN 1 AND 120),
  body        text NOT NULL DEFAULT ''
    CONSTRAINT platform_announcements_body_len CHECK (char_length(body) <= 600),
  tone        text NOT NULL DEFAULT 'info'
    CONSTRAINT platform_announcements_tone_check CHECK (tone IN ('info', 'success', 'warning')),
  link_url    text
    CONSTRAINT platform_announcements_link_check CHECK (link_url IS NULL OR link_url ~ '^https://'),
  dismissible boolean NOT NULL DEFAULT true,
  active      boolean NOT NULL DEFAULT true,
  starts_at   timestamptz NOT NULL DEFAULT now(),
  ends_at     timestamptz,
  created_by  uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_announcements_window_check CHECK (ends_at IS NULL OR ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS platform_announcements_live_idx
  ON public.platform_announcements (starts_at DESC) WHERE active;

ALTER TABLE public.platform_announcements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_announcements FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.platform_announcements TO service_role;
GRANT SELECT ON public.platform_announcements TO authenticated;

DROP POLICY IF EXISTS platform_announcements_read_live ON public.platform_announcements;
CREATE POLICY platform_announcements_read_live ON public.platform_announcements
  FOR SELECT TO authenticated
  USING (active AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now()));

/* ───────────────────────────── flag save ───────────────────────────── */

CREATE OR REPLACE FUNCTION public.admin_flag_save(
  p_actor uuid,
  p_actor_role text,
  p_key text,
  p_description text,
  p_enabled boolean,
  p_rollout int,
  p_workspaces uuid[],
  p_expires_at timestamptz,
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
  v_before public.platform_flags%ROWTYPE;
  v_after public.platform_flags%ROWTYPE;
BEGIN
  IF char_length(btrim(coalesce(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'A reason of at least 10 characters is required.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_before FROM public.platform_flags WHERE key = p_key FOR UPDATE;

  INSERT INTO public.platform_flags AS f
    (key, description, enabled, rollout_percent, workspace_ids, expires_at, updated_by)
  VALUES
    (p_key, coalesce(p_description, ''), p_enabled, p_rollout, coalesce(p_workspaces, '{}'),
     p_expires_at, p_actor)
  ON CONFLICT (key) DO UPDATE SET
    description = excluded.description,
    enabled = excluded.enabled,
    rollout_percent = excluded.rollout_percent,
    workspace_ids = excluded.workspace_ids,
    expires_at = excluded.expires_at,
    updated_by = excluded.updated_by,
    updated_at = now()
  RETURNING * INTO v_after;

  PERFORM private.admin_audit_write(
    p_actor, p_actor_role,
    CASE WHEN v_before.key IS NULL THEN 'flag.created' ELSE 'flag.updated' END,
    'flag', p_key, NULL,
    CASE WHEN v_before.key IS NULL THEN NULL ELSE jsonb_build_object(
      'enabled', v_before.enabled, 'rollout_percent', v_before.rollout_percent,
      'workspaces', cardinality(v_before.workspace_ids), 'expires_at', v_before.expires_at) END,
    jsonb_build_object(
      'enabled', v_after.enabled, 'rollout_percent', v_after.rollout_percent,
      'workspaces', cardinality(v_after.workspace_ids), 'expires_at', v_after.expires_at),
    p_reason, p_request_id, p_ip, p_user_agent);

  RETURN to_jsonb(v_after);
END;
$$;

/* ─────────────────────────── announcement save ─────────────────────────── */

CREATE OR REPLACE FUNCTION public.admin_announcement_save(
  p_actor uuid,
  p_actor_role text,
  p_id uuid,
  p_title text,
  p_body text,
  p_tone text,
  p_link_url text,
  p_dismissible boolean,
  p_active boolean,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
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
  v_row public.platform_announcements%ROWTYPE;
  v_new boolean := p_id IS NULL;
BEGIN
  IF char_length(btrim(coalesce(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'A reason of at least 10 characters is required.' USING ERRCODE = '22023';
  END IF;

  IF v_new THEN
    INSERT INTO public.platform_announcements
      (title, body, tone, link_url, dismissible, active, starts_at, ends_at, created_by)
    VALUES
      (btrim(p_title), coalesce(btrim(p_body), ''), p_tone, nullif(btrim(p_link_url), ''),
       p_dismissible, p_active, coalesce(p_starts_at, now()), p_ends_at, p_actor)
    RETURNING * INTO v_row;
  ELSE
    UPDATE public.platform_announcements SET
      title = btrim(p_title), body = coalesce(btrim(p_body), ''), tone = p_tone,
      link_url = nullif(btrim(p_link_url), ''), dismissible = p_dismissible,
      active = p_active, starts_at = coalesce(p_starts_at, starts_at), ends_at = p_ends_at,
      updated_at = now()
    WHERE id = p_id
    RETURNING * INTO v_row;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'No such announcement.' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  -- The audit row carries the announcement id and its state, not the text.
  PERFORM private.admin_audit_write(
    p_actor, p_actor_role,
    CASE WHEN v_new THEN 'announcement.created' ELSE 'announcement.updated' END,
    'announcement', v_row.id::text, NULL, NULL,
    jsonb_build_object('active', v_row.active, 'tone', v_row.tone,
                       'starts_at', v_row.starts_at, 'ends_at', v_row.ends_at),
    p_reason, p_request_id, p_ip, p_user_agent);

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION
  public.admin_flag_save(uuid, text, text, text, boolean, int, uuid[], timestamptz, text, text, text, text),
  public.admin_announcement_save(uuid, text, uuid, text, text, text, text, boolean, boolean, timestamptz, timestamptz, text, text, text, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.admin_flag_save(uuid, text, text, text, boolean, int, uuid[], timestamptz, text, text, text, text),
  public.admin_announcement_save(uuid, text, uuid, text, text, text, text, boolean, boolean, timestamptz, timestamptz, text, text, text, text)
  TO service_role;
