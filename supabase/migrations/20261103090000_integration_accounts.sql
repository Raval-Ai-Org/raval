-- Integration accounts — apps a workspace connects through Composio
-- (ADR-0042, docs/integrations.md).
--
--   integration_accounts     one row per connected app account per workspace.
--                            No credentials are stored here or anywhere in
--                            Mellox: Composio holds and refreshes the tokens,
--                            Mellox keeps only Composio's account id. The row
--                            is created as 'pending' when the sign-in link is
--                            made, so the Composio id is bound to the
--                            workspace before the person ever returns.
--   integration_tool_calls   append-only record of every app action Mellox ran
--                            (usage, cost and audit). Identifiers and outcomes
--                            only; never content, tokens or keys.
--   social_accounts          gains integration_account_id, so a social network
--                            connected through Composio is an ordinary
--                            publishing target everywhere else.
--
-- The Composio user id of a workspace is derived ('mellox_ws_<id>'), never
-- stored, so one brand's connections can never be read through another's.
-- Writes come only from the server (service role) after role checks; members
-- read their workspace's accounts. Sign-in state reuses connector_install_states.
--
-- Idempotent and non-destructive: safe to re-run.

CREATE TABLE IF NOT EXISTS public.integration_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- Catalog id (src/lib/integrations/catalog.ts), e.g. 'hubspot', 'instagram'.
  app text NOT NULL,
  -- Composio toolkit slug the account was made with.
  toolkit text NOT NULL,
  composio_account_id text NOT NULL,
  auth_config_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  -- What the person sees: the account's name, handle or email as the app reports it.
  label text,
  -- The app's own id for the account (page id, portal id, channel id), when read.
  external_id text,
  scopes text[] NOT NULL DEFAULT '{}'::text[],
  connected_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  connected_at timestamptz,
  last_checked_at timestamptz,
  last_error text,
  revoked_at timestamptz,
  revoked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integration_accounts_status_check
    CHECK (status IN ('pending', 'active', 'reconnect_required', 'disconnected', 'error')),
  CONSTRAINT integration_accounts_error_length
    CHECK (last_error IS NULL OR char_length(last_error) <= 500),
  CONSTRAINT integration_accounts_label_length
    CHECK (label IS NULL OR char_length(label) <= 200),
  CONSTRAINT integration_accounts_composio_unique UNIQUE (composio_account_id)
);

CREATE INDEX IF NOT EXISTS integration_accounts_workspace_idx
  ON public.integration_accounts (workspace_id, app, status);
-- The status sweep reads the oldest-checked active accounts first.
CREATE INDEX IF NOT EXISTS integration_accounts_check_idx
  ON public.integration_accounts (last_checked_at NULLS FIRST)
  WHERE status IN ('active', 'reconnect_required');

CREATE TABLE IF NOT EXISTS public.integration_tool_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  account_id uuid REFERENCES public.integration_accounts(id) ON DELETE SET NULL,
  -- null for background work (the worker acts for the workspace)
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  app text NOT NULL,
  tool text NOT NULL,
  is_write boolean NOT NULL DEFAULT false,
  ok boolean NOT NULL,
  -- 'auth' | 'rate_limited' | 'unknown_outcome' | 'provider_error' | 'refused' ...
  error_code text,
  duration_ms integer NOT NULL DEFAULT 0,
  -- Composio's execution log id, for support.
  log_id text,
  -- What asked for it: 'chat', 'publish', 'sync', 'sweep', 'agent' ...
  purpose text NOT NULL,
  -- The approval a write ran under (chat action id, content item id, request id).
  approval_ref text,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS integration_tool_calls_workspace_idx
  ON public.integration_tool_calls (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS integration_tool_calls_account_idx
  ON public.integration_tool_calls (account_id, created_at DESC);

ALTER TABLE public.social_accounts
  ADD COLUMN IF NOT EXISTS integration_account_id uuid
    REFERENCES public.integration_accounts(id) ON DELETE SET NULL;

-- ── Row-level security ────────────────────────────────────────────────────
ALTER TABLE public.integration_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.integration_tool_calls ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.integration_accounts, public.integration_tool_calls FROM anon, authenticated;
GRANT SELECT ON public.integration_accounts, public.integration_tool_calls TO authenticated;
GRANT ALL ON public.integration_accounts, public.integration_tool_calls TO service_role;

DROP POLICY IF EXISTS "Workspace members read integration accounts" ON public.integration_accounts;
CREATE POLICY "Workspace members read integration accounts"
  ON public.integration_accounts FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Admins read integration tool calls" ON public.integration_tool_calls;
CREATE POLICY "Admins read integration tool calls"
  ON public.integration_tool_calls FOR SELECT TO authenticated
  USING (private.workspace_role(workspace_id, auth.uid()) IN ('owner', 'admin'));

DROP TRIGGER IF EXISTS integration_accounts_touch_updated_at ON public.integration_accounts;
CREATE TRIGGER integration_accounts_touch_updated_at
  BEFORE UPDATE ON public.integration_accounts
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION private.integration_tool_calls_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Cascades from a deleted workspace (DELETE) or account/user (SET NULL)
  -- are allowed (depth > 1); a direct UPDATE or DELETE is not.
  IF pg_trigger_depth() > 1 THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'integration_tool_calls is append-only' USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION private.integration_tool_calls_append_only() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS integration_tool_calls_immutable ON public.integration_tool_calls;
CREATE TRIGGER integration_tool_calls_immutable
  BEFORE UPDATE OR DELETE ON public.integration_tool_calls
  FOR EACH ROW EXECUTE FUNCTION private.integration_tool_calls_append_only();
