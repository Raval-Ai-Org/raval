-- Receipt log for the SDR → app webhook (src/app/api/public/hooks/sdr).
--
-- One row per callback — verified, rejected (bad signature), stale (replay
-- outside the tolerance window), unknown or malformed — and never the body.
-- It is the security signal the audit asked for (F-SEC-001 follow-up) and an
-- input to the Distribution Reliability Worker (rejection spikes, silence).
-- Rows are pruned after 30 days by public.prune_operational_logs().

CREATE TABLE IF NOT EXISTS public.sdr_webhook_events (
  id bigserial PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT now(),
  event text,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  outcome text NOT NULL
    CHECK (outcome IN ('verified', 'rejected', 'stale', 'unknown', 'malformed')),
  reason text NOT NULL DEFAULT '',
  sdr_post_id text,
  sdr_target_id text,
  account_id text
);

CREATE INDEX IF NOT EXISTS sdr_webhook_events_workspace_idx
  ON public.sdr_webhook_events (workspace_id, received_at DESC);
CREATE INDEX IF NOT EXISTS sdr_webhook_events_outcome_idx
  ON public.sdr_webhook_events (outcome, received_at DESC);

ALTER TABLE public.sdr_webhook_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.sdr_webhook_events FROM anon, authenticated;
GRANT SELECT ON public.sdr_webhook_events TO authenticated;
GRANT ALL ON public.sdr_webhook_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.sdr_webhook_events_id_seq TO service_role;

DROP POLICY IF EXISTS "Members read their webhook receipts" ON public.sdr_webhook_events;
CREATE POLICY "Members read their webhook receipts" ON public.sdr_webhook_events
  FOR SELECT TO authenticated
  USING (workspace_id IS NOT NULL AND private.is_workspace_member(workspace_id, auth.uid()));
