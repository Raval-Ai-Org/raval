-- Launch grace month. Accounts created before plans existed may own more
-- brands or teammates than Free allows. Before limits are switched on, give
-- each of them a free month on the smallest plan that fits, so nothing they
-- built becomes read-only on day one. After the month, the normal capacity
-- rules apply (extra brands become read-only; nothing is deleted).
--
-- Idempotent: an account that already has a grace-month activation, or any
-- manual plan, is skipped. The billing cron issues the plan's monthly grant
-- because next_grant_at is set to now.

DO $$
DECLARE
  v_row record;
  v_plan text;
  v_until timestamptz := now() + interval '30 days';
BEGIN
  FOR v_row IN
    SELECT a.id, a.owner_user_id,
      (SELECT count(*) FROM public.workspaces w
         WHERE w.billing_account_id = a.id AND w.duplicate_of IS NULL AND w.frozen_at IS NULL) AS brands,
      (SELECT count(DISTINCT m.user_id) FROM public.workspace_members m
         JOIN public.workspaces w ON w.id = m.workspace_id
         WHERE w.billing_account_id = a.id AND w.duplicate_of IS NULL
           AND m.role <> 'viewer') AS seats
    FROM public.billing_accounts a
    WHERE a.comped_plan_id IS NULL
      AND a.plan_id = 'free'
      AND a.status = 'free'
      AND NOT EXISTS (
        SELECT 1 FROM public.billing_manual_activations x
        WHERE x.account_id = a.id AND x.reason = 'Launch grace month'
      )
  LOOP
    CONTINUE WHEN v_row.brands <= 1 AND greatest(v_row.seats, 1) <= 1;
    v_plan := CASE
      WHEN v_row.brands <= 1 AND v_row.seats <= 2 THEN 'starter'
      WHEN v_row.brands <= 3 AND v_row.seats <= 5 THEN 'growth'
      WHEN v_row.brands <= 10 THEN 'agency'
      ELSE 'scale'
    END;
    UPDATE public.billing_accounts
       SET comped_plan_id = v_plan,
           comped_until = v_until,
           next_grant_at = now(),
           capacity_reconciled_at = NULL,
           updated_at = now()
     WHERE id = v_row.id;
    INSERT INTO public.billing_manual_activations
      (id, account_id, actor_user_id, kind, catalog_key, billing_interval, months, active_until, reason)
    VALUES
      (gen_random_uuid(), v_row.id, '00000000-0000-0000-0000-000000000000', 'plan', v_plan,
       'month', 1, v_until, 'Launch grace month');
    INSERT INTO public.account_notifications (account_id, user_id, kind, window_key, payload)
    VALUES (v_row.id, v_row.owner_user_id, 'launch_grace', 'launch-grace',
      jsonb_build_object('plan', v_plan, 'until', v_until,
        'title', 'A free month of ' || initcap(v_plan) || ' so your brands keep working'))
    ON CONFLICT (account_id, user_id, kind, window_key) DO NOTHING;
  END LOOP;
END;
$$;
