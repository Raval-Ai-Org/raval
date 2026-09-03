-- Disable the unsafe legacy competitor-watch job if it exists.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'competitor-watch-scan') THEN
    PERFORM cron.unschedule('competitor-watch-scan');
  END IF;
END $$;