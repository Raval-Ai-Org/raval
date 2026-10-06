-- Memory (ADR-0033): what a brand's team has told Mellox to remember.
--
-- One list per workspace, shared by its members. Chat adds to it by itself
-- ("never use red in our images"), a person manages it in Settings → Memory,
-- and every generator reads it through memoryBlockFor (src/server/memory/).
--
--   body         the memory, one sentence
--   kind         rule | preference | fact | context
--   topic        which generators it matters to (visual, voice, content, ...)
--   expires_at   NULL = kept until removed; set = a temporary memory that
--                fades by itself (what the team is working on right now)
--   status       removed rows stay as a marker, so the background reader never
--                brings a deleted memory back
--   fingerprint  the normalised text; one memory per meaning per workspace
--
-- Read by members (RLS); written only by the server after a role check
-- (src/server/fns/memory.ts). Idempotent: safe to re-run.
--
-- The same record adds chat_actions: the buttons a chat reply offers.

CREATE TABLE IF NOT EXISTS public.workspace_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  body text NOT NULL,
  kind text NOT NULL DEFAULT 'fact'
    CHECK (kind IN ('rule', 'preference', 'fact', 'context')),
  topic text NOT NULL DEFAULT 'other'
    CHECK (topic IN ('visual', 'voice', 'content', 'audience', 'business', 'other')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('chat', 'manual', 'import')),
  fingerprint text NOT NULL,
  expires_at timestamptz,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_memories_body_length CHECK (char_length(body) BETWEEN 1 AND 500),
  CONSTRAINT workspace_memories_fingerprint_length
    CHECK (char_length(fingerprint) BETWEEN 1 AND 500)
);

CREATE UNIQUE INDEX IF NOT EXISTS workspace_memories_fingerprint_idx
  ON public.workspace_memories (workspace_id, fingerprint);

CREATE INDEX IF NOT EXISTS workspace_memories_list_idx
  ON public.workspace_memories (workspace_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS workspace_memories_expiry_idx
  ON public.workspace_memories (expires_at)
  WHERE expires_at IS NOT NULL;

ALTER TABLE public.workspace_memories ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_memories FROM anon, authenticated;
GRANT SELECT ON public.workspace_memories TO authenticated;
GRANT ALL ON public.workspace_memories TO service_role;

DROP POLICY IF EXISTS "Members read memories" ON public.workspace_memories;
CREATE POLICY "Members read memories"
  ON public.workspace_memories FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP TRIGGER IF EXISTS workspace_memories_touch_updated_at ON public.workspace_memories;
CREATE TRIGGER workspace_memories_touch_updated_at
  BEFORE UPDATE ON public.workspace_memories
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ── The brand's switch ────────────────────────────────────────────────────
-- No row means on. Off: nothing is saved from chat and no generator reads it.
CREATE TABLE IF NOT EXISTS public.workspace_memory_settings (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.workspace_memory_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_memory_settings FROM anon, authenticated;
GRANT SELECT ON public.workspace_memory_settings TO authenticated;
GRANT ALL ON public.workspace_memory_settings TO service_role;

DROP POLICY IF EXISTS "Members read memory settings" ON public.workspace_memory_settings;
CREATE POLICY "Members read memory settings"
  ON public.workspace_memory_settings FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP TRIGGER IF EXISTS workspace_memory_settings_touch_updated_at
  ON public.workspace_memory_settings;
CREATE TRIGGER workspace_memory_settings_touch_updated_at
  BEFORE UPDATE ON public.workspace_memory_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ── Buttons chat offers ───────────────────────────────────────────────────
-- When a chat reply offers to change something ("Schedule these two posts"),
-- the exact request is stored here and shown as a button. Nothing happens
-- until a member clicks it; the click runs it as that member, once.
--
--   tool / args   which action and with what, fixed when it was offered
--   status        offered → running → done | failed; only an offered row can
--                 start, so two clicks never run it twice
--   result        what the action answered (already cleaned for display)
--
-- Read by members (RLS); written only by the server (src/server/chat/).
CREATE TABLE IF NOT EXISTS public.chat_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE SET NULL,
  tool text NOT NULL,
  args jsonb NOT NULL DEFAULT '{}'::jsonb,
  title text NOT NULL,
  detail text NOT NULL DEFAULT '',
  destructive boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'offered'
    CHECK (status IN ('offered', 'running', 'done', 'failed')),
  result jsonb,
  error text,
  offered_to uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  run_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_actions_tool_length CHECK (char_length(tool) BETWEEN 1 AND 80),
  CONSTRAINT chat_actions_title_length CHECK (char_length(title) BETWEEN 1 AND 200),
  CONSTRAINT chat_actions_detail_length CHECK (char_length(detail) <= 600),
  CONSTRAINT chat_actions_args_size CHECK (pg_column_size(args) <= 40000),
  CONSTRAINT chat_actions_result_size CHECK (result IS NULL OR pg_column_size(result) <= 200000)
);

CREATE INDEX IF NOT EXISTS chat_actions_workspace_idx
  ON public.chat_actions (workspace_id, created_at DESC);

ALTER TABLE public.chat_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chat_actions FROM anon, authenticated;
GRANT SELECT ON public.chat_actions TO authenticated;
GRANT ALL ON public.chat_actions TO service_role;

DROP POLICY IF EXISTS "Members read chat actions" ON public.chat_actions;
CREATE POLICY "Members read chat actions"
  ON public.chat_actions FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP TRIGGER IF EXISTS chat_actions_touch_updated_at ON public.chat_actions;
CREATE TRIGGER chat_actions_touch_updated_at
  BEFORE UPDATE ON public.chat_actions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ── Carry over what chat already remembered ───────────────────────────────
-- Brand DNA's `userInsights` and the chat-written rows of memory_insights were
-- the old memory. They become lasting memories; a row that is already here
-- (or was removed by a person) is left alone, so a re-run changes nothing.
-- The fingerprint matches fingerprintOf() in src/lib/memory/normalize.ts.
INSERT INTO public.workspace_memories
  (workspace_id, body, kind, topic, source, fingerprint, created_at)
SELECT workspace_id, body, 'fact', 'other', 'import',
       left(COALESCE(
         NULLIF(btrim(regexp_replace(lower(body), '[^[:alnum:]]+', ' ', 'g')), ''),
         lower(body)
       ), 500),
       created_at
FROM (
  SELECT d.workspace_id,
         left(btrim(regexp_replace(
           CASE
             WHEN btrim(COALESCE(note->>'body', '')) = '' THEN COALESCE(note->>'title', '')
             WHEN btrim(COALESCE(note->>'title', '')) IN ('', 'Insight') THEN note->>'body'
             ELSE (note->>'title') || ': ' || (note->>'body')
           END, '\s+', ' ', 'g')), 500) AS body,
         COALESCE(d.updated_at, now()) AS created_at
  FROM public.workspace_brand_dna d
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(d.dna->'userInsights') = 'array'
         THEN d.dna->'userInsights' ELSE '[]'::jsonb END
  ) AS note
  UNION ALL
  SELECT i.workspace_id,
         left(btrim(regexp_replace(i.body, '\s+', ' ', 'g')), 500),
         i.created_at
  FROM public.memory_insights i
  WHERE i.kind = 'insight'
) old
WHERE char_length(body) >= 3
ON CONFLICT (workspace_id, fingerprint) DO NOTHING;
