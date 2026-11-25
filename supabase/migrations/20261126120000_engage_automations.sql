-- Engage automations (ManyChat-style "when someone comments → reply / DM")
-- and Train Mox. Builds on 20261125120000_meta_engage.sql.
--
--   engage_rules      an automation: which comments (platform, posts,
--                     keywords) and what happens (a public reply from a
--                     rotating list or written by Mox, an optional private
--                     message), sent by itself or waiting for a person.
--                     Mox-written replies always wait for a person.
--   engage_knowledge  answers the team taught Mox ("Do you ship to Canada?"
--                     → "Yes, in 5–7 days"). They are facts every draft may use.
--   engage_examples   replies a person sent, kept as style examples (the
--                     newest 50 per brand); a person can forget any of them.
--   engage_settings   one row per brand: the automations switch, the next
--                     time the every-minute run-schedules hook reads comments,
--                     and the hourly send counter that caps automatic sends.
--   engage_comments   + which automation matched, and the private message.
--
-- Members read; every write comes from the server after a role check.
-- Idempotent and non-destructive.

CREATE TABLE IF NOT EXISTS public.engage_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  status text NOT NULL DEFAULT 'live' CHECK (status IN ('live', 'paused')),
  platforms text[] NOT NULL DEFAULT ARRAY['instagram', 'facebook']::text[]
    CHECK (platforms <@ ARRAY['instagram', 'facebook']::text[] AND cardinality(platforms) >= 1),
  post_scope text NOT NULL DEFAULT 'any' CHECK (post_scope IN ('any', 'posts')),
  post_ids text[] NOT NULL DEFAULT '{}'::text[] CHECK (cardinality(post_ids) <= 30),
  match text NOT NULL DEFAULT 'keywords' CHECK (match IN ('keywords', 'any')),
  keywords text[] NOT NULL DEFAULT '{}'::text[] CHECK (cardinality(keywords) <= 30),
  whole_word boolean NOT NULL DEFAULT true,
  reply_mode text NOT NULL DEFAULT 'fixed' CHECK (reply_mode IN ('fixed', 'mox', 'none')),
  replies text[] NOT NULL DEFAULT '{}'::text[] CHECK (cardinality(replies) <= 10),
  mox_guidance text CHECK (mox_guidance IS NULL OR char_length(mox_guidance) <= 1000),
  dm_enabled boolean NOT NULL DEFAULT false,
  dm_message text CHECK (dm_message IS NULL OR char_length(dm_message) <= 1000),
  dm_link text CHECK (dm_link IS NULL OR (dm_link ~ '^https://' AND char_length(dm_link) <= 2000)),
  send_mode text NOT NULL DEFAULT 'approve' CHECK (send_mode IN ('auto', 'approve')),
  position integer NOT NULL DEFAULT 0,
  -- Only comments written after this act on the rule (set each time it goes live).
  live_since timestamptz NOT NULL DEFAULT now(),
  matched_count integer NOT NULL DEFAULT 0 CHECK (matched_count >= 0),
  sent_count integer NOT NULL DEFAULT 0 CHECK (sent_count >= 0),
  dm_count integer NOT NULL DEFAULT 0 CHECK (dm_count >= 0),
  last_matched_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS engage_rules_workspace_idx
  ON public.engage_rules (workspace_id, status, position);

CREATE TABLE IF NOT EXISTS public.engage_knowledge (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  question text NOT NULL CHECK (char_length(question) BETWEEN 1 AND 300),
  answer text NOT NULL CHECK (char_length(answer) BETWEEN 1 AND 1500),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS engage_knowledge_workspace_idx
  ON public.engage_knowledge (workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.engage_examples (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  platform text NOT NULL CHECK (platform IN ('instagram', 'facebook')),
  comment text NOT NULL CHECK (char_length(comment) BETWEEN 1 AND 1000),
  reply text NOT NULL CHECK (char_length(reply) BETWEEN 1 AND 2200),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS engage_examples_workspace_idx
  ON public.engage_examples (workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.engage_settings (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  automations_on boolean NOT NULL DEFAULT true,
  next_sync_at timestamptz NOT NULL DEFAULT now(),
  last_run_at timestamptz,
  hour_started_at timestamptz NOT NULL DEFAULT now(),
  sent_this_hour integer NOT NULL DEFAULT 0 CHECK (sent_this_hour >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS engage_settings_due_idx
  ON public.engage_settings (next_sync_at) WHERE automations_on;

ALTER TABLE public.engage_comments ADD COLUMN IF NOT EXISTS rule_id uuid
  REFERENCES public.engage_rules(id) ON DELETE SET NULL;
ALTER TABLE public.engage_comments ADD COLUMN IF NOT EXISTS matched_keyword text
  CHECK (matched_keyword IS NULL OR char_length(matched_keyword) <= 60);
ALTER TABLE public.engage_comments ADD COLUMN IF NOT EXISTS auto_sent boolean NOT NULL DEFAULT false;
ALTER TABLE public.engage_comments ADD COLUMN IF NOT EXISTS rules_checked boolean NOT NULL DEFAULT false;
ALTER TABLE public.engage_comments ADD COLUMN IF NOT EXISTS dm_status text NOT NULL DEFAULT 'none';
ALTER TABLE public.engage_comments DROP CONSTRAINT IF EXISTS engage_comments_dm_status_check;
ALTER TABLE public.engage_comments ADD CONSTRAINT engage_comments_dm_status_check
  CHECK (dm_status IN ('none', 'pending', 'sent', 'failed', 'skipped', 'unknown'));
ALTER TABLE public.engage_comments ADD COLUMN IF NOT EXISTS dm_text text
  CHECK (dm_text IS NULL OR char_length(dm_text) <= 3000);
ALTER TABLE public.engage_comments ADD COLUMN IF NOT EXISTS dm_error text
  CHECK (dm_error IS NULL OR char_length(dm_error) <= 500);

CREATE INDEX IF NOT EXISTS engage_comments_unchecked_idx
  ON public.engage_comments (workspace_id, created_at) WHERE NOT rules_checked;

-- ── Row-level security ────────────────────────────────────────────────────
ALTER TABLE public.engage_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engage_knowledge ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engage_examples ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.engage_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.engage_rules, public.engage_knowledge, public.engage_examples, public.engage_settings
  FROM anon, authenticated;
GRANT SELECT ON public.engage_rules, public.engage_knowledge, public.engage_examples, public.engage_settings
  TO authenticated;
GRANT ALL ON public.engage_rules, public.engage_knowledge, public.engage_examples, public.engage_settings
  TO service_role;

DROP POLICY IF EXISTS "Members read engage rules" ON public.engage_rules;
CREATE POLICY "Members read engage rules"
  ON public.engage_rules FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Members read engage knowledge" ON public.engage_knowledge;
CREATE POLICY "Members read engage knowledge"
  ON public.engage_knowledge FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Members read engage examples" ON public.engage_examples;
CREATE POLICY "Members read engage examples"
  ON public.engage_examples FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP POLICY IF EXISTS "Members read engage settings" ON public.engage_settings;
CREATE POLICY "Members read engage settings"
  ON public.engage_settings FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

-- ── updated_at ────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS engage_rules_touch_updated_at ON public.engage_rules;
CREATE TRIGGER engage_rules_touch_updated_at BEFORE UPDATE ON public.engage_rules
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS engage_knowledge_touch_updated_at ON public.engage_knowledge;
CREATE TRIGGER engage_knowledge_touch_updated_at BEFORE UPDATE ON public.engage_knowledge
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
DROP TRIGGER IF EXISTS engage_settings_touch_updated_at ON public.engage_settings;
CREATE TRIGGER engage_settings_touch_updated_at BEFORE UPDATE ON public.engage_settings
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ── Counters (one statement, no read-modify-write race) ───────────────────
CREATE OR REPLACE FUNCTION public.engage_rule_bump(p_rule uuid, p_matched int, p_sent int, p_dm int)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.engage_rules
     SET matched_count = matched_count + GREATEST(p_matched, 0),
         sent_count = sent_count + GREATEST(p_sent, 0),
         dm_count = dm_count + GREATEST(p_dm, 0),
         last_matched_at = CASE WHEN p_matched > 0 THEN now() ELSE last_matched_at END
   WHERE id = p_rule;
$$;
REVOKE ALL ON FUNCTION public.engage_rule_bump(uuid, int, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.engage_rule_bump(uuid, int, int, int) TO service_role;

-- Take one automatic send from this hour's allowance. False when it is used up.
CREATE OR REPLACE FUNCTION public.engage_take_send(p_workspace uuid, p_cap int)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE ok boolean;
BEGIN
  INSERT INTO public.engage_settings (workspace_id) VALUES (p_workspace)
  ON CONFLICT (workspace_id) DO NOTHING;
  UPDATE public.engage_settings
     SET hour_started_at = CASE WHEN hour_started_at < now() - interval '1 hour' THEN now() ELSE hour_started_at END,
         sent_this_hour = CASE WHEN hour_started_at < now() - interval '1 hour' THEN 1 ELSE sent_this_hour + 1 END
   WHERE workspace_id = p_workspace
     AND (hour_started_at < now() - interval '1 hour' OR sent_this_hour < p_cap)
  RETURNING true INTO ok;
  RETURN coalesce(ok, false);
END $$;
REVOKE ALL ON FUNCTION public.engage_take_send(uuid, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.engage_take_send(uuid, int) TO service_role;
