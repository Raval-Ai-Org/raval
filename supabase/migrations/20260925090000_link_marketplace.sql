-- Link marketplace — buying real backlink placements through a fulfilment
-- provider, paid for with Mellox credits.
--
-- The provider (Rixot) has no basket-item removal, no idempotency key on its
-- order call, no per-order status endpoint and no webhooks, and ONE provider
-- account is shared by every Mellox workspace. Two invariants follow, and most
-- of this schema exists to hold them:
--
--   B  Basket exclusivity. When Mellox calls the provider's order endpoint the
--      provider basket is empty, and until the pay call returns exactly one
--      Mellox process may touch the provider. Enforced by provider_basket_lock.
--   R  No blind retry. The order and pay calls are never repeated on timeout.
--      An unknown outcome is resolved by READING the basket, which is why
--      provider ids are persisted the instant they arrive.
--
--   rixot_donors              global mirror of the provider catalog
--   link_orders               cart -> held -> ordered -> paid -> published
--   link_order_lines          one row per donor; the placement record
--   rixot_link_sightings      every link ever seen, so "new" is meaningful
--   link_order_events         append-only timeline
--   workspace_credit_balances materialised balance (speed)
--   workspace_credit_ledger   append-only truth (money)
--   provider_basket_lock      the global single-flight lease
--   billing_customers         workspace -> Stripe customer
--   stripe_events             webhook replay protection

-- ── Donor catalog ─────────────────────────────────────────────────────────
-- Deliberately NOT workspace-scoped: it is the provider's public catalog,
-- mirrored so ranking is a SQL query instead of 453 paginated HTTP calls.
CREATE TABLE IF NOT EXISTS public.rixot_donors (
  id bigint PRIMARY KEY,
  domain text NOT NULL,
  ext text,
  page text,
  domain_hidden boolean NOT NULL DEFAULT false,
  price_usd numeric(10,2) NOT NULL DEFAULT 0,
  dr smallint,
  referring_domains integer,
  backlinks bigint,
  dfs_rank integer,
  top100 integer,
  cat text,
  topic jsonb,
  topic_checked_at timestamptz,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  delisted_at timestamptz,
  CONSTRAINT rixot_donors_price_check CHECK (price_usd >= 0 AND price_usd <= 100000),
  CONSTRAINT rixot_donors_dr_check CHECK (dr IS NULL OR dr BETWEEN 0 AND 100),
  CONSTRAINT rixot_donors_domain_len CHECK (char_length(domain) BETWEEN 1 AND 253)
);

CREATE INDEX IF NOT EXISTS rixot_donors_live_idx
  ON public.rixot_donors (dfs_rank DESC) WHERE delisted_at IS NULL;
CREATE INDEX IF NOT EXISTS rixot_donors_domain_idx ON public.rixot_donors (domain);
CREATE INDEX IF NOT EXISTS rixot_donors_price_idx
  ON public.rixot_donors (price_usd) WHERE delisted_at IS NULL;
CREATE INDEX IF NOT EXISTS rixot_donors_stale_topic_idx
  ON public.rixot_donors (topic_checked_at NULLS FIRST) WHERE delisted_at IS NULL;

