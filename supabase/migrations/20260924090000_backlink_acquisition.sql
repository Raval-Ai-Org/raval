-- Backlink acquisition — campaigns, opportunities, events, verification.
--
-- The product is a workflow, not a dashboard: find a real opportunity, help the
-- user pursue it, track every state honestly, independently verify the link.
--
-- An opportunity IS the backlink record. Its `status` is the single source of
-- truth, which is what structurally prevents "opportunity shown as live":
-- there is no second table that could disagree.
--
--   backlink_campaigns       a goal and a target count
--   backlink_opportunities   the spine; one row per (campaign, source, kind)
--   backlink_events          append-only timeline; powers the detail view
--   backlink_verifications   every check kept, so dates are real
--   backlink_discovery_runs  DataForSEO cache, so discovery is not re-billed
--
-- Replaces backlink_placements from the publishing experiment.

DROP TABLE IF EXISTS public.backlink_placements CASCADE;

-- ── Campaigns ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.backlink_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  goal text NOT NULL DEFAULT 'authority',
  target_count integer NOT NULL DEFAULT 20,
  site_host text,
  status text NOT NULL DEFAULT 'active',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT backlink_campaigns_goal_check
    CHECK (goal IN ('authority', 'referral', 'ai_visibility', 'discovery', 'brand')),
  CONSTRAINT backlink_campaigns_status_check CHECK (status IN ('active', 'paused', 'done')),
  CONSTRAINT backlink_campaigns_name_len CHECK (char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT backlink_campaigns_target_check CHECK (target_count BETWEEN 1 AND 500)
);

CREATE INDEX IF NOT EXISTS backlink_campaigns_workspace_idx
  ON public.backlink_campaigns (workspace_id, created_at DESC);

-- ── Discovery runs (the DataForSEO cache) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.backlink_discovery_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  campaign_id uuid REFERENCES public.backlink_campaigns(id) ON DELETE CASCADE,
  -- sha256 of site + competitors + goal + limit. A hit costs nothing.
  cache_key text NOT NULL,
  site_host text NOT NULL,
  competitors text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'running',
  found integer NOT NULL DEFAULT 0,
  cost_usd numeric(10, 6) NOT NULL DEFAULT 0,
  provider jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '30 days',
  CONSTRAINT backlink_discovery_status_check
    CHECK (status IN ('running', 'succeeded', 'partial', 'failed'))
);

CREATE INDEX IF NOT EXISTS backlink_discovery_cache_idx
  ON public.backlink_discovery_runs (workspace_id, cache_key, expires_at DESC)
  WHERE status IN ('succeeded', 'partial');
CREATE INDEX IF NOT EXISTS backlink_discovery_workspace_idx
  ON public.backlink_discovery_runs (workspace_id, created_at DESC);

-- ── Opportunities (the spine) ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.backlink_opportunities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES public.backlink_campaigns(id) ON DELETE CASCADE,
  discovery_run_id uuid REFERENCES public.backlink_discovery_runs(id) ON DELETE SET NULL,

  source_domain text NOT NULL,
  source_url text,
  source_title text,
  kind text NOT NULL,

  -- The honest lifecycle. Each value means exactly one thing:
  --   opportunity  we found a potential link
  --   planned      the user chose to pursue it
  --   in_progress  a draft exists / work started
  --   submitted    the user sent the request or submitted the content
  --   pending      the publisher has it and has not decided
  --   published    the publisher says the link exists (NOT yet proof)
  --   live         Mellox fetched the page and saw the link
  --   failed       declined, or verification could not find the link
  --   removed      user dismissed it, or the link disappeared
  status text NOT NULL DEFAULT 'opportunity',
  method text,

  target_url text,
  suggested_anchor text,

  -- Quality signals kept as columns because they are sorted and filtered.
  rank integer,
  spam_score smallint,
  competitor_hits smallint NOT NULL DEFAULT 0,
  score numeric(5, 2) NOT NULL DEFAULT 0,

  -- Grounding for "why this link": competitors, anchors, sample pages.
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Claude's why/angle/draft for the top rows. Never used for ordering.
  ai jsonb,
  outreach jsonb,

  -- Verification mirror of the latest check, for list rendering.
  verification text NOT NULL DEFAULT 'pending',
  verified_at timestamptz,
  live_url text,
  anchor_found text,
  is_nofollow boolean,

  first_live_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT backlink_opportunities_kind_check
    CHECK (kind IN ('competitor_gap', 'reclaim', 'broken', 'resource_page', 'directory')),
  CONSTRAINT backlink_opportunities_status_check
    CHECK (status IN ('opportunity', 'planned', 'in_progress', 'submitted',
                      'pending', 'published', 'live', 'failed', 'removed')),
  CONSTRAINT backlink_opportunities_method_check
    CHECK (method IS NULL OR method IN ('outreach', 'resource_submission',
                                        'broken_link_replacement',
                                        'guest_contribution', 'self_publish')),
  CONSTRAINT backlink_opportunities_verification_check
    CHECK (verification IN ('pending', 'live', 'nofollow', 'missing',
                            'unreachable', 'blocked')),
  -- A link can only be live if a check actually found it.
  CONSTRAINT backlink_opportunities_live_needs_proof
    CHECK (status <> 'live' OR verification IN ('live', 'nofollow')),
  CONSTRAINT backlink_opportunities_unique
    UNIQUE (workspace_id, campaign_id, source_domain, kind)
);

CREATE INDEX IF NOT EXISTS backlink_opportunities_campaign_idx
  ON public.backlink_opportunities (campaign_id, status, score DESC);
