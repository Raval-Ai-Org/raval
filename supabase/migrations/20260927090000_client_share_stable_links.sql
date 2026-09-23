-- Client portal links must stay the same link. Only token_hash was stored, so
-- "Copy link" on an existing share had to mint a new token, which silently
-- broke the link the client already had. token_ciphertext keeps the raw token
-- encrypted at the app layer (AES-256-GCM, SHARE_LINK_ENCRYPTION_KEY, see
-- src/server/shares/link-token.server.ts) so the server can hand back the same
-- URL. Access is still checked against token_hash only.
--
-- Anonymous access stays revoked (20260920090500); the /api/shares list
-- selects explicit columns and never returns this one.
--
-- Idempotent: safe to replay.

ALTER TABLE public.client_shares
  ADD COLUMN IF NOT EXISTS token_ciphertext text;