-- ── Orders ────────────────────────────────────────────────────────────────
-- workspace_id is ON DELETE RESTRICT, unlike the backlink_* tables: a money
-- record must never be erased as a side effect of deleting a workspace.
CREATE TABLE IF NOT EXISTS public.link_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  campaign_id uuid REFERENCES public.backlink_campaigns(id) ON DELETE SET NULL,

  target_url text NOT NULL,
  keyword text NOT NULL,
  language text NOT NULL DEFAULT 'en',
  content_mode text NOT NULL DEFAULT 'auto',
  recommendations text,
  own_title text,
  own_content text,

  status text NOT NULL DEFAULT 'cart',
  substate text,
  line_count integer NOT NULL DEFAULT 0,

  quoted_usd numeric(12,2) NOT NULL DEFAULT 0,
  provider_total_usd numeric(12,2),
  provider_charged_usd numeric(12,2),
  charged_is_estimated boolean NOT NULL DEFAULT false,
  balance_before_usd numeric(12,2),

  credit_rate numeric(12,6) NOT NULL DEFAULT 100,
  credits_held bigint NOT NULL DEFAULT 0,
  credits_captured bigint NOT NULL DEFAULT 0,
  credits_refunded bigint NOT NULL DEFAULT 0,

  provider_order_content_ids bigint[] NOT NULL DEFAULT '{}',
  provider_basket_ids bigint[] NOT NULL DEFAULT '{}',
  request_fingerprint text,

  locked_by text,
  lease_until timestamptz,
  lock_token uuid,
  attempt_count integer NOT NULL DEFAULT 0,
  order_post_attempts smallint NOT NULL DEFAULT 0,
  pay_post_attempts smallint NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  in_flight_since timestamptz,
  failure_code text,
  last_error text,
  needs_operator boolean NOT NULL DEFAULT false,
  operator_note text,

  idempotency_key text NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  checkout_at timestamptz,
  ordered_at timestamptz,
  paid_at timestamptz,
  settled_at timestamptz,

  CONSTRAINT link_orders_status_check CHECK (status IN (
    'cart', 'held', 'queued', 'awaiting_lock', 'preflight', 'ordering', 'ordered',
    'paying', 'paid', 'publishing', 'published', 'partially_published',
    'blocked_balance', 'needs_operator', 'failed', 'cancelled')),
  CONSTRAINT link_orders_mode_check CHECK (content_mode IN ('auto', 'prompt', 'own')),
  CONSTRAINT link_orders_own_mode CHECK (content_mode <> 'own' OR own_content IS NOT NULL),
  CONSTRAINT link_orders_line_count CHECK (line_count BETWEEN 0 AND 50),
  CONSTRAINT link_orders_money_check CHECK (quoted_usd >= 0),
  CONSTRAINT link_orders_rate_check CHECK (credit_rate > 0),
  CONSTRAINT link_orders_credits_check CHECK (
    credits_held >= 0 AND credits_captured >= 0 AND credits_refunded >= 0),
  -- Credits can never be settled twice.
  CONSTRAINT link_orders_credit_math CHECK (credits_captured + credits_refunded <= credits_held),
  -- A paid order knows what it paid for, or the pay call must not have run.
  CONSTRAINT link_orders_paid_has_proof CHECK (
    status NOT IN ('paid', 'publishing', 'published', 'partially_published')
    OR (paid_at IS NOT NULL AND array_length(provider_basket_ids, 1) IS NOT NULL)),
  CONSTRAINT link_orders_attempts CHECK (
    attempt_count <= 500 AND order_post_attempts <= 3 AND pay_post_attempts <= 3),
  CONSTRAINT link_orders_target_len CHECK (char_length(target_url) BETWEEN 8 AND 2048),
  CONSTRAINT link_orders_keyword_len CHECK (char_length(keyword) BETWEEN 1 AND 200),
  CONSTRAINT link_orders_idem_unique UNIQUE (workspace_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS link_orders_workspace_idx
  ON public.link_orders (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS link_orders_runnable_idx
  ON public.link_orders (next_attempt_at NULLS FIRST, created_at)
  WHERE status IN ('queued', 'awaiting_lock', 'preflight', 'ordering', 'ordered', 'paying');
CREATE INDEX IF NOT EXISTS link_orders_publishing_idx
  ON public.link_orders (paid_at) WHERE status IN ('paid', 'publishing');
CREATE INDEX IF NOT EXISTS link_orders_attention_idx
  ON public.link_orders (updated_at DESC) WHERE needs_operator;
CREATE INDEX IF NOT EXISTS link_orders_blocked_idx
  ON public.link_orders (updated_at DESC) WHERE status = 'blocked_balance';

-- ── Order lines (the placement record) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.link_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL REFERENCES public.link_orders(id) ON DELETE CASCADE,
  donor_id bigint NOT NULL REFERENCES public.rixot_donors(id) ON DELETE RESTRICT,
  donor_domain text NOT NULL,
  unit_price_usd numeric(10,2) NOT NULL,
  credits_price bigint NOT NULL,

  status text NOT NULL DEFAULT 'pending',
  provider_order_content_id bigint,
  provider_basket_id bigint,
  provider_link_id bigint,
  published_url text,
  published_at timestamptz,
  provider_cost_usd numeric(10,2),
  attribution text NOT NULL DEFAULT 'none',
  attribution_detail jsonb NOT NULL DEFAULT '{}'::jsonb,

  opportunity_id uuid REFERENCES public.backlink_opportunities(id) ON DELETE SET NULL,
  verification text NOT NULL DEFAULT 'pending',
  verified_at timestamptz,
  first_live_at timestamptz,
  lost_at timestamptz,
  consecutive_missing smallint NOT NULL DEFAULT 0,
  next_check_at timestamptz,
  give_up_at timestamptz,
  settled text NOT NULL DEFAULT 'open',

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT link_order_lines_status_check CHECK (status IN (
    'pending', 'in_basket', 'paid', 'awaiting_publication', 'published',
    'live', 'lost', 'unconfirmed', 'failed', 'cancelled')),
  CONSTRAINT link_order_lines_attribution_check CHECK (attribution IN (
    'none', 'basket_id', 'link_id', 'heuristic', 'ambiguous', 'operator')),
  CONSTRAINT link_order_lines_verification_check CHECK (verification IN (
    'pending', 'live', 'nofollow', 'missing', 'unreachable', 'blocked')),
  CONSTRAINT link_order_lines_settled_check CHECK (settled IN ('open', 'captured', 'refunded')),
  CONSTRAINT link_order_lines_price_check CHECK (unit_price_usd >= 0 AND credits_price >= 0),
  -- Mirrors backlink_opportunities_live_needs_proof: only a real check says live.
  CONSTRAINT link_order_lines_live_needs_proof
    CHECK (status <> 'live' OR verification IN ('live', 'nofollow')),
  -- A published line points at a real URL that a real link id was attributed to.
  CONSTRAINT link_order_lines_published_needs_link
    CHECK (status NOT IN ('published', 'live', 'lost')
           OR (published_url IS NOT NULL AND attribution <> 'none')),
  CONSTRAINT link_order_lines_unique UNIQUE (order_id, donor_id)
);

-- Two lines may never claim the same provider row.
CREATE UNIQUE INDEX IF NOT EXISTS link_order_lines_provider_link_unique
  ON public.link_order_lines (provider_link_id) WHERE provider_link_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS link_order_lines_basket_unique
  ON public.link_order_lines (provider_basket_id) WHERE provider_basket_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS link_order_lines_order_idx
  ON public.link_order_lines (order_id, created_at);
CREATE INDEX IF NOT EXISTS link_order_lines_awaiting_idx
  ON public.link_order_lines (give_up_at) WHERE status = 'awaiting_publication';
CREATE INDEX IF NOT EXISTS link_order_lines_recheck_idx
  ON public.link_order_lines (next_check_at) WHERE status IN ('published', 'live');
CREATE INDEX IF NOT EXISTS link_order_lines_workspace_idx
  ON public.link_order_lines (workspace_id, updated_at DESC);

-- ── Provider link sightings ───────────────────────────────────────────────
-- The provider's link list is a full list with no cursor, so "new" can only
-- mean "an id we have never seen". This table is also the evidence that an
-- unattributable link existed, which is the honest alternative to guessing.
CREATE TABLE IF NOT EXISTS public.rixot_link_sightings (
  link_id bigint PRIMARY KEY,
  target_url text,
  keyword text,
  published_url text,
  published_host text,
  status text,
  cost_usd numeric(10,2),
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  claimed_by uuid REFERENCES public.link_order_lines(id) ON DELETE SET NULL,
  claimed_at timestamptz,
  claim_method text,
  unclaimed_reason text,
  CONSTRAINT rixot_link_sightings_method_check CHECK (
    claim_method IS NULL OR claim_method IN ('link_id', 'heuristic', 'ambiguous', 'operator'))
);

CREATE INDEX IF NOT EXISTS rixot_link_sightings_unclaimed_idx
  ON public.rixot_link_sightings (first_seen_at) WHERE claimed_by IS NULL;
CREATE INDEX IF NOT EXISTS rixot_link_sightings_match_idx
  ON public.rixot_link_sightings (published_host, cost_usd) WHERE claimed_by IS NULL;

-- ── Events ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.link_order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL REFERENCES public.link_orders(id) ON DELETE CASCADE,
  line_id uuid REFERENCES public.link_order_lines(id) ON DELETE CASCADE,
  type text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT link_order_events_type_check CHECK (type IN (
    'cart_changed', 'checkout', 'credits_held', 'credits_released', 'queued',
    'lock_acquired', 'lock_lost', 'preflight_ok', 'preflight_failed',
    'order_submitted', 'order_confirmed', 'order_unknown',
    'basket_reconciled', 'basket_foreign_item',
    'pay_submitted', 'pay_confirmed', 'pay_unknown', 'pay_failed',
    'credits_captured', 'credits_refunded', 'link_attributed', 'verification',
    'link_lost', 'gave_up', 'operator_action', 'cancelled', 'failed'))
);

