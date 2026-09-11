-- Shared caller for the app's cron hooks.
--
-- Background: the original competitor-watch job (20260709194553) hardcoded a
-- stale deployment URL and sent an `apikey` header, but every hook in
-- src/app/api/public/hooks/* requires `x-cron-secret` == CRON_SECRET. That job
-- was unscheduled in 20260903000000 and never replaced, so nothing currently
-- drives scheduled publishing, Market Brain collection, competitor scans or SDR
-- reconciliation. See supabase/ENABLE-CRON-JOBS.sql to turn them on.
--
-- This migration only creates the caller. It schedules nothing and is safe to
-- apply in every environment: without the Vault entries the function raises a
-- clear error, and nothing invokes it until a cron job is scheduled.
--
-- Reading the base URL and secret from Vault at call time means:
--   * no deployment URL or secret is ever written into migration SQL,
--   * rotating CRON_SECRET is a Vault update, not a re-schedule,
--   * the same migration works in dev, staging and production.

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.call_app_hook(p_path text)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, vault, net, pg_temp
AS $$
DECLARE
  v_base_url text;
  v_secret text;
BEGIN
  IF p_path IS NULL OR left(p_path, 1) <> '/' THEN
    RAISE EXCEPTION 'p_path must be an absolute path beginning with "/", got: %', p_path;
  END IF;

  SELECT decrypted_secret INTO v_base_url
  FROM vault.decrypted_secrets
  WHERE name = 'mellox_app_base_url';

  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = 'mellox_cron_secret';

  IF v_base_url IS NULL OR v_base_url = '' THEN
    RAISE EXCEPTION
      'Vault secret "mellox_app_base_url" is not set. See supabase/ENABLE-CRON-JOBS.sql';
  END IF;

  -- Mirrors the app-side guard: the hooks return 503 for a secret under 16
  -- chars, so fail loudly here rather than scheduling doomed requests.
  IF v_secret IS NULL OR length(v_secret) < 16 THEN
    RAISE EXCEPTION
      'Vault secret "mellox_cron_secret" is missing or shorter than 16 characters. See supabase/ENABLE-CRON-JOBS.sql';
  END IF;

  RETURN net.http_post(
    url := rtrim(v_base_url, '/') || p_path,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
END;
$$;

-- Cron runs as the table owner; no application role should be able to make the
-- database issue authenticated requests to the app on its behalf.
REVOKE ALL ON FUNCTION public.call_app_hook(text) FROM anon, authenticated, public;
