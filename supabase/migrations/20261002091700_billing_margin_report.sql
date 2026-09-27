CREATE INDEX IF NOT EXISTS ai_usage_events_charge_idx
  ON public.ai_usage_events(charge_id) WHERE charge_id IS NOT NULL;

-- Face-value credit revenue versus recorded provider spend. This is an
-- operational estimate, not booked cash revenue; unattributed calls are shown.
CREATE OR REPLACE FUNCTION public.billing_margin_report()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.face_value_usd DESC),'[]'::jsonb)
  FROM (
    SELECT c.action, count(*)::integer AS charges,
           round((sum(c.amount)::numeric / 100),2) AS face_value_usd,
           round(coalesce(sum(u.cost_usd),0)::numeric,4) AS estimated_provider_usd,
           count(*) FILTER (WHERE u.calls IS NULL)::integer AS unattributed_charges
      FROM public.billing_charges c
      LEFT JOIN LATERAL (
        SELECT count(*) AS calls, sum(est_cost_usd) AS cost_usd
          FROM public.ai_usage_events e WHERE e.charge_id=c.id
        HAVING count(*) > 0
      ) u ON true
     WHERE c.meter='credits' AND c.action<>'backlink_order'
       AND c.created_at >= now()-interval '14 days'
     GROUP BY c.action
  ) r;
$$;
REVOKE ALL ON FUNCTION public.billing_margin_report() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.billing_margin_report() TO service_role;
