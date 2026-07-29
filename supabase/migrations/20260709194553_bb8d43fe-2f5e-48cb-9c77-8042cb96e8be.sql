
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'competitor-watch-scan') THEN
    PERFORM cron.unschedule('competitor-watch-scan');
  END IF;
END $$;

SELECT cron.schedule(
  'competitor-watch-scan',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://raval6.lovable.app/api/public/hooks/competitor-watch',
    headers := '{"Content-Type": "application/json", "apikey": "sb_publishable_S7mXBNliJnHUMWfCn4jS-Q_-Svjt7JV"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
