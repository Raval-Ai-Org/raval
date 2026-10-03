-- Mellox MCP server (ADR-0029): AI assistants (Claude, ChatGPT, any MCP client)
-- operating Mellox as a signed-in member.
--
--   mcp_workspace_settings   one row per workspace: is it on, and may an
--                            assistant change things or only read
--   mcp_tool_calls           append-only record of every tool call
--
-- Two invariants:
--   * OFF BY DEFAULT. No row means off. Only the service role writes the
--     settings row, after the server checked the caller is an admin.
--   * THE RECORD IS APPEND-ONLY. A trigger refuses UPDATE and DELETE even for
--     service_role (cascades from a deleted workspace or user are allowed).

-- ── Settings ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mcp_workspace_settings (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  allow_writes boolean NOT NULL DEFAULT false,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mcp_workspace_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_workspace_settings FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.mcp_workspace_settings FROM authenticated;
GRANT SELECT ON public.mcp_workspace_settings TO authenticated;
GRANT ALL ON public.mcp_workspace_settings TO service_role;

DROP POLICY IF EXISTS "Members read MCP settings" ON public.mcp_workspace_settings;
CREATE POLICY "Members read MCP settings" ON public.mcp_workspace_settings
  FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

-- ── Tool calls (append-only) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.mcp_tool_calls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- null for calls that span workspaces (list, agency summary) or failed
  -- before a workspace was verified
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- the OAuth client (the assistant app) that made the call
  client_id text,
  tool text NOT NULL,
  is_write boolean NOT NULL DEFAULT false,
  ok boolean NOT NULL,
  error_code text,
  duration_ms integer NOT NULL DEFAULT 0,
  -- identifiers and outcomes only; never content, tokens or keys
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mcp_tool_calls_workspace_idx
  ON public.mcp_tool_calls (workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS mcp_tool_calls_user_idx
  ON public.mcp_tool_calls (user_id, created_at DESC);

ALTER TABLE public.mcp_tool_calls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_tool_calls FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.mcp_tool_calls FROM authenticated;
GRANT SELECT ON public.mcp_tool_calls TO authenticated;
GRANT ALL ON public.mcp_tool_calls TO service_role;

DROP POLICY IF EXISTS "Admins read MCP tool calls" ON public.mcp_tool_calls;
CREATE POLICY "Admins read MCP tool calls" ON public.mcp_tool_calls
  FOR SELECT TO authenticated
  USING (
    workspace_id IS NOT NULL
    AND private.workspace_role(workspace_id, auth.uid()) IN ('owner', 'admin')
  );

CREATE OR REPLACE FUNCTION private.mcp_tool_calls_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Cascades from a deleted workspace (DELETE) or user (SET NULL) are allowed
  -- (depth > 1); a direct UPDATE or DELETE is not.
  IF pg_trigger_depth() > 1 THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'mcp_tool_calls is append-only' USING ERRCODE = '42501';
END;
$$;

REVOKE ALL ON FUNCTION private.mcp_tool_calls_append_only() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS mcp_tool_calls_immutable ON public.mcp_tool_calls;
CREATE TRIGGER mcp_tool_calls_immutable
  BEFORE UPDATE OR DELETE ON public.mcp_tool_calls
  FOR EACH ROW EXECUTE FUNCTION private.mcp_tool_calls_append_only();