CREATE INDEX IF NOT EXISTS link_order_events_order_idx ON public.link_order_events (order_id, at);
CREATE INDEX IF NOT EXISTS link_order_events_workspace_idx
  ON public.link_order_events (workspace_id, at DESC);

-- ── Credits ───────────────────────────────────────────────────────────────
-- Credits are integers. The ledger is truth; the balance table is a
-- materialised view maintained inside the same transaction as the ledger row.
CREATE TABLE IF NOT EXISTS public.workspace_credit_balances (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  available bigint NOT NULL DEFAULT 0,
  held bigint NOT NULL DEFAULT 0,
  lifetime_topped_up bigint NOT NULL DEFAULT 0,
  lifetime_spent bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_credit_balances_nonneg CHECK (available >= 0 AND held >= 0)
);

CREATE TABLE IF NOT EXISTS public.workspace_credit_ledger (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  kind text NOT NULL,
  delta_available bigint NOT NULL,
  delta_held bigint NOT NULL,
  balance_after bigint NOT NULL,
  held_after bigint NOT NULL,
  order_id uuid REFERENCES public.link_orders(id) ON DELETE SET NULL,
  line_id uuid REFERENCES public.link_order_lines(id) ON DELETE SET NULL,
  reason text,
  actor uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_credit_ledger_kind_check CHECK (kind IN (
    'topup', 'hold', 'release', 'capture', 'refund', 'adjustment')),
  CONSTRAINT workspace_credit_ledger_reason_len
    CHECK (reason IS NULL OR char_length(reason) <= 300),
  CONSTRAINT workspace_credit_ledger_idem UNIQUE (workspace_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS workspace_credit_ledger_ws_idx
  ON public.workspace_credit_ledger (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS workspace_credit_ledger_order_idx
  ON public.workspace_credit_ledger (order_id, created_at);

-- The ledger is append-only even for service_role. A money row that can be
-- edited is not a ledger.
CREATE OR REPLACE FUNCTION private.credit_ledger_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'workspace_credit_ledger is append-only' USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION private.credit_ledger_append_only() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS workspace_credit_ledger_immutable ON public.workspace_credit_ledger;
CREATE TRIGGER workspace_credit_ledger_immutable
  BEFORE UPDATE OR DELETE ON public.workspace_credit_ledger
  FOR EACH ROW EXECUTE FUNCTION private.credit_ledger_append_only();

-- ── Billing ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.billing_customers (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE RESTRICT,
  stripe_customer_id text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Replay protection: a Stripe event is credited at most once, ever.
CREATE TABLE IF NOT EXISTS public.stripe_events (
  id text PRIMARY KEY,
  type text NOT NULL,
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  error text
);

CREATE INDEX IF NOT EXISTS stripe_events_unprocessed_idx
  ON public.stripe_events (received_at) WHERE processed_at IS NULL;

-- ── The global provider lock ──────────────────────────────────────────────
-- A lease row rather than an advisory lock: the critical section spans several
-- HTTP round-trips, so it cannot live inside one transaction; session locks are
-- unusable behind a connection pooler; and an operator must be able to ask
-- "who holds the basket, since when, for which order" in SQL.
CREATE TABLE IF NOT EXISTS public.provider_basket_lock (
  provider text PRIMARY KEY,
  holder text,
  token uuid,
  order_id uuid REFERENCES public.link_orders(id) ON DELETE SET NULL,
  phase text,
  acquired_at timestamptz,
  lease_until timestamptz,
  renewed_at timestamptz,
  released_at timestamptz,
  takeover_count integer NOT NULL DEFAULT 0,
  quarantined boolean NOT NULL DEFAULT false,
  quarantine_reason text,
  quarantined_at timestamptz
);

INSERT INTO public.provider_basket_lock (provider) VALUES ('rixot')
  ON CONFLICT (provider) DO NOTHING;

-- ── Paid placements reuse the existing backlink vocabulary ────────────────
-- A bought placement is still a backlink, so it lives in backlink_opportunities
-- and inherits the timeline, the verification history and the campaign counts.
ALTER TABLE public.backlink_opportunities
  DROP CONSTRAINT IF EXISTS backlink_opportunities_kind_check;
ALTER TABLE public.backlink_opportunities
  ADD CONSTRAINT backlink_opportunities_kind_check
  CHECK (kind IN ('competitor_gap', 'reclaim', 'broken', 'resource_page',
                  'directory', 'paid_placement'));

ALTER TABLE public.backlink_opportunities
  DROP CONSTRAINT IF EXISTS backlink_opportunities_method_check;
ALTER TABLE public.backlink_opportunities
  ADD CONSTRAINT backlink_opportunities_method_check
  CHECK (method IS NULL OR method IN ('outreach', 'resource_submission',
                                      'broken_link_replacement', 'guest_contribution',
                                      'self_publish', 'paid_placement'));

-- ── RLS ───────────────────────────────────────────────────────────────────
-- Members read their own rows; every write goes through a server path.
ALTER TABLE public.rixot_donors              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.link_orders               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.link_order_lines          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.link_order_events         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rixot_link_sightings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_credit_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_credit_ledger   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.provider_basket_lock      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_customers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_events             ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.rixot_donors, public.link_orders, public.link_order_lines,
               public.link_order_events, public.rixot_link_sightings,
               public.workspace_credit_balances, public.workspace_credit_ledger,
               public.provider_basket_lock, public.billing_customers,
               public.stripe_events
  FROM anon, authenticated;

-- The catalog is the only table a member may read wholesale: it is the shop
-- window. Everything else is workspace-scoped.
GRANT SELECT ON public.rixot_donors TO authenticated;

GRANT SELECT ON public.link_orders, public.link_order_lines, public.link_order_events,
                public.workspace_credit_balances, public.workspace_credit_ledger
  TO authenticated;

-- rixot_link_sightings, provider_basket_lock, billing_customers and
-- stripe_events are operational: no member ever reads them.
GRANT ALL ON public.rixot_donors, public.link_orders, public.link_order_lines,
             public.link_order_events, public.rixot_link_sightings,
             public.workspace_credit_balances, public.workspace_credit_ledger,
             public.provider_basket_lock, public.billing_customers,
             public.stripe_events
  TO service_role;

DROP POLICY IF EXISTS "Anyone signed in reads the donor catalog" ON public.rixot_donors;
CREATE POLICY "Anyone signed in reads the donor catalog"
  ON public.rixot_donors FOR SELECT TO authenticated
  USING (delisted_at IS NULL);

DROP POLICY IF EXISTS "Workspace members read link orders" ON public.link_orders;
CREATE POLICY "Workspace members read link orders"
  ON public.link_orders FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Workspace members read link order lines" ON public.link_order_lines;
CREATE POLICY "Workspace members read link order lines"
  ON public.link_order_lines FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Workspace members read link order events" ON public.link_order_events;
CREATE POLICY "Workspace members read link order events"
  ON public.link_order_events FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Workspace members read credit balance" ON public.workspace_credit_balances;
CREATE POLICY "Workspace members read credit balance"
  ON public.workspace_credit_balances FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Workspace members read credit ledger" ON public.workspace_credit_ledger;
CREATE POLICY "Workspace members read credit ledger"
  ON public.workspace_credit_ledger FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

-- ── Cross-workspace guards ────────────────────────────────────────────────
-- A service-path bug must fail rather than cross tenants.
CREATE OR REPLACE FUNCTION private.link_order_workspace_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ws uuid;
BEGIN
  SELECT workspace_id INTO v_ws FROM public.link_orders WHERE id = NEW.order_id;
  IF v_ws IS NULL OR v_ws <> NEW.workspace_id THEN
    RAISE EXCEPTION 'link row workspace does not match its order' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.link_order_workspace_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS link_order_lines_workspace_guard ON public.link_order_lines;
CREATE TRIGGER link_order_lines_workspace_guard
  BEFORE INSERT OR UPDATE OF workspace_id, order_id ON public.link_order_lines
  FOR EACH ROW EXECUTE FUNCTION private.link_order_workspace_guard();

DROP TRIGGER IF EXISTS link_order_events_workspace_guard ON public.link_order_events;
CREATE TRIGGER link_order_events_workspace_guard
  BEFORE INSERT OR UPDATE OF workspace_id, order_id ON public.link_order_events
  FOR EACH ROW EXECUTE FUNCTION private.link_order_workspace_guard();

DROP TRIGGER IF EXISTS link_orders_touch_updated_at ON public.link_orders;
CREATE TRIGGER link_orders_touch_updated_at
  BEFORE UPDATE ON public.link_orders
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

DROP TRIGGER IF EXISTS link_order_lines_touch_updated_at ON public.link_order_lines;
CREATE TRIGGER link_order_lines_touch_updated_at
  BEFORE UPDATE ON public.link_order_lines
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
