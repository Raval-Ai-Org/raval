-- Inbox auto-reply: Mox answers comments by itself.
--
--   engage_settings   + auto_reply (Mox answers every new comment no quick
--                     reply handled), auto_reply_since (only comments written
--                     after it was turned on) and guidelines (the team's own
--                     instructions for every reply, also set from chat).
--   engage_questions  what Mox needed to know and didn't (one open row per
--                     question). A person's answer becomes an engage_knowledge
--                     row and the comments that waited on it are answered.
--   engage_comments   + mox_checked (claimed once by the sweep), mox_state
--                     (what Mox did), mox_note and question_id.
--
-- Existing comments are marked checked, so turning this on never answers old
-- comments. Members read; every write comes from the server after a role check.
-- Idempotent and non-destructive.

ALTER TABLE public.engage_settings ADD COLUMN IF NOT EXISTS auto_reply boolean NOT NULL DEFAULT true;
ALTER TABLE public.engage_settings ADD COLUMN IF NOT EXISTS auto_reply_since timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.engage_settings ADD COLUMN IF NOT EXISTS guidelines text NOT NULL DEFAULT '';
ALTER TABLE public.engage_settings DROP CONSTRAINT IF EXISTS engage_settings_guidelines_check;
ALTER TABLE public.engage_settings ADD CONSTRAINT engage_settings_guidelines_check
  CHECK (char_length(guidelines) <= 3000);

DROP INDEX IF EXISTS public.engage_settings_due_idx;
CREATE INDEX IF NOT EXISTS engage_settings_due_idx
  ON public.engage_settings (next_sync_at) WHERE automations_on OR auto_reply;

CREATE TABLE IF NOT EXISTS public.engage_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  question text NOT NULL CHECK (char_length(question) BETWEEN 1 AND 300),
  fingerprint text NOT NULL CHECK (char_length(fingerprint) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'dismissed')),
  asked_count integer NOT NULL DEFAULT 1 CHECK (asked_count >= 0),
  example_comment text CHECK (example_comment IS NULL OR char_length(example_comment) <= 500),
  answer text CHECK (answer IS NULL OR char_length(answer) <= 1500),
  knowledge_id uuid REFERENCES public.engage_knowledge(id) ON DELETE SET NULL,
  answered_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  answered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS engage_questions_open_uniq
  ON public.engage_questions (workspace_id, fingerprint) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS engage_questions_workspace_idx
  ON public.engage_questions (workspace_id, status, updated_at DESC);

-- Old rows get `true` from the first default, new rows `false`.
ALTER TABLE public.engage_comments ADD COLUMN IF NOT EXISTS mox_checked boolean NOT NULL DEFAULT true;
ALTER TABLE public.engage_comments ALTER COLUMN mox_checked SET DEFAULT false;
ALTER TABLE public.engage_comments ADD COLUMN IF NOT EXISTS mox_state text NOT NULL DEFAULT 'none';
ALTER TABLE public.engage_comments DROP CONSTRAINT IF EXISTS engage_comments_mox_state_check;
ALTER TABLE public.engage_comments ADD CONSTRAINT engage_comments_mox_state_check
  CHECK (mox_state IN ('none', 'replied', 'waiting_info', 'needs_person', 'skipped'));
ALTER TABLE public.engage_comments ADD COLUMN IF NOT EXISTS mox_note text
  CHECK (mox_note IS NULL OR char_length(mox_note) <= 300);
ALTER TABLE public.engage_comments ADD COLUMN IF NOT EXISTS question_id uuid
  REFERENCES public.engage_questions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS engage_comments_mox_due_idx
  ON public.engage_comments (workspace_id, commented_at) WHERE NOT mox_checked;
CREATE INDEX IF NOT EXISTS engage_comments_question_idx
  ON public.engage_comments (question_id) WHERE question_id IS NOT NULL;

-- Every brand already connected gets its settings row, so the sweep finds it.
INSERT INTO public.engage_settings (workspace_id)
SELECT DISTINCT workspace_id FROM public.meta_pages
ON CONFLICT (workspace_id) DO NOTHING;

ALTER TABLE public.engage_questions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.engage_questions FROM anon, authenticated;
GRANT SELECT ON public.engage_questions TO authenticated;
GRANT ALL ON public.engage_questions TO service_role;

DROP POLICY IF EXISTS "Members read engage questions" ON public.engage_questions;
CREATE POLICY "Members read engage questions"
  ON public.engage_questions FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP TRIGGER IF EXISTS engage_questions_touch_updated_at ON public.engage_questions;
CREATE TRIGGER engage_questions_touch_updated_at BEFORE UPDATE ON public.engage_questions
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
