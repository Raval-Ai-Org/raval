-- Public share access is mediated by the server route, which verifies the
-- cryptographic token and optional password before reading share content.
-- Anonymous PostgREST access would expose token/password hashes.
REVOKE ALL ON TABLE public.client_shares FROM anon;
DROP POLICY IF EXISTS "shares_select_public" ON public.client_shares;