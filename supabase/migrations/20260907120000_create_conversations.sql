-- Persistent chat threads. Messages belong to a conversation, not directly to a workspace.
CREATE TABLE IF NOT EXISTS public.conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  title text NOT NULL DEFAULT 'New chat',
  preview text,
  summary text NOT NULL DEFAULT '',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_pinned boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS conversation_id uuid REFERENCES public.conversations(id) ON DELETE CASCADE;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'completed' CHECK (status IN ('sending', 'streaming', 'completed', 'failed', 'cancelled'));
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Preserve legacy history by placing each workspace's existing messages in one thread.
DO $$
DECLARE
  ws record;
  thread_id uuid;
BEGIN
  FOR ws IN SELECT DISTINCT workspace_id FROM public.chat_messages WHERE conversation_id IS NULL LOOP
    INSERT INTO public.conversations (workspace_id, title, created_at, updated_at)
    SELECT ws.workspace_id, 'Previous chat', COALESCE(min(created_at), now()), COALESCE(max(created_at), now())
    FROM public.chat_messages WHERE workspace_id = ws.workspace_id AND conversation_id IS NULL
    RETURNING id INTO thread_id;
    UPDATE public.chat_messages SET conversation_id = thread_id WHERE workspace_id = ws.workspace_id AND conversation_id IS NULL;
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS conversations_workspace_updated_idx
  ON public.conversations(workspace_id, is_pinned DESC, updated_at DESC)
  WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS conversations_workspace_search_idx
  ON public.conversations(workspace_id, title, preview);
CREATE INDEX IF NOT EXISTS chat_messages_conversation_created_idx
  ON public.chat_messages(conversation_id, created_at);

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations TO authenticated;
GRANT ALL ON public.conversations TO service_role;

DROP POLICY IF EXISTS conversations_select_members ON public.conversations;
CREATE POLICY conversations_select_members ON public.conversations FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));
DROP POLICY IF EXISTS conversations_insert_members ON public.conversations;
CREATE POLICY conversations_insert_members ON public.conversations FOR INSERT TO authenticated
  WITH CHECK (private.is_workspace_member(workspace_id, auth.uid()) AND (created_by IS NULL OR created_by = auth.uid()));
DROP POLICY IF EXISTS conversations_update_members ON public.conversations;
CREATE POLICY conversations_update_members ON public.conversations FOR UPDATE TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (private.is_workspace_member(workspace_id, auth.uid()));
DROP POLICY IF EXISTS conversations_delete_members ON public.conversations;
CREATE POLICY conversations_delete_members ON public.conversations FOR DELETE TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS chat_select_members ON public.chat_messages;
CREATE POLICY chat_select_members ON public.chat_messages FOR SELECT TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));
DROP POLICY IF EXISTS chat_insert_members ON public.chat_messages;
CREATE POLICY chat_insert_members ON public.chat_messages FOR INSERT TO authenticated
  WITH CHECK (
    public.is_workspace_member(workspace_id, auth.uid())
    AND (user_id IS NULL OR user_id = auth.uid())
    AND (conversation_id IS NULL OR EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_id AND c.workspace_id = chat_messages.workspace_id
      AND public.is_workspace_member(c.workspace_id, auth.uid())
    ))
  );
DROP POLICY IF EXISTS chat_no_update ON public.chat_messages;
CREATE POLICY chat_update_own_members ON public.chat_messages FOR UPDATE TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (public.is_workspace_member(workspace_id, auth.uid()));
DROP POLICY IF EXISTS chat_no_delete ON public.chat_messages;
CREATE POLICY chat_delete_members ON public.chat_messages FOR DELETE TO authenticated
  USING (public.is_workspace_member(workspace_id, auth.uid()));

CREATE OR REPLACE FUNCTION public.touch_conversation_from_message()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.conversation_id IS NOT NULL THEN
    UPDATE public.conversations
    SET updated_at = GREATEST(updated_at, NEW.created_at),
        preview = CASE WHEN NEW.role = 'user' THEN left(NEW.content, 180) ELSE preview END
    WHERE id = NEW.conversation_id;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS chat_message_touches_conversation ON public.chat_messages;
CREATE TRIGGER chat_message_touches_conversation
  AFTER INSERT ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION public.touch_conversation_from_message();
