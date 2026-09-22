-- Competitor intelligence: one canonical competitor per workspace.
--
-- Before this migration Mellox had two features called "competitor" that knew
-- nothing about each other:
--   * public.competitor_watches  — regex snapshot diffing of one URL, with a
--     bell and an alert feed, but no idea WHO the competitor is.
--   * public.competitor_intelligence_runs — a Firecrawl + Claude profile of a
--     competitor's site, with no UI at all and nothing reading the table.
-- Neither could answer the question a marketer actually asks: who are my
-- competitors, what do they do, and what changed recently? And neither could
-- be *discovered* — a user had to already know every competitor's URL.
--
-- public.workspace_competitors is the entity both of those engines now hang
-- off. It is populated by discovery (Tavily search + a Claude classification
-- grounded in the search snippets), by manual entry, and by lifting whatever
-- the workspace already recorded in its Brand DNA. Profiles and updates are
-- written against it, and the two legacy tables gain a nullable competitor_id
-- so their existing rows keep working untouched.
--
-- Recurring work uses the lease/SKIP LOCKED pattern this codebase already
-- uses for GEO scans, backlink runs and link orders — claim_competitor_jobs
-- mirrors claim_geo_scans — and is advanced by the competitor-watch cron hook
-- that is already scheduled. No new queue, no new cron job.
--
-- Members read; the service role writes, after the server fn has verified the
-- caller's workspace role. Idempotent and non-destructive throughout.

-- ── The competitor ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.workspace_competitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- Normalised, lower-cased registrable host. The identity of a competitor:
  -- two searches finding the same company must not create two rows.
  domain text NOT NULL,
  name text NOT NULL,
  url text,
  source text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'suggested',
  relationship text NOT NULL DEFAULT 'unknown',
  -- How sure the discovery pass was, 0..1. Shown as a hint, never as a fact.
  confidence numeric(3, 2) NOT NULL DEFAULT 0,
  -- Why this company was proposed, grounded in the snippets that proposed it.
  rationale text,
  -- [{ title, url, snippet }] — the evidence behind the rationale.
  discovery_sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- The synthesised profile (CompetitorProfile in
  -- src/server/competitors/profile.server.ts). Null until first researched.
  profile jsonb,
  profile_status text NOT NULL DEFAULT 'pending',
  profile_error text,
  profile_updated_at timestamptz,
  updates_checked_at timestamptz,
  -- When the background worker should next look at this competitor. Backs off
  -- for competitors that never change, so a quiet market costs almost nothing.
  next_check_at timestamptz,
  lease_until timestamptz,
  locked_by text,
  attempt_count integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_competitors_source_check
    CHECK (source IN ('discovered', 'manual', 'brand_dna')),
  CONSTRAINT workspace_competitors_status_check
    CHECK (status IN ('suggested', 'tracked', 'ignored')),
  CONSTRAINT workspace_competitors_relationship_check
    CHECK (relationship IN ('direct', 'indirect', 'alternative', 'unknown')),
  CONSTRAINT workspace_competitors_profile_status_check
    CHECK (profile_status IN ('pending', 'running', 'ready', 'failed')),
  CONSTRAINT workspace_competitors_confidence_range
    CHECK (confidence >= 0 AND confidence <= 1),
  CONSTRAINT workspace_competitors_domain_length
    CHECK (char_length(domain) BETWEEN 3 AND 253),
  CONSTRAINT workspace_competitors_name_length CHECK (char_length(name) <= 200),
  CONSTRAINT workspace_competitors_url_length
    CHECK (url IS NULL OR char_length(url) <= 2048),
  CONSTRAINT workspace_competitors_rationale_length
    CHECK (rationale IS NULL OR char_length(rationale) <= 1000),
  CONSTRAINT workspace_competitors_error_length
    CHECK (profile_error IS NULL OR char_length(profile_error) <= 2000)
);

-- One row per company per workspace, whichever route it arrived by.
CREATE UNIQUE INDEX IF NOT EXISTS workspace_competitors_domain_key
  ON public.workspace_competitors (workspace_id, domain);

CREATE INDEX IF NOT EXISTS workspace_competitors_workspace_idx
  ON public.workspace_competitors (workspace_id, status, updated_at DESC);

-- The claim query's index: only tracked competitors are ever worked on, so an
-- ignored or merely suggested one costs nothing in the background.
CREATE INDEX IF NOT EXISTS workspace_competitors_due_idx
  ON public.workspace_competitors (next_check_at)
  WHERE status = 'tracked';

-- ── What changed recently ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.competitor_updates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  competitor_id uuid NOT NULL
    REFERENCES public.workspace_competitors(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'content',
  title text NOT NULL,
  summary text,
  significance text NOT NULL DEFAULT 'notable',
  source_url text,
  source_title text,
  published_at timestamptz,
  -- Stable identity for one real-world change. The same launch found by three
  -- different queries, or on a later sweep, collapses to one row — this is
  -- what keeps the feed meaningful instead of noisy.
  fingerprint text NOT NULL,
  read_at timestamptz,
  detected_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT competitor_updates_kind_check
    CHECK (kind IN ('launch', 'pricing', 'positioning', 'funding', 'campaign',
                    'content', 'site_change')),
  CONSTRAINT competitor_updates_significance_check
    CHECK (significance IN ('major', 'notable')),
  CONSTRAINT competitor_updates_title_length CHECK (char_length(title) <= 300),
  CONSTRAINT competitor_updates_summary_length
    CHECK (summary IS NULL OR char_length(summary) <= 1200),
  CONSTRAINT competitor_updates_source_url_length
    CHECK (source_url IS NULL OR char_length(source_url) <= 2048)
);

