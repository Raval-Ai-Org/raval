-- Repository ↔ website ownership (ADR-0013).
--
-- Mellox proposes changes to a repository only after it has evidence that the
-- repository builds the scanned website: GitHub deployments, Pages CNAME, the
-- repository's homepage, site URLs in config, and live page text found in the
-- source. The verdict and its evidence live on the source row; writes come
-- only from the server (service role) after role checks. Members keep read
-- access through the existing workspace_sources policies.
--
-- Also records a workspace admin's consent to send repository code to the AI
-- model used by the GEO coding agent.
--
-- Idempotent and non-destructive: safe to re-run.

ALTER TABLE public.workspace_sources ADD COLUMN IF NOT EXISTS ownership_status text NOT NULL DEFAULT 'unchecked';
ALTER TABLE public.workspace_sources ADD COLUMN IF NOT EXISTS ownership_confidence numeric(4,3);
ALTER TABLE public.workspace_sources ADD COLUMN IF NOT EXISTS ownership_site_host text;
ALTER TABLE public.workspace_sources ADD COLUMN IF NOT EXISTS ownership_commit_sha text;
ALTER TABLE public.workspace_sources ADD COLUMN IF NOT EXISTS ownership_evidence jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.workspace_sources ADD COLUMN IF NOT EXISTS ownership_hints jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.workspace_sources ADD COLUMN IF NOT EXISTS ownership_checked_at timestamptz;
ALTER TABLE public.workspace_sources
  ADD COLUMN IF NOT EXISTS ownership_checked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.workspace_sources ADD COLUMN IF NOT EXISTS agent_consent_at timestamptz;
ALTER TABLE public.workspace_sources
  ADD COLUMN IF NOT EXISTS agent_consent_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.workspace_sources DROP CONSTRAINT IF EXISTS workspace_sources_ownership_status_check;
ALTER TABLE public.workspace_sources
  ADD CONSTRAINT workspace_sources_ownership_status_check CHECK (ownership_status IN (
    'unchecked', 'checking', 'verified', 'likely', 'unverified', 'mismatch', 'attested'
  ));
ALTER TABLE public.workspace_sources DROP CONSTRAINT IF EXISTS workspace_sources_ownership_confidence_check;
ALTER TABLE public.workspace_sources
  ADD CONSTRAINT workspace_sources_ownership_confidence_check
  CHECK (ownership_confidence IS NULL OR (ownership_confidence >= 0 AND ownership_confidence <= 1));

CREATE INDEX IF NOT EXISTS workspace_sources_ownership_idx
  ON public.workspace_sources (workspace_id, site_host, ownership_status);
