-- Public portal access is mediated by /api/public/share/[slug] with the
-- service-role client after token/password verification. Anonymous PostgREST
-- access must not be granted on any client portal table.
REVOKE ALL ON TABLE public.client_shares FROM anon;
REVOKE ALL ON TABLE public.client_share_items FROM anon;
REVOKE ALL ON TABLE public.client_events FROM anon;