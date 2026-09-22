-- Link marketplace RPCs — the three things that must be atomic.
--
--   apply_credit_entry        money moves, exactly once per idempotency key
--   acquire/renew/release/quarantine_provider_lock
--                             the global single-flight lease over the shared
--                             provider basket, with a fencing token
--   claim_link_orders         SKIP LOCKED work claiming, per geo_scans
--
-- All are SECURITY DEFINER and granted to service_role only. Nothing here is
-- reachable from a browser: RLS gives members SELECT and nothing else.

-- ── Credits ───────────────────────────────────────────────────────────────
-- One decision at a time per workspace, and a replay of the same idempotency
-- key is an exact no-op that returns the original row. Keys are derived from
-- row ids (order:<id>:hold, line:<id>:capture, topup:<payment_intent>), never
-- from timestamps or attempt counters, so a crash-and-retry is always safe.
CREATE OR REPLACE FUNCTION public.apply_credit_entry(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ws uuid := nullif(p ->> 'workspace_id', '')::uuid;
  v_kind text := p ->> 'kind';
  v_key text := p ->> 'idempotency_key';
  v_da bigint := coalesce((p ->> 'delta_available')::bigint, 0);
  v_dh bigint := coalesce((p ->> 'delta_held')::bigint, 0);
  v_existing public.workspace_credit_ledger%ROWTYPE;
  v_bal public.workspace_credit_balances%ROWTYPE;
  v_new_available bigint;
  v_new_held bigint;
  v_id bigint;
BEGIN
  IF v_ws IS NULL OR v_key IS NULL OR v_kind IS NULL
     OR v_kind NOT IN ('topup', 'hold', 'release', 'capture', 'refund', 'adjustment') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid',
                              'reason', 'Invalid credit entry.');
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('credits:' || v_ws::text));

  SELECT * INTO v_existing
    FROM public.workspace_credit_ledger
   WHERE workspace_id = v_ws AND idempotency_key = v_key;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'replayed', true, 'id', v_existing.id,
                              'available', v_existing.balance_after,
                              'held', v_existing.held_after);
  END IF;

  INSERT INTO public.workspace_credit_balances (workspace_id) VALUES (v_ws)
    ON CONFLICT (workspace_id) DO NOTHING;

  SELECT * INTO v_bal
    FROM public.workspace_credit_balances WHERE workspace_id = v_ws FOR UPDATE;

  v_new_available := v_bal.available + v_da;
  v_new_held := v_bal.held + v_dh;

  IF v_new_available < 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'insufficient',
      'available', v_bal.available, 'held', v_bal.held, 'needed', -v_da,
      'reason', 'Not enough credits.');
  END IF;
  -- A held balance going negative means a double release or a double capture.
  -- Refuse rather than quietly rebalance: the ledger is the audit trail.
  IF v_new_held < 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'held_underflow',
      'available', v_bal.available, 'held', v_bal.held,
      'reason', 'Credit hold accounting is inconsistent.');
  END IF;

  UPDATE public.workspace_credit_balances
     SET available = v_new_available,
         held = v_new_held,
         lifetime_topped_up = lifetime_topped_up
           + (CASE WHEN v_kind = 'topup' THEN greatest(v_da, 0) ELSE 0 END),
         lifetime_spent = lifetime_spent
           + (CASE WHEN v_kind = 'capture' THEN greatest(-v_dh, 0) ELSE 0 END),
         updated_at = now()
   WHERE workspace_id = v_ws;

  INSERT INTO public.workspace_credit_ledger (
    workspace_id, kind, delta_available, delta_held, balance_after, held_after,
    order_id, line_id, reason, actor, idempotency_key
  ) VALUES (
    v_ws, v_kind, v_da, v_dh, v_new_available, v_new_held,
    nullif(p ->> 'order_id', '')::uuid,
    nullif(p ->> 'line_id', '')::uuid,
    left(coalesce(p ->> 'reason', ''), 300),
    nullif(p ->> 'actor', '')::uuid,
    v_key
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'replayed', false, 'id', v_id,
                            'available', v_new_available, 'held', v_new_held);
END;
$$;

REVOKE ALL ON FUNCTION public.apply_credit_entry(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_credit_entry(jsonb) TO service_role;

-- ── Provider lock ─────────────────────────────────────────────────────────
-- Returns a fencing token. Every subsequent write the holder makes carries it,
-- so a process that wakes up after being taken over cannot corrupt state.
-- p_order_id defaults to NULL: the lock is also taken for maintenance and for
-- reconciliation passes, neither of which has an order to name.
CREATE OR REPLACE FUNCTION public.acquire_provider_lock(
  p_provider text,
  p_holder text,
  p_order_id uuid DEFAULT NULL,
  p_lease_seconds integer DEFAULT 180
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.provider_basket_lock%ROWTYPE;
  v_token uuid;
  v_takeover boolean := false;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('provider_basket_lock:' || p_provider));

  SELECT * INTO v_row FROM public.provider_basket_lock
   WHERE provider = p_provider FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'code', 'unknown_provider');
  END IF;

  IF v_row.quarantined THEN
    RETURN jsonb_build_object('ok', false, 'code', 'quarantined',
                              'reason', v_row.quarantine_reason);
  END IF;

  IF v_row.token IS NOT NULL AND v_row.lease_until > now() THEN
    RETURN jsonb_build_object('ok', false, 'code', 'busy',
      'holder', v_row.holder, 'order_id', v_row.order_id,
      'lease_until', v_row.lease_until);
  END IF;

  -- A live token whose lease has expired means the previous holder died.
  v_takeover := v_row.token IS NOT NULL AND v_row.released_at IS NULL;
  v_token := gen_random_uuid();

  UPDATE public.provider_basket_lock
     SET holder = p_holder,
         token = v_token,
         order_id = p_order_id,
         phase = 'acquired',
         acquired_at = now(),
         renewed_at = now(),
         released_at = NULL,
         lease_until = now() + make_interval(secs => greatest(p_lease_seconds, 60)),
         takeover_count = takeover_count + (CASE WHEN v_takeover THEN 1 ELSE 0 END)
   WHERE provider = p_provider;

  RETURN jsonb_build_object('ok', true, 'token', v_token, 'takeover', v_takeover,
                            'previous_order_id', v_row.order_id);
END;
$$;

REVOKE ALL ON FUNCTION public.acquire_provider_lock(text, text, uuid, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_provider_lock(text, text, uuid, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.renew_provider_lock(
  p_provider text,
  p_token uuid,
  p_phase text DEFAULT NULL,
  p_lease_seconds integer DEFAULT 180
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ok boolean;
BEGIN
  UPDATE public.provider_basket_lock
     SET lease_until = now() + make_interval(secs => greatest(p_lease_seconds, 60)),
         renewed_at = now(),
         phase = coalesce(p_phase, phase)
   WHERE provider = p_provider AND token = p_token AND lease_until > now()
     AND NOT quarantined;
  GET DIAGNOSTICS v_ok = ROW_COUNT;
  RETURN v_ok;
END;
$$;

REVOKE ALL ON FUNCTION public.renew_provider_lock(text, uuid, text, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.renew_provider_lock(text, uuid, text, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.release_provider_lock(p_provider text, p_token uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ok boolean;
BEGIN
  UPDATE public.provider_basket_lock
     SET token = NULL, holder = NULL, order_id = NULL, phase = 'idle',
         released_at = now(), lease_until = NULL
   WHERE provider = p_provider AND token = p_token;
  GET DIAGNOSTICS v_ok = ROW_COUNT;
  RETURN v_ok;
END;
$$;

REVOKE ALL ON FUNCTION public.release_provider_lock(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_provider_lock(text, uuid) TO service_role;

-- Quarantine halts every order cycle. It is deliberately not self-clearing:
-- a stuck queue is recoverable, an unattributed charge is not.
CREATE OR REPLACE FUNCTION public.quarantine_provider_lock(
  p_provider text,
  p_reason text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.provider_basket_lock
     SET quarantined = true,
         quarantine_reason = left(coalesce(p_reason, 'unspecified'), 500),
         quarantined_at = now(),
         phase = 'quarantined',
         token = NULL, holder = NULL, lease_until = NULL, released_at = now()
   WHERE provider = p_provider;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.quarantine_provider_lock(text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quarantine_provider_lock(text, text) TO service_role;

-- ── Work claiming ─────────────────────────────────────────────────────────
-- Same shape as claim_geo_scans: SKIP LOCKED, a per-order lease, an attempt
-- counter. Orders that asked to be retried later are skipped until then.
CREATE OR REPLACE FUNCTION public.claim_link_orders(
  p_worker text,
  p_max integer DEFAULT 1,
  p_lease_seconds integer DEFAULT 180,
  p_order_id uuid DEFAULT NULL
)
RETURNS SETOF public.link_orders
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.link_orders AS o
     SET lease_until = now() + make_interval(secs => greatest(p_lease_seconds, 30)),
         locked_by = p_worker,
         attempt_count = o.attempt_count + 1
   WHERE o.id IN (
     SELECT x.id FROM public.link_orders x
      WHERE x.status IN ('queued', 'awaiting_lock', 'preflight', 'ordering',
                         'ordered', 'paying')
        AND (p_order_id IS NULL OR x.id = p_order_id)
        AND (x.lease_until IS NULL OR x.lease_until < now())
        AND (x.next_attempt_at IS NULL OR x.next_attempt_at <= now())
        AND x.attempt_count < 500
      ORDER BY x.created_at
      LIMIT greatest(p_max, 0)
      FOR UPDATE SKIP LOCKED)
  RETURNING o.*;
$$;

REVOKE ALL ON FUNCTION public.claim_link_orders(text, integer, integer, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_link_orders(text, integer, integer, uuid) TO service_role;

-- ── Catalog sync ──────────────────────────────────────────────────────────
-- One statement per page of the provider catalog. Deliberately does not touch
-- `topic`/`topic_checked_at`: a re-sync must not throw away a relevance read
-- that cost an AI call.
CREATE OR REPLACE FUNCTION public.upsert_rixot_donors(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  INSERT INTO public.rixot_donors AS d (
    id, domain, ext, page, domain_hidden, price_usd, dr,
    referring_domains, backlinks, dfs_rank, top100, cat, last_seen_at, delisted_at
  )
  SELECT (r ->> 'id')::bigint,
         r ->> 'domain',
         nullif(r ->> 'ext', ''),
         nullif(r ->> 'page', ''),
         coalesce((r ->> 'domain_hidden')::boolean, false),
         coalesce((r ->> 'price_usd')::numeric, 0),
         nullif(r ->> 'dr', '')::smallint,
         nullif(r ->> 'referring_domains', '')::integer,
         nullif(r ->> 'backlinks', '')::bigint,
         nullif(r ->> 'dfs_rank', '')::integer,
         nullif(r ->> 'top100', '')::integer,
         nullif(r ->> 'cat', ''),
         now(),
         NULL
    FROM jsonb_array_elements(p_rows) AS r
   WHERE (r ->> 'id') IS NOT NULL AND (r ->> 'domain') IS NOT NULL
  ON CONFLICT (id) DO UPDATE
     SET domain = EXCLUDED.domain,
         ext = EXCLUDED.ext,
         page = EXCLUDED.page,
         domain_hidden = EXCLUDED.domain_hidden,
         price_usd = EXCLUDED.price_usd,
         dr = EXCLUDED.dr,
         referring_domains = EXCLUDED.referring_domains,
         backlinks = EXCLUDED.backlinks,
         dfs_rank = EXCLUDED.dfs_rank,
         top100 = EXCLUDED.top100,
         cat = EXCLUDED.cat,
         last_seen_at = now(),
         delisted_at = NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_rixot_donors(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_rixot_donors(jsonb) TO service_role;

-- A donor that a full sync did not see is delisted, not deleted: order lines
-- reference it (ON DELETE RESTRICT) and a placement bought last month must
-- still render.
CREATE OR REPLACE FUNCTION public.sweep_rixot_donors(p_before timestamptz)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.rixot_donors
     SET delisted_at = now()
   WHERE last_seen_at < p_before AND delisted_at IS NULL;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.sweep_rixot_donors(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_rixot_donors(timestamptz) TO service_role;