CREATE INDEX IF NOT EXISTS backlink_opportunities_workspace_idx
  ON public.backlink_opportunities (workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS backlink_opportunities_live_idx
  ON public.backlink_opportunities (workspace_id, first_live_at DESC)
  WHERE status = 'live';

-- ── Events (append-only timeline) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.backlink_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL REFERENCES public.backlink_opportunities(id) ON DELETE CASCADE,
  type text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT backlink_events_type_check
    CHECK (type IN ('discovered', 'selected', 'method_chosen', 'draft_created',
                    'draft_edited', 'submitted', 'publisher_responded',
                    'published', 'verified', 'verification_failed',
                    'status_changed', 'skipped', 'reopened'))
);

CREATE INDEX IF NOT EXISTS backlink_events_opportunity_idx
  ON public.backlink_events (opportunity_id, at);
CREATE INDEX IF NOT EXISTS backlink_events_workspace_idx
  ON public.backlink_events (workspace_id, at DESC);

-- ── Verifications (history, so dates are real) ────────────────────────────
CREATE TABLE IF NOT EXISTS public.backlink_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL REFERENCES public.backlink_opportunities(id) ON DELETE CASCADE,
  checked_url text NOT NULL,
  expected_target text NOT NULL,
  result text NOT NULL,
  http_status integer,
  link_found boolean,
  is_nofollow boolean,
  anchor_found text,
  error text,
  checked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  checked_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT backlink_verifications_result_check
    CHECK (result IN ('pending', 'live', 'nofollow', 'missing', 'unreachable', 'blocked'))
);

CREATE INDEX IF NOT EXISTS backlink_verifications_opportunity_idx
  ON public.backlink_verifications (opportunity_id, checked_at DESC);

-- ── Row-level security ────────────────────────────────────────────────────
-- Members read. Nobody but service_role writes: statuses, scores and
-- verification results are server-owned, and every write goes through a server
-- function that checks the editor role.
ALTER TABLE public.backlink_campaigns       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backlink_discovery_runs  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backlink_opportunities   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backlink_events          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backlink_verifications   ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.backlink_campaigns, public.backlink_discovery_runs,
               public.backlink_opportunities, public.backlink_events,
               public.backlink_verifications
  FROM anon, authenticated;

GRANT SELECT ON public.backlink_campaigns, public.backlink_discovery_runs,
                public.backlink_opportunities, public.backlink_events,
                public.backlink_verifications
  TO authenticated;

GRANT ALL ON public.backlink_campaigns, public.backlink_discovery_runs,
             public.backlink_opportunities, public.backlink_events,
             public.backlink_verifications
  TO service_role;

DROP POLICY IF EXISTS "Workspace members read backlink campaigns" ON public.backlink_campaigns;
CREATE POLICY "Workspace members read backlink campaigns"
  ON public.backlink_campaigns FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Workspace members read backlink discovery" ON public.backlink_discovery_runs;
CREATE POLICY "Workspace members read backlink discovery"
  ON public.backlink_discovery_runs FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Workspace members read backlink opportunities" ON public.backlink_opportunities;
CREATE POLICY "Workspace members read backlink opportunities"
  ON public.backlink_opportunities FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Workspace members read backlink events" ON public.backlink_events;
CREATE POLICY "Workspace members read backlink events"
  ON public.backlink_events FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Workspace members read backlink verifications" ON public.backlink_verifications;
CREATE POLICY "Workspace members read backlink verifications"
  ON public.backlink_verifications FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

-- ── Cross-workspace guard ─────────────────────────────────────────────────
-- A service-path bug must fail rather than cross tenants.
CREATE OR REPLACE FUNCTION private.backlink_opportunity_workspace_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ws uuid;
BEGIN
  SELECT workspace_id INTO v_ws
    FROM public.backlink_opportunities WHERE id = NEW.opportunity_id;
  IF v_ws IS NULL OR v_ws <> NEW.workspace_id THEN
    RAISE EXCEPTION 'backlink row workspace does not match its opportunity'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.backlink_opportunity_workspace_guard()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS backlink_events_workspace_guard ON public.backlink_events;
CREATE TRIGGER backlink_events_workspace_guard
  BEFORE INSERT OR UPDATE OF workspace_id, opportunity_id ON public.backlink_events
  FOR EACH ROW EXECUTE FUNCTION private.backlink_opportunity_workspace_guard();

DROP TRIGGER IF EXISTS backlink_verifications_workspace_guard ON public.backlink_verifications;
CREATE TRIGGER backlink_verifications_workspace_guard
  BEFORE INSERT OR UPDATE OF workspace_id, opportunity_id ON public.backlink_verifications
  FOR EACH ROW EXECUTE FUNCTION private.backlink_opportunity_workspace_guard();

CREATE OR REPLACE FUNCTION private.backlink_campaign_workspace_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ws uuid;
BEGIN
  SELECT workspace_id INTO v_ws
    FROM public.backlink_campaigns WHERE id = NEW.campaign_id;
  IF v_ws IS NULL OR v_ws <> NEW.workspace_id THEN
    RAISE EXCEPTION 'backlink row workspace does not match its campaign'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.backlink_campaign_workspace_guard()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS backlink_opportunities_workspace_guard ON public.backlink_opportunities;
CREATE TRIGGER backlink_opportunities_workspace_guard
  BEFORE INSERT OR UPDATE OF workspace_id, campaign_id ON public.backlink_opportunities
  FOR EACH ROW EXECUTE FUNCTION private.backlink_campaign_workspace_guard();

DROP TRIGGER IF EXISTS backlink_campaigns_touch_updated_at ON public.backlink_campaigns;
CREATE TRIGGER backlink_campaigns_touch_updated_at
  BEFORE UPDATE ON public.backlink_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS backlink_opportunities_touch_updated_at ON public.backlink_opportunities;
CREATE TRIGGER backlink_opportunities_touch_updated_at
  BEFORE UPDATE ON public.backlink_opportunities
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
