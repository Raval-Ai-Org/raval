-- PostgREST exposes public, not private. Keep the atomic queue claims in the
-- private schema and expose only service-role-only wrappers for the app worker.
CREATE OR REPLACE FUNCTION public.claim_slack_inbox(p_limit integer)
RETURNS SETOF public.slack_inbox
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT * FROM private.claim_slack_inbox(p_limit);
$$;
REVOKE ALL ON FUNCTION public.claim_slack_inbox(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_slack_inbox(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_slack_outbound(p_limit integer)
RETURNS SETOF public.slack_outbound
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT * FROM private.claim_slack_outbound(p_limit);
$$;
REVOKE ALL ON FUNCTION public.claim_slack_outbound(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_slack_outbound(integer) TO service_role;

-- The original experiments migration can be recorded as applied while its
-- guarded schedule block skipped creation. Repair only this missing job; keep
-- an existing schedule unchanged. Environments without scheduler prerequisites
-- remain unscheduled and visibly fail readiness once a heartbeat exists.
DO $$
BEGIN
  IF to_regnamespace('cron') IS NULL OR to_regclass('vault.decrypted_secrets') IS NULL THEN
    RAISE NOTICE 'pg_cron or Vault unavailable — mellox-experiments not scheduled';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM vault.decrypted_secrets
      WHERE name IN ('mellox_app_base_url', 'mellox_cron_secret')
        AND coalesce(decrypted_secret, '') <> '') <> 2 THEN
    RAISE NOTICE 'Vault secrets missing — mellox-experiments not scheduled';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mellox-experiments') THEN
    PERFORM cron.schedule(
      'mellox-experiments',
      '*/5 * * * *',
      format('SELECT public.call_app_hook(%L);', '/api/public/hooks/experiments')
    );
  END IF;
END;
$$;
