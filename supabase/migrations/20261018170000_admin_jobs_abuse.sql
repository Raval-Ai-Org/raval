-- Mellox admin panel: a unified jobs view and basic abuse signals.
--
-- Read-only, service-role only, over tables other features own. The jobs view
-- never copies or edits a job: acting on one (cancel, nudge) calls the owning
-- feature's own function from the app. The abuse signals are heuristics with
-- fixed, documented thresholds; they only LIST candidates. Nothing here suspends
-- anyone or changes anything.

/* ─────────────────────────────── jobs ─────────────────────────────── */

-- p_source: 'all' | 'studio' | 'geo_scan' | 'experiment' | 'autopilot'
-- p_state:  'all' | 'active' | 'failed' | 'stuck'
-- A job is "stuck" when it is queued or running and has not been touched for
-- 30 minutes; "active" is queued or running.
CREATE OR REPLACE FUNCTION public.admin_jobs(
  p_source text,
  p_state text,
  p_limit int,
  p_offset int
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH all_jobs AS (
    SELECT 'studio'::text AS source, j.id::text AS id, j.workspace_id, j.type AS kind,
           j.status, j.attempt AS attempts, NULL::int AS max_attempts,
           j.created_at, j.updated_at,
           left(coalesce(j.error ->> 'message', ''), 200) AS error
    FROM public.studio_jobs j
    WHERE j.created_at > now() - interval '30 days'
    UNION ALL
    SELECT 'geo_scan', g.id::text, g.workspace_id, g.mode, g.status, g.attempt_count, NULL,
           g.created_at, g.updated_at, left(coalesce(g.error, ''), 200)
    FROM public.geo_scans g
    WHERE g.created_at > now() - interval '30 days'
    UNION ALL
    SELECT 'experiment', e.id::text, e.workspace_id, e.kind, e.status, e.attempts, e.max_attempts,
           e.created_at, e.updated_at, left(coalesce(e.last_error, ''), 200)
    FROM public.experiment_jobs e
    WHERE e.created_at > now() - interval '30 days'
    UNION ALL
    SELECT 'autopilot', a.id::text, a.workspace_id, a.kind, a.status, a.attempts, NULL,
           a.created_at, a.updated_at, left(coalesce(a.last_error, ''), 200)
    FROM public.autopilot_actions a
    WHERE a.created_at > now() - interval '30 days'
  ),
  tagged AS (
    SELECT t.*,
           (t.status IN ('queued', 'running', 'pending', 'generating')) AS is_active,
           (t.status IN ('queued', 'running', 'pending', 'generating') AND t.updated_at < now() - interval '30 minutes') AS is_stuck,
           (t.status = 'failed') AS is_failed
    FROM all_jobs t
  ),
  filtered AS (
    SELECT * FROM tagged
    WHERE (coalesce(p_source, 'all') = 'all' OR source = p_source)
      AND CASE coalesce(p_state, 'all')
            WHEN 'active' THEN is_active
            WHEN 'failed' THEN is_failed
            WHEN 'stuck'  THEN is_stuck
            ELSE true
          END
  )
  SELECT jsonb_build_object(
    'generated_at', now(),
    'counts', coalesce((
      SELECT jsonb_agg(c) FROM (
        SELECT source,
               count(*) FILTER (WHERE is_active) AS active,
               count(*) FILTER (WHERE is_stuck) AS stuck,
               count(*) FILTER (WHERE is_failed AND updated_at > now() - interval '24 hours') AS failed_24h
        FROM tagged GROUP BY source ORDER BY source) c), '[]'::jsonb),
    'total', (SELECT count(*) FROM filtered),
    'rows', coalesce((
      SELECT jsonb_agg(r ORDER BY r.updated_at DESC) FROM (
        SELECT source, id, workspace_id, kind, status, attempts, max_attempts,
               created_at, updated_at, error, is_stuck AS stuck
        FROM filtered ORDER BY updated_at DESC
        LIMIT least(greatest(coalesce(p_limit, 25), 1), 100)
        OFFSET greatest(coalesce(p_offset, 0), 0)) r), '[]'::jsonb)
  );
$$;

/* ───────────────────────────── abuse signals ───────────────────────────── */

-- Thresholds (also shown in the console):
--   signup_bursts     5+ accounts from one email domain within one hour, last 7 days
--                     (the big mailbox providers are skipped: they prove nothing)
--   cost_spikes       24h estimated AI cost above $5 AND above 5x the workspace's
--                     daily average of the previous 7 days
--   failing_users     a person with 50+ AI calls in 24h of which at least half
--                     errored or were blocked (a loop, or probing)
--   heavy_users       300+ AI calls by one person in a single hour, last 24 hours
--   failing_workspaces 10+ failed Studio jobs in 24 hours
CREATE OR REPLACE FUNCTION public.admin_abuse_signals()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'generated_at', now(),
    'signup_bursts', coalesce((
      SELECT jsonb_agg(b ORDER BY b.accounts DESC) FROM (
        SELECT lower(split_part(u.email, '@', 2)) AS domain,
               date_trunc('hour', u.created_at) AS hour,
               count(*) AS accounts
        FROM auth.users u
        WHERE u.created_at > now() - interval '7 days'
          AND u.email IS NOT NULL
          AND lower(split_part(u.email, '@', 2)) NOT IN (
            'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com',
            'yahoo.com', 'icloud.com', 'me.com', 'proton.me', 'protonmail.com', 'aol.com')
        GROUP BY 1, 2
        HAVING count(*) >= 5
        ORDER BY count(*) DESC LIMIT 20) b), '[]'::jsonb),
    'cost_spikes', coalesce((
      SELECT jsonb_agg(c ORDER BY c.cost_24h DESC) FROM (
        SELECT d.workspace_id, w.name, d.cost_24h, d.avg_daily_7d
        FROM (
          SELECT e.workspace_id,
                 sum(e.est_cost_usd) FILTER (WHERE e.created_at > now() - interval '24 hours') AS cost_24h,
                 coalesce(sum(e.est_cost_usd) FILTER (
                   WHERE e.created_at <= now() - interval '24 hours'
                     AND e.created_at > now() - interval '8 days') / 7.0, 0) AS avg_daily_7d
          FROM public.ai_usage_events e
          WHERE e.workspace_id IS NOT NULL AND e.created_at > now() - interval '8 days'
          GROUP BY e.workspace_id) d
        LEFT JOIN public.workspaces w ON w.id = d.workspace_id
        WHERE d.cost_24h > 5 AND d.cost_24h > 5 * d.avg_daily_7d
        ORDER BY d.cost_24h DESC LIMIT 20) c), '[]'::jsonb),
    'failing_users', coalesce((
      SELECT jsonb_agg(f ORDER BY f.bad_calls DESC) FROM (
        SELECT e.user_id, count(*) AS calls,
               count(*) FILTER (WHERE e.status IN ('error', 'blocked')) AS bad_calls
        FROM public.ai_usage_events e
        WHERE e.user_id IS NOT NULL AND e.created_at > now() - interval '24 hours'
        GROUP BY e.user_id
        HAVING count(*) >= 50
           AND count(*) FILTER (WHERE e.status IN ('error', 'blocked')) * 2 >= count(*)
        ORDER BY count(*) FILTER (WHERE e.status IN ('error', 'blocked')) DESC LIMIT 20) f), '[]'::jsonb),
    'heavy_users', coalesce((
      SELECT jsonb_agg(h ORDER BY h.calls DESC) FROM (
        SELECT e.user_id, date_trunc('hour', e.created_at) AS hour, count(*) AS calls
        FROM public.ai_usage_events e
        WHERE e.user_id IS NOT NULL AND e.created_at > now() - interval '24 hours'
        GROUP BY 1, 2
        HAVING count(*) >= 300
        ORDER BY count(*) DESC LIMIT 20) h), '[]'::jsonb),
    'failing_workspaces', coalesce((
      SELECT jsonb_agg(w ORDER BY w.failed DESC) FROM (
        SELECT j.workspace_id, ws.name, count(*) AS failed
        FROM public.studio_jobs j LEFT JOIN public.workspaces ws ON ws.id = j.workspace_id
        WHERE j.status = 'failed' AND j.updated_at > now() - interval '24 hours'
        GROUP BY j.workspace_id, ws.name
        HAVING count(*) >= 10
        ORDER BY count(*) DESC LIMIT 20) w), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION
  public.admin_jobs(text, text, int, int),
  public.admin_abuse_signals()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.admin_jobs(text, text, int, int),
  public.admin_abuse_signals()
  TO service_role;
