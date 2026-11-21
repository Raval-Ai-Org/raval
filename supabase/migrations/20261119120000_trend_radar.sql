-- Trend Radar (ADR-0052): trends Mellox staff post from the admin console
-- (a game launch, a match, a viral format) with a brief, what to make, what
-- never to do and reference media. A trend reaches every brand ('all'), named
-- industries or brands ('specific'), or only its industries ('micro').
--
-- Customers never read the table directly: `live_trends_for(workspace)`
-- checks membership and returns live rows without the list of other brands
-- a trend was aimed at. Staff write only through `admin_trend_save`, which
-- writes the audit row in the same transaction. Media live in the private
-- asset bucket under platform/trends/<id>/ and are signed by the server.
-- Idempotent.

CREATE TABLE IF NOT EXISTS public.platform_trends (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text NOT NULL
    CONSTRAINT platform_trends_title_len CHECK (char_length(title) BETWEEN 2 AND 120),
  brief         text NOT NULL DEFAULT ''
    CONSTRAINT platform_trends_brief_len CHECK (char_length(brief) <= 2000),
  what_to_make  text NOT NULL DEFAULT ''
    CONSTRAINT platform_trends_make_len CHECK (char_length(what_to_make) <= 1200),
  do_nots       text NOT NULL DEFAULT ''
    CONSTRAINT platform_trends_donots_len CHECK (char_length(do_nots) <= 800),
  scope         text NOT NULL DEFAULT 'all'
    CONSTRAINT platform_trends_scope_check CHECK (scope IN ('all', 'specific', 'micro')),
  industries    text[] NOT NULL DEFAULT '{}'
    CONSTRAINT platform_trends_industries_len CHECK (cardinality(industries) <= 25),
  workspace_ids uuid[] NOT NULL DEFAULT '{}'
    CONSTRAINT platform_trends_workspaces_len CHECK (cardinality(workspace_ids) <= 200),
  languages     text[] NOT NULL DEFAULT '{}',
  platforms     text[] NOT NULL DEFAULT '{}',
  tags          text[] NOT NULL DEFAULT '{}'
    CONSTRAINT platform_trends_tags_len CHECK (cardinality(tags) <= 20),
  links         text[] NOT NULL DEFAULT '{}'
    CONSTRAINT platform_trends_links_len CHECK (cardinality(links) <= 10),
  media         jsonb NOT NULL DEFAULT '[]'::jsonb
    CONSTRAINT platform_trends_media_array CHECK (jsonb_typeof(media) = 'array'),
  allow_mood    boolean NOT NULL DEFAULT false,
  priority      int NOT NULL DEFAULT 3
    CONSTRAINT platform_trends_priority_check CHECK (priority BETWEEN 1 AND 5),
  status        text NOT NULL DEFAULT 'draft'
    CONSTRAINT platform_trends_status_check CHECK (status IN ('draft', 'live', 'archived')),
  starts_at     timestamptz NOT NULL DEFAULT now(),
  ends_at       timestamptz,
  published_at  timestamptz,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT platform_trends_window_check CHECK (ends_at IS NULL OR ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS platform_trends_live_idx
  ON public.platform_trends (starts_at DESC) WHERE status = 'live';

ALTER TABLE public.platform_trends ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.platform_trends FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.platform_trends TO service_role;

/* ───────────────────── the trends that reach one brand ───────────────────── */

-- Live trends a member of this workspace may see: every 'all' trend, and the
-- 'specific' / 'micro' trends aimed at this workspace or its industry. The
-- industry match is decided in TypeScript (radar.ts), so this returns every
-- industry-scoped trend; only the workspace list is checked here, and it is
-- never returned.
CREATE OR REPLACE FUNCTION public.live_trends_for(p_workspace_id uuid)
RETURNS TABLE (
  id uuid, title text, brief text, what_to_make text, do_nots text, scope text,
  industries text[], aimed_here boolean, languages text[], platforms text[],
  tags text[], links text[], media jsonb, allow_mood boolean, priority int,
  status text, starts_at timestamptz, ends_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT t.id, t.title, t.brief, t.what_to_make, t.do_nots, t.scope, t.industries,
         (p_workspace_id = ANY (t.workspace_ids)) AS aimed_here,
         t.languages, t.platforms, t.tags, t.links, t.media, t.allow_mood, t.priority,
         t.status, t.starts_at, t.ends_at
    FROM public.platform_trends t
   WHERE private.is_workspace_member(p_workspace_id, auth.uid())
     AND t.status = 'live'
     AND t.starts_at <= now()
     AND (t.ends_at IS NULL OR t.ends_at > now())
     AND (t.scope = 'all'
          OR p_workspace_id = ANY (t.workspace_ids)
          OR cardinality(t.industries) > 0)
   ORDER BY t.priority DESC, t.starts_at DESC
   LIMIT 30;
$$;

REVOKE ALL ON FUNCTION public.live_trends_for(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.live_trends_for(uuid) TO authenticated, service_role;

/* ─────────────────────────────── staff save ─────────────────────────────── */

CREATE OR REPLACE FUNCTION public.admin_trend_save(
  p_actor uuid,
  p_actor_role text,
  p_id uuid,
  p_trend jsonb,
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
  v_row public.platform_trends%ROWTYPE;
  v_new boolean := p_id IS NULL;
  v_status text := coalesce(p_trend->>'status', 'draft');
  v_was text;
BEGIN
  IF char_length(btrim(coalesce(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'A reason of at least 10 characters is required.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(coalesce(p_trend->'media', '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'media must be a list.' USING ERRCODE = '22023';
  END IF;

  IF v_new THEN
    INSERT INTO public.platform_trends
      (title, brief, what_to_make, do_nots, scope, industries, workspace_ids, languages,
       platforms, tags, links, media, allow_mood, priority, status, starts_at, ends_at,
       published_at, created_by)
    VALUES
      (btrim(p_trend->>'title'),
       coalesce(btrim(p_trend->>'brief'), ''),
       coalesce(btrim(p_trend->>'what_to_make'), ''),
       coalesce(btrim(p_trend->>'do_nots'), ''),
       coalesce(p_trend->>'scope', 'all'),
       coalesce(ARRAY(SELECT jsonb_array_elements_text(p_trend->'industries')), '{}'),
       coalesce(ARRAY(SELECT (jsonb_array_elements_text(p_trend->'workspace_ids'))::uuid), '{}'),
       coalesce(ARRAY(SELECT jsonb_array_elements_text(p_trend->'languages')), '{}'),
       coalesce(ARRAY(SELECT jsonb_array_elements_text(p_trend->'platforms')), '{}'),
       coalesce(ARRAY(SELECT jsonb_array_elements_text(p_trend->'tags')), '{}'),
       coalesce(ARRAY(SELECT jsonb_array_elements_text(p_trend->'links')), '{}'),
       coalesce(p_trend->'media', '[]'::jsonb),
       coalesce((p_trend->>'allow_mood')::boolean, false),
       coalesce((p_trend->>'priority')::int, 3),
       v_status,
       coalesce((p_trend->>'starts_at')::timestamptz, now()),
       nullif(p_trend->>'ends_at', '')::timestamptz,
       CASE WHEN v_status = 'live' THEN now() END,
       p_actor)
    RETURNING * INTO v_row;
  ELSE
    SELECT status INTO v_was FROM public.platform_trends WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'No such trend.' USING ERRCODE = 'P0002';
    END IF;
    UPDATE public.platform_trends SET
      title = btrim(p_trend->>'title'),
      brief = coalesce(btrim(p_trend->>'brief'), ''),
      what_to_make = coalesce(btrim(p_trend->>'what_to_make'), ''),
      do_nots = coalesce(btrim(p_trend->>'do_nots'), ''),
      scope = coalesce(p_trend->>'scope', scope),
      industries = coalesce(ARRAY(SELECT jsonb_array_elements_text(p_trend->'industries')), '{}'),
      workspace_ids = coalesce(ARRAY(SELECT (jsonb_array_elements_text(p_trend->'workspace_ids'))::uuid), '{}'),
      languages = coalesce(ARRAY(SELECT jsonb_array_elements_text(p_trend->'languages')), '{}'),
      platforms = coalesce(ARRAY(SELECT jsonb_array_elements_text(p_trend->'platforms')), '{}'),
      tags = coalesce(ARRAY(SELECT jsonb_array_elements_text(p_trend->'tags')), '{}'),
      links = coalesce(ARRAY(SELECT jsonb_array_elements_text(p_trend->'links')), '{}'),
      media = coalesce(p_trend->'media', media),
      allow_mood = coalesce((p_trend->>'allow_mood')::boolean, allow_mood),
      priority = coalesce((p_trend->>'priority')::int, priority),
      status = v_status,
      starts_at = coalesce((p_trend->>'starts_at')::timestamptz, starts_at),
      ends_at = nullif(p_trend->>'ends_at', '')::timestamptz,
      published_at = CASE WHEN v_status = 'live' AND v_was <> 'live' THEN now() ELSE published_at END,
      updated_at = now()
    WHERE id = p_id
    RETURNING * INTO v_row;
  END IF;

  -- The audit row carries the trend's id, state and reach, not its text.
  PERFORM private.admin_audit_write(
    p_actor, p_actor_role,
    CASE WHEN v_new THEN 'trend.created'
         WHEN v_status = 'live' AND v_was IS DISTINCT FROM 'live' THEN 'trend.published'
         ELSE 'trend.updated' END,
    'trend', v_row.id::text, NULL, NULL,
    jsonb_build_object('status', v_row.status, 'scope', v_row.scope,
                       'industries', v_row.industries,
                       'workspaces', cardinality(v_row.workspace_ids),
                       'starts_at', v_row.starts_at, 'ends_at', v_row.ends_at),
    p_reason, p_request_id, p_ip, p_user_agent);

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION
  public.admin_trend_save(uuid, text, uuid, jsonb, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  public.admin_trend_save(uuid, text, uuid, jsonb, text, text, text, text)
  TO service_role;
