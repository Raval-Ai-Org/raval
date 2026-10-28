-- Advance provider-accepted Studio renders independently of browser polling
-- and the broader five-minute billing maintenance job.
DO $$
DECLARE
  v_ready boolean;
BEGIN
  IF to_regnamespace('cron') IS NULL OR to_regclass('vault.decrypted_secrets') IS NULL THEN
    RAISE NOTICE 'pg_cron or Vault unavailable — mellox-studio-renders not scheduled';
    RETURN;
  END IF;

  SELECT count(*) = 2 INTO v_ready
    FROM vault.decrypted_secrets
   WHERE name IN ('mellox_app_base_url', 'mellox_cron_secret')
     AND coalesce(decrypted_secret, '') <> '';

  IF NOT v_ready THEN
    RAISE NOTICE 'Vault secrets missing — mellox-studio-renders not scheduled';
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mellox-studio-renders') THEN
    PERFORM cron.unschedule('mellox-studio-renders');
  END IF;

  PERFORM cron.schedule(
    'mellox-studio-renders',
    '* * * * *',
    format('SELECT public.call_app_hook(%L);', '/api/public/hooks/studio-renders')
  );
END;
$$;
