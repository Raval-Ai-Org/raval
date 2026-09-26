-- Free grants and hold cleanup run from this hook. Recurring paid grants wait
-- for a paid Paddle transaction; the annual monthly allowance uses this hook.
ALTER TABLE public.billing_accounts ALTER COLUMN grant_anchor SET DEFAULT now();
ALTER TABLE public.billing_accounts ALTER COLUMN next_grant_at SET DEFAULT now();
UPDATE public.billing_accounts
SET grant_anchor = coalesce(grant_anchor, created_at),
    next_grant_at = coalesce(next_grant_at, created_at)
WHERE grant_anchor IS NULL OR next_grant_at IS NULL;

DO $$
DECLARE v_ready boolean;
BEGIN
  IF to_regnamespace('cron') IS NULL OR to_regclass('vault.decrypted_secrets') IS NULL THEN
    RAISE NOTICE 'pg_cron or Vault unavailable — billing hook not scheduled';
    RETURN;
  END IF;
  SELECT count(*) = 2 INTO v_ready FROM vault.decrypted_secrets
    WHERE name IN ('mellox_app_base_url','mellox_cron_secret')
      AND coalesce(decrypted_secret,'') <> '';
  IF NOT v_ready THEN
    RAISE NOTICE 'Vault secrets missing — billing hook not scheduled';
    RETURN;
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='mellox-billing') THEN
    PERFORM cron.unschedule('mellox-billing');
  END IF;
  PERFORM cron.schedule('mellox-billing','*/5 * * * *',
    format('SELECT public.call_app_hook(%L);','/api/public/hooks/billing'));
END;
$$;