CREATE UNIQUE INDEX IF NOT EXISTS competitor_updates_fingerprint_key
  ON public.competitor_updates (competitor_id, fingerprint);

CREATE INDEX IF NOT EXISTS competitor_updates_workspace_idx
  ON public.competitor_updates (workspace_id, detected_at DESC);

CREATE INDEX IF NOT EXISTS competitor_updates_unread_idx
  ON public.competitor_updates (workspace_id)
  WHERE read_at IS NULL;

-- ── Link what already exists to the new entity ────────────────────────────
-- Both are nullable and unenforced for existing rows: nothing that works today
-- stops working, and a row without a competitor keeps its old behaviour.
ALTER TABLE public.competitor_watches
  ADD COLUMN IF NOT EXISTS competitor_id uuid;

ALTER TABLE public.competitor_intelligence_runs
  ADD COLUMN IF NOT EXISTS competitor_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'competitor_watches_competitor_id_fkey'
  ) THEN
    ALTER TABLE public.competitor_watches
      ADD CONSTRAINT competitor_watches_competitor_id_fkey
      FOREIGN KEY (competitor_id)
      REFERENCES public.workspace_competitors(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'competitor_intelligence_runs_competitor_id_fkey'
  ) THEN
    ALTER TABLE public.competitor_intelligence_runs
      ADD CONSTRAINT competitor_intelligence_runs_competitor_id_fkey
      FOREIGN KEY (competitor_id)
      REFERENCES public.workspace_competitors(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS competitor_watches_competitor_idx
  ON public.competitor_watches (competitor_id);

CREATE INDEX IF NOT EXISTS competitor_intelligence_runs_competitor_idx
  ON public.competitor_intelligence_runs (competitor_id, created_at DESC);

-- ── A child row must never cross tenants ──────────────────────────────────
-- A service-path bug must fail rather than attach one workspace's update to
-- another workspace's competitor.
CREATE OR REPLACE FUNCTION private.competitor_update_workspace_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_workspace uuid;
BEGIN
  SELECT workspace_id INTO v_workspace
    FROM public.workspace_competitors WHERE id = NEW.competitor_id;
  IF v_workspace IS NULL THEN
    RAISE EXCEPTION 'competitor % does not exist', NEW.competitor_id;
  END IF;
  IF v_workspace <> NEW.workspace_id THEN
    RAISE EXCEPTION 'competitor % does not belong to workspace %',
      NEW.competitor_id, NEW.workspace_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS competitor_updates_workspace_guard ON public.competitor_updates;
CREATE TRIGGER competitor_updates_workspace_guard
  BEFORE INSERT OR UPDATE OF workspace_id, competitor_id ON public.competitor_updates
  FOR EACH ROW EXECUTE FUNCTION private.competitor_update_workspace_guard();

-- ── Row-level security ────────────────────────────────────────────────────
ALTER TABLE public.workspace_competitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitor_updates ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.workspace_competitors FROM anon, authenticated;
REVOKE ALL ON public.competitor_updates FROM anon, authenticated;
GRANT SELECT ON public.workspace_competitors TO authenticated;
GRANT SELECT ON public.competitor_updates TO authenticated;
GRANT ALL ON public.workspace_competitors TO service_role;
GRANT ALL ON public.competitor_updates TO service_role;

DROP POLICY IF EXISTS "Workspace members read competitors" ON public.workspace_competitors;
CREATE POLICY "Workspace members read competitors"
  ON public.workspace_competitors FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Workspace members read competitor updates" ON public.competitor_updates;
CREATE POLICY "Workspace members read competitor updates"
  ON public.competitor_updates FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP TRIGGER IF EXISTS workspace_competitors_touch_updated_at ON public.workspace_competitors;
CREATE TRIGGER workspace_competitors_touch_updated_at
  BEFORE UPDATE ON public.workspace_competitors
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ── Worker lease claim ────────────────────────────────────────────────────
-- Claims tracked competitors whose next check is due and whose lease (if any)
-- has expired. FOR UPDATE SKIP LOCKED: an overlapping cron call and an
-- in-request kick never work the same competitor at once. Mirrors
-- public.claim_geo_scans.
CREATE OR REPLACE FUNCTION public.claim_competitor_jobs(
  p_worker text,
  p_max integer DEFAULT 3,
  p_lease_seconds integer DEFAULT 120,
  p_competitor_id uuid DEFAULT NULL
)
RETURNS SETOF public.workspace_competitors
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.workspace_competitors AS c
     SET lease_until = now() + make_interval(secs => greatest(p_lease_seconds, 30)),
         locked_by = p_worker,
         attempt_count = c.attempt_count + 1
   WHERE c.id IN (
     SELECT w.id
       FROM public.workspace_competitors w
      WHERE w.status = 'tracked'
        AND (p_competitor_id IS NULL OR w.id = p_competitor_id)
        AND (p_competitor_id IS NOT NULL
             OR w.next_check_at IS NULL
             OR w.next_check_at <= now())
        AND (w.lease_until IS NULL OR w.lease_until < now())
      ORDER BY w.next_check_at NULLS FIRST, w.created_at
      LIMIT greatest(p_max, 0)
      FOR UPDATE SKIP LOCKED
   )
  RETURNING c.*;
$$;

REVOKE ALL ON FUNCTION public.claim_competitor_jobs(text, integer, integer, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_competitor_jobs(text, integer, integer, uuid)
  TO service_role;
