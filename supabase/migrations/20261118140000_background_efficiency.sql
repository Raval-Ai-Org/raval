-- Background work efficiency (measured 2026-11-18 with `supabase inspect db`).
--
-- 1. call_app_hook was 90% of all database time: ~51 ms a call, 382k calls,
--    mostly two separate vault decryptions. Read both secrets in one query.
--    Behaviour, errors and the request it sends are unchanged.
--
-- 2. The billing hook re-checked the 50 least-recently-checked accounts every
--    five minutes (45 s a run) although only 2 of 95 were waiting.
--    billing_accounts_due_capacity lists only accounts whose brand/seat
--    limits may have changed since their last check: never checked, edited
--    since, a time boundary passed since (comp, trial, grace, downgrade,
--    cancel, period end), a staff override started/ended/was revoked since,
--    or a 6-hour safety re-check.
--
-- 3. agent_run_steps_run_idx duplicates the UNIQUE (run_id, seq) index.

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

  SELECT max(decrypted_secret) FILTER (WHERE name = 'mellox_app_base_url'),
         max(decrypted_secret) FILTER (WHERE name = 'mellox_cron_secret')
    INTO v_base_url, v_secret
    FROM vault.decrypted_secrets
   WHERE name IN ('mellox_app_base_url', 'mellox_cron_secret');

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
REVOKE ALL ON FUNCTION public.call_app_hook(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.billing_accounts_due_capacity(
  p_limit integer DEFAULT 50,
  p_only_enforced boolean DEFAULT false
)
RETURNS TABLE (owner_user_id uuid)
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT ba.owner_user_id
    FROM public.billing_accounts ba
   WHERE (NOT p_only_enforced OR ba.enforcement_override = 'on')
     AND (
          ba.capacity_reconciled_at IS NULL
       OR ba.capacity_reconciled_at < coalesce(ba.updated_at, ba.created_at)
       OR ba.capacity_reconciled_at < now() - interval '6 hours'
       OR EXISTS (
            SELECT 1
              FROM unnest(ARRAY[
                     ba.comped_until, ba.trial_ends_at, ba.grace_until,
                     ba.downgrade_at, ba.cancel_at, ba.current_period_end
                   ]) AS boundary(at)
             WHERE boundary.at > ba.capacity_reconciled_at AND boundary.at <= now()
          )
       OR EXISTS (
            SELECT 1
              FROM public.entitlement_overrides o
             WHERE (o.account_id = ba.id
                    OR o.workspace_id IN (SELECT w.id FROM public.workspaces w
                                           WHERE w.billing_account_id = ba.id))
               AND (   (o.created_at > ba.capacity_reconciled_at)
                    OR (o.starts_at  > ba.capacity_reconciled_at AND o.starts_at  <= now())
                    OR (o.expires_at > ba.capacity_reconciled_at AND o.expires_at <= now())
                    OR (o.revoked_at > ba.capacity_reconciled_at))
          )
     )
   ORDER BY ba.capacity_reconciled_at ASC NULLS FIRST
   LIMIT greatest(p_limit, 0);
$$;
REVOKE ALL ON FUNCTION public.billing_accounts_due_capacity(integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.billing_accounts_due_capacity(integer, boolean) TO service_role;

DROP INDEX IF EXISTS public.agent_run_steps_run_idx;
