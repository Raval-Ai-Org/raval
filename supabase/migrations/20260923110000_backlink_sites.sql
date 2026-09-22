-- Backlink Builder: Mellox-owned publishing accounts.
--
-- The workspace does not connect anything. Mellox holds the platform
-- credentials server-side (env), the user picks a site from the catalog and a
-- page to promote, and Mellox publishes. So there is no per-workspace account
-- row to store, and backlink_accounts goes away.
--
-- backlink_placements keeps account_id as a nullable column that is simply no
-- longer written; dropping it would rewrite the table for no benefit.

ALTER TABLE public.backlink_placements
  DROP CONSTRAINT IF EXISTS backlink_placements_account_id_fkey;

DROP TABLE IF EXISTS public.backlink_accounts CASCADE;
