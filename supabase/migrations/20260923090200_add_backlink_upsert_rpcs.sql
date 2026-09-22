-- Ingest RPCs for backlink runs.
--
-- These exist because the diff watermarks need real ON CONFLICT semantics that
-- a PostgREST upsert cannot express: on a re-observation the row must KEEP its
-- first_seen_run_id (otherwise every domain looks new on every run) while
-- moving last_seen_* forward, and a row coming back from 'lost' must record
-- regained_at without being counted as new.
--
-- Both take the whole page as one jsonb array, so a 1000-row ingest is one
-- statement rather than 1000.
--
-- Idempotent: safe to re-run.

CREATE OR REPLACE FUNCTION public.upsert_backlink_domains(
  p_run_id uuid,
  p_rows jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile uuid;
  v_workspace uuid;
  v_count integer;
BEGIN
  SELECT profile_id, workspace_id INTO v_profile, v_workspace
    FROM public.backlink_runs WHERE id = p_run_id;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'unknown backlink run %', p_run_id USING ERRCODE = '23503';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN RETURN 0; END IF;

  INSERT INTO public.backlink_domains (
    profile_id, workspace_id, domain, state, rank, spam_score, backlinks,
    broken_backlinks, referring_pages, referring_pages_nofollow, dofollow,
    tld, country, platform_types, meta, provider_first_seen, provider_lost_date,
    first_seen_run_id, last_seen_run_id, first_seen_at, last_seen_at
  )
  SELECT
    v_profile,
    v_workspace,
    lower(r->>'domain'),
    'live',
    nullif(r->>'rank', '')::integer,
    nullif(r->>'spamScore', '')::smallint,
    coalesce((r->>'backlinks')::integer, 0),
    coalesce((r->>'brokenBacklinks')::integer, 0),
    coalesce((r->>'referringPages')::integer, 0),
    coalesce((r->>'referringPagesNofollow')::integer, 0),
    coalesce((r->>'referringPagesNofollow')::integer, 0)
      < coalesce((r->>'referringPages')::integer, 0),
    nullif(r->>'tld', ''),
    nullif(r->>'country', ''),
    CASE WHEN jsonb_typeof(r->'platformTypes') = 'array'
         THEN ARRAY(SELECT jsonb_array_elements_text(r->'platformTypes'))
         ELSE NULL END,
    coalesce(r->'meta', '{}'::jsonb),
    nullif(r->>'firstSeen', '')::timestamptz,
    nullif(r->>'lostDate', '')::timestamptz,
    p_run_id,
    p_run_id,
    now(),
    now()
  FROM jsonb_array_elements(p_rows) AS r
  WHERE coalesce(r->>'domain', '') <> ''
  ON CONFLICT (profile_id, domain) DO UPDATE SET
    -- Keep the original discovery watermark: this domain is not new.
    first_seen_run_id = public.backlink_domains.first_seen_run_id,
    first_seen_at     = public.backlink_domains.first_seen_at,
    last_seen_run_id  = EXCLUDED.last_seen_run_id,
    last_seen_at      = EXCLUDED.last_seen_at,
    state             = 'live',
    -- Coming back from 'lost' is "regained", which is neither new nor lost.
    regained_at       = CASE WHEN public.backlink_domains.state = 'lost'
                             THEN now() ELSE public.backlink_domains.regained_at END,
    lost_at           = NULL,
    rank                     = EXCLUDED.rank,
    spam_score               = EXCLUDED.spam_score,
    backlinks                = EXCLUDED.backlinks,
    broken_backlinks         = EXCLUDED.broken_backlinks,
    referring_pages          = EXCLUDED.referring_pages,
    referring_pages_nofollow = EXCLUDED.referring_pages_nofollow,
    dofollow                 = EXCLUDED.dofollow,
    tld                      = EXCLUDED.tld,
    country                  = EXCLUDED.country,
    platform_types           = EXCLUDED.platform_types,
    meta                     = EXCLUDED.meta,
    provider_first_seen      = EXCLUDED.provider_first_seen,
    provider_lost_date       = EXCLUDED.provider_lost_date;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_backlink_domains(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_backlink_domains(uuid, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.upsert_backlink_links(
  p_run_id uuid,
  p_rows jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile uuid;
  v_workspace uuid;
  v_count integer;
BEGIN
  SELECT profile_id, workspace_id INTO v_profile, v_workspace
    FROM public.backlink_runs WHERE id = p_run_id;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'unknown backlink run %', p_run_id USING ERRCODE = '23503';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN RETURN 0; END IF;

  INSERT INTO public.backlink_links (
    profile_id, workspace_id, link_hash, domain_from, url_from, url_to, anchor,
    state, dofollow, item_type, attributes, rank, page_from_rank, domain_from_rank,
    spam_score, is_broken, url_to_status_code, page_from_title, semantic_location,
    country_from, provider_first_seen, provider_last_seen,
    first_seen_run_id, last_seen_run_id, first_seen_at, last_seen_at, lost_at
  )
  SELECT
    v_profile,
    v_workspace,
    r->>'linkHash',
    lower(r->>'domainFrom'),
    left(r->>'urlFrom', 2000),
    left(r->>'urlTo', 2000),
    left(nullif(r->>'anchor', ''), 500),
    -- DataForSEO's own is_lost is the ONLY source of 'lost' for a link: the
    -- 1000-row sample is never a complete enumeration, so absence proves nothing.
    CASE WHEN (r->>'isLost')::boolean THEN 'lost' ELSE 'live' END,
    coalesce((r->>'dofollow')::boolean, false),
    nullif(r->>'itemType', ''),
    CASE WHEN jsonb_typeof(r->'attributes') = 'array'
         THEN ARRAY(SELECT jsonb_array_elements_text(r->'attributes'))
         ELSE NULL END,
    nullif(r->>'rank', '')::integer,
    nullif(r->>'pageFromRank', '')::integer,
    nullif(r->>'domainFromRank', '')::integer,
    nullif(r->>'spamScore', '')::smallint,
    coalesce((r->>'isBroken')::boolean, false),
    nullif(r->>'urlToStatusCode', '')::integer,
    left(nullif(r->>'pageFromTitle', ''), 300),
    nullif(r->>'semanticLocation', ''),
    nullif(r->>'countryFrom', ''),
    nullif(r->>'firstSeen', '')::timestamptz,
    nullif(r->>'lastSeen', '')::timestamptz,
    p_run_id,
    p_run_id,
    now(),
    now(),
    CASE WHEN (r->>'isLost')::boolean THEN now() ELSE NULL END
  FROM jsonb_array_elements(p_rows) AS r
  WHERE coalesce(r->>'linkHash', '') <> ''
    AND coalesce(r->>'urlFrom', '') <> ''
    AND coalesce(r->>'urlTo', '') <> ''
  ON CONFLICT (profile_id, link_hash) DO UPDATE SET
    first_seen_run_id = public.backlink_links.first_seen_run_id,
    first_seen_at     = public.backlink_links.first_seen_at,
    last_seen_run_id  = EXCLUDED.last_seen_run_id,
    last_seen_at      = EXCLUDED.last_seen_at,
    state             = EXCLUDED.state,
    lost_at           = EXCLUDED.lost_at,
    dofollow             = EXCLUDED.dofollow,
    item_type            = EXCLUDED.item_type,
    attributes           = EXCLUDED.attributes,
    rank                 = EXCLUDED.rank,
    page_from_rank       = EXCLUDED.page_from_rank,
    domain_from_rank     = EXCLUDED.domain_from_rank,
    spam_score           = EXCLUDED.spam_score,
    is_broken            = EXCLUDED.is_broken,
    url_to_status_code   = EXCLUDED.url_to_status_code,
    page_from_title      = EXCLUDED.page_from_title,
    semantic_location    = EXCLUDED.semantic_location,
    country_from         = EXCLUDED.country_from,
    provider_first_seen  = EXCLUDED.provider_first_seen,
    provider_last_seen   = EXCLUDED.provider_last_seen;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_backlink_links(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_backlink_links(uuid, jsonb) TO service_role;

-- Scored columns only. Outreach drafts, notes, status and AI enrichment are
-- deliberately NOT touched: a refresh must never discard work a user has done.
CREATE OR REPLACE FUNCTION public.upsert_backlink_opportunities(
  p_run_id uuid,
  p_rows jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile uuid;
  v_workspace uuid;
  v_count integer;
BEGIN
  SELECT profile_id, workspace_id INTO v_profile, v_workspace
    FROM public.backlink_runs WHERE id = p_run_id;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'unknown backlink run %', p_run_id USING ERRCODE = '23503';
  END IF;
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN RETURN 0; END IF;

  INSERT INTO public.backlink_opportunities (
    profile_id, workspace_id, domain, kind, score, tier, factors, evidence,
    rank, spam_score, competitor_hits, excluded_reason, suggested_target,
    first_run_id, last_run_id
  )
  SELECT
    v_profile,
    v_workspace,
    lower(r->>'domain'),
    r->>'kind',
    coalesce((r->>'score')::numeric, 0),
    coalesce(r->>'tier', 'low'),
    coalesce(r->'factors', '{}'::jsonb),
    coalesce(r->'evidence', '{}'::jsonb),
    nullif(r->>'rank', '')::integer,
    nullif(r->>'spamScore', '')::smallint,
    coalesce((r->>'competitorHits')::smallint, 0),
    nullif(r->>'excludedReason', ''),
    nullif(r->>'suggestedTarget', ''),
    p_run_id,
    p_run_id
  FROM jsonb_array_elements(p_rows) AS r
  WHERE coalesce(r->>'domain', '') <> ''
  ON CONFLICT (profile_id, domain, kind) DO UPDATE SET
    score            = EXCLUDED.score,
    tier             = EXCLUDED.tier,
    factors          = EXCLUDED.factors,
    evidence         = EXCLUDED.evidence,
    rank             = EXCLUDED.rank,
    spam_score       = EXCLUDED.spam_score,
    competitor_hits  = EXCLUDED.competitor_hits,
    excluded_reason  = EXCLUDED.excluded_reason,
    suggested_target = EXCLUDED.suggested_target,
    last_run_id      = EXCLUDED.last_run_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_backlink_opportunities(uuid, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_backlink_opportunities(uuid, jsonb) TO service_role;
