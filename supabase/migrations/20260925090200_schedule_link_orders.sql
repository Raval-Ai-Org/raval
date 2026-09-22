-- Schedule the link marketplace background work, and retire the dead job.
--
-- `mellox-backlink-runs` still pointed at /api/public/hooks/backlink-runs, a
-- route that stopped existing two migrations ago — every tick was a 404.
--
--   mellox-link-orders   every minute; advances one order cycle and polls the
--                        provider's link list. Deliberately frequent because a
--                        cycle holding the global basket lock must not sit idle.
--   mellox-link-catalog  daily; mirrors the provider catalog.
--
-- Both are guarded on pg_cron and the Vault secrets being present, so this
-- migration replays cleanly on a local database that has neither.
DO $$
DECLARE
  v_ready boolean;
BEGIN
  IF to_regnamespace('cron') IS NULL OR to_regclass('vault.decrypted_secrets') IS NULL THEN
    RAISE NOTICE 'pg_cron or Vault unavailable — link marketplace jobs not scheduled';
    RETURN;
  END IF;

  -- The dead job goes regardless of whether we can schedule the new ones.
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mellox-backlink-runs') THEN
    PERFORM cron.unschedule('mellox-backlink-runs');
    RAISE NOTICE 'unscheduled mellox-backlink-runs (route no longer exists)';
  END IF;

  SELECT count(*) = 2 INTO v_ready
    FROM vault.decrypted_secrets
   WHERE name IN ('mellox_app_base_url', 'mellox_cron_secret')
     AND coalesce(decrypted_secret, '') <> '';

  IF NOT v_ready THEN
    RAISE NOTICE 'Vault secrets missing — link marketplace jobs not scheduled';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mellox-link-orders') THEN
    PERFORM cron.unschedule('mellox-link-orders');
  END IF;
  PERFORM cron.schedule('mellox-link-orders', '* * * * *',
    format('SELECT public.call_app_hook(%L);', '/api/public/hooks/link-orders'));

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mellox-link-catalog') THEN
    PERFORM cron.unschedule('mellox-link-catalog');
  END IF;
  PERFORM cron.schedule('mellox-link-catalog', '17 4 * * *',
    format('SELECT public.call_app_hook(%L);', '/api/public/hooks/link-catalog'));
END;
$$;
