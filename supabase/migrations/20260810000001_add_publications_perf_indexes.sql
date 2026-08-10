-- T075 — performance indexes for content_publications hot paths.
--
-- The webhook receiver resolves every delivery row by (sdr_post_id, sdr_target_id)
-- BEFORE verifying the signature (contracts/sdr-webhook.md); the reconcile sweep
-- scans status + updated_at globally. Neither was served by an index, so both ran
-- table scans as content_publications grows. Additive only; no schema change.

create index if not exists publications_sdr_lookup_idx
  on public.content_publications(sdr_post_id, sdr_target_id);

create index if not exists publications_reconcile_idx
  on public.content_publications(status, updated_at);
