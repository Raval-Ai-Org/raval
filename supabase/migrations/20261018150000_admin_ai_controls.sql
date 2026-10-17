-- Mellox admin panel, phase 3 (rest): AI model routing overrides and spend caps.
--
-- Routing: a row changes which model(s) or reasoning effort a route uses. It
-- sits BELOW the AI_MODEL_<ROUTE>/AI_EFFORT_<ROUTE> env vars and above the
-- registry in src/server/ai/task-models.ts, which stays the baseline. The app
-- only accepts models the registry already uses (checked in code).
-- Caps: a global and per-workspace spend ceiling in USD, enforced inside
-- checkBudget (src/server/ai/budget.ts) with the same fail-open rule.
--
-- Same rules as the other admin migrations: a change and its audit row are
-- written in one transaction; service-role only; idempotent.

CREATE TABLE IF NOT EXISTS public.model_route_overrides (
  route_key  text PRIMARY KEY
    CONSTRAINT model_route_overrides_key_len CHECK (char_length(route_key) BETWEEN 1 AND 80),
  models     text[]
    CONSTRAINT model_route_overrides_models_len CHECK (models IS NULL OR cardinality(models) BETWEEN 1 AND 4),
  effort     text
    CONSTRAINT model_route_overrides_effort_check CHECK (effort IS NULL OR effort IN ('low', 'medium', 'high')),
  reason     text CONSTRAINT model_route_overrides_reason_len CHECK (reason IS NULL OR char_length(reason) <= 500),
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT model_route_overrides_something CHECK (models IS NOT NULL OR effort IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS public.spend_caps (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope        text NOT NULL CONSTRAINT spend_caps_scope_check CHECK (scope IN ('global', 'workspace')),
  workspace_id uuid REFERENCES public.workspaces (id) ON DELETE CASCADE,
  daily_usd    numeric(12, 2) CONSTRAINT spend_caps_daily_check CHECK (daily_usd IS NULL OR daily_usd >= 0),
  monthly_usd  numeric(12, 2) CONSTRAINT spend_caps_monthly_check CHECK (monthly_usd IS NULL OR monthly_usd >= 0),
  reason       text CONSTRAINT spend_caps_reason_len CHECK (reason IS NULL OR char_length(reason) <= 500),
  updated_by   uuid,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT spend_caps_scope_target CHECK (
    (scope = 'global' AND workspace_id IS NULL) OR (scope = 'workspace' AND workspace_id IS NOT NULL)),
  CONSTRAINT spend_caps_something CHECK (daily_usd IS NOT NULL OR monthly_usd IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS spend_caps_one_global ON public.spend_caps (scope) WHERE scope = 'global';
CREATE UNIQUE INDEX IF NOT EXISTS spend_caps_one_per_workspace
  ON public.spend_caps (workspace_id) WHERE scope = 'workspace';

ALTER TABLE public.model_route_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spend_caps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.model_route_overrides, public.spend_caps FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.model_route_overrides, public.spend_caps TO service_role;

/* ───────────────────────────── routing save ───────────────────────────── */

-- Both models and effort NULL removes the override (the route returns to the
-- registry's plan).
CREATE OR REPLACE FUNCTION public.admin_route_override_set(
  p_actor uuid,
  p_actor_role text,
  p_route text,
  p_models text[],
  p_effort text,
  p_reason text,
  p_request_id text,
  p_ip text,
  p_user_agent text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_before public.model_route_overrides%ROWTYPE;
BEGIN
  IF char_length(btrim(coalesce(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'A reason of at least 10 characters is required.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_before FROM public.model_route_overrides WHERE route_key = p_route FOR UPDATE;

  IF p_models IS NULL AND p_effort IS NULL THEN
    DELETE FROM public.model_route_overrides WHERE route_key = p_route;
  ELSE
    INSERT INTO public.model_route_overrides (route_key, models, effort, reason, updated_by)
      VALUES (p_route, p_models, p_effort, btrim(p_reason), p_actor)
    ON CONFLICT (route_key) DO UPDATE SET
      models = excluded.models, effort = excluded.effort, reason = excluded.reason,
      updated_by = excluded.updated_by, updated_at = now();
  END IF;

  PERFORM private.admin_audit_write(
    p_actor, p_actor_role,
    CASE WHEN p_models IS NULL AND p_effort IS NULL THEN 'ai.route_override_cleared'
         ELSE 'ai.route_override_set' END,
    'ai_route', p_route, NULL,
    CASE WHEN v_before.route_key IS NULL THEN NULL
         ELSE jsonb_build_object('models', v_before.models, 'effort', v_before.effort) END,
    jsonb_build_object('models', p_models, 'effort', p_effort),
    p_reason, p_request_id, p_ip, p_user_agent);

  RETURN jsonb_build_object('route', p_route, 'cleared', p_models IS NULL AND p_effort IS NULL);
END;
$$;

/* ───────────────────────────── spend caps save ───────────────────────────── */

-- Both limits NULL removes the cap.
CREATE OR REPLACE FUNCTION public.admin_spend_cap_set(
  p_actor uuid,
  p_actor_role text,
  p_scope text,
  p_workspace uuid,
  p_daily numeric,
  p_monthly numeric,
  p_reason text,
  p_request_id text,
  p_ip text,
  p_user_agent text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_before public.spend_caps%ROWTYPE;
BEGIN
  IF char_length(btrim(coalesce(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'A reason of at least 10 characters is required.' USING ERRCODE = '22023';
  END IF;
  IF p_scope NOT IN ('global', 'workspace') THEN
    RAISE EXCEPTION 'Unknown scope.' USING ERRCODE = '22023';
  END IF;
  IF p_scope = 'workspace' AND NOT EXISTS (SELECT 1 FROM public.workspaces WHERE id = p_workspace) THEN
    RAISE EXCEPTION 'No such workspace.' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_before FROM public.spend_caps
   WHERE scope = p_scope AND workspace_id IS NOT DISTINCT FROM (CASE WHEN p_scope = 'global' THEN NULL ELSE p_workspace END)
   FOR UPDATE;

  DELETE FROM public.spend_caps
   WHERE scope = p_scope AND workspace_id IS NOT DISTINCT FROM (CASE WHEN p_scope = 'global' THEN NULL ELSE p_workspace END);

  IF p_daily IS NOT NULL OR p_monthly IS NOT NULL THEN
    INSERT INTO public.spend_caps (scope, workspace_id, daily_usd, monthly_usd, reason, updated_by)
    VALUES (p_scope, CASE WHEN p_scope = 'global' THEN NULL ELSE p_workspace END,
            p_daily, p_monthly, btrim(p_reason), p_actor);
  END IF;

  PERFORM private.admin_audit_write(
    p_actor, p_actor_role,
    CASE WHEN p_daily IS NULL AND p_monthly IS NULL THEN 'ai.spend_cap_removed' ELSE 'ai.spend_cap_set' END,
    'spend_cap', p_scope, CASE WHEN p_scope = 'workspace' THEN p_workspace END,
    CASE WHEN v_before.id IS NULL THEN NULL
         ELSE jsonb_build_object('daily_usd', v_before.daily_usd, 'monthly_usd', v_before.monthly_usd) END,
    jsonb_build_object('daily_usd', p_daily, 'monthly_usd', p_monthly),
    p_reason, p_request_id, p_ip, p_user_agent);

  RETURN jsonb_build_object('scope', p_scope, 'removed', p_daily IS NULL AND p_monthly IS NULL);
END;
$$;

/* ───────────────────────────── runtime read ───────────────────────────── */

-- Whole-platform estimated spend since a moment, for the global cap. Uses the
-- created_at index of ai_usage_events.
CREATE OR REPLACE FUNCTION public.platform_spend_since(p_since timestamptz)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(sum(est_cost_usd), 0) FROM public.ai_usage_events WHERE created_at >= p_since;
$$;

REVOKE ALL ON FUNCTION
  public.admin_route_override_set(uuid, text, text, text[], text, text, text, text, text),
  public.admin_spend_cap_set(uuid, text, text, uuid, numeric, numeric, text, text, text, text),
  public.platform_spend_since(timestamptz)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION
  public.admin_route_override_set(uuid, text, text, text[], text, text, text, text, text),
  public.admin_spend_cap_set(uuid, text, text, uuid, numeric, numeric, text, text, text, text),
  public.platform_spend_since(timestamptz)
  TO service_role;
