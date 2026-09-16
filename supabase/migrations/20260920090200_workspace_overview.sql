-- One row per workspace the CALLER belongs to, with per-workspace metrics for
-- Projects / Agency HQ / Command Center. SECURITY INVOKER: every count runs
-- under the caller's RLS and is correlated on that row's workspace id, so a
-- metric can never be attributed to (or aggregated from) another workspace.

CREATE OR REPLACE FUNCTION public.workspace_overview()
RETURNS TABLE (
  id uuid,
  name text,
  website_url text,
  domain text,
  industry text,
  client_status text,
  plan text,
  role text,
  owner_id uuid,
  duplicate_of uuid,
  onboarded_at timestamptz,
  created_at timestamptz,
  logo_url text,
  pending_approvals bigint,
  draft_count bigint,
  scheduled_count bigint,
  published_count bigint,
  failed_count bigint,
  connected_social_accounts bigint,
  geo_score integer,
  geo_scanned_at timestamptz,
  last_activity_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    w.id,
    w.name,
    w.website_url,
    w.domain,
    w.industry,
    w.client_status::text,
    w.plan,
    m.role,
    w.owner_id,
    w.duplicate_of,
    w.onboarded_at,
    w.created_at,
    nullif(coalesce(d.dna ->> 'logoUrl', d.dna ->> 'faviconUrl'), '') AS logo_url,
    (SELECT count(*) FROM public.approvals a WHERE a.workspace_id = w.id AND a.status = 'pending'),
    (SELECT count(*) FROM public.content_items c WHERE c.workspace_id = w.id AND c.status IN ('draft', 'pending')),
    (SELECT count(*) FROM public.content_items c WHERE c.workspace_id = w.id AND c.status = 'scheduled'),
    (SELECT count(*) FROM public.content_items c WHERE c.workspace_id = w.id AND c.status = 'published'),
    (SELECT count(*) FROM public.content_items c WHERE c.workspace_id = w.id AND c.status = 'failed'),
    (SELECT count(*) FROM public.social_accounts s WHERE s.workspace_id = w.id AND s.status = 'active'),
    g.overall_score,
    g.completed_at,
    GREATEST(
      w.created_at,
      (SELECT max(c.updated_at) FROM public.content_items c WHERE c.workspace_id = w.id),
      (SELECT max(v.updated_at) FROM public.conversations v WHERE v.workspace_id = w.id),
      g.completed_at,
      d.updated_at
    )
  FROM public.workspace_members m
  JOIN public.workspaces w ON w.id = m.workspace_id
  LEFT JOIN public.workspace_brand_dna d ON d.workspace_id = w.id
  LEFT JOIN LATERAL (
    SELECT s.overall_score, s.completed_at
      FROM public.geo_scans s
     WHERE s.workspace_id = w.id AND s.status = 'succeeded'
     ORDER BY s.completed_at DESC NULLS LAST
     LIMIT 1
  ) g ON true
  WHERE m.user_id = auth.uid()
  ORDER BY w.created_at DESC;
$$;

REVOKE ALL ON FUNCTION public.workspace_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.workspace_overview() TO authenticated, service_role;
