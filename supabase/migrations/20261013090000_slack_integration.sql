-- Mellox for Slack. Credentials, webhook receipts, and action references are
-- service-role only. Every tenant row has an explicit workspace_id.
CREATE TABLE IF NOT EXISTS public.slack_installations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  team_id text NOT NULL,
  team_name text NOT NULL,
  bot_user_id text NOT NULL,
  bot_token_enc text NOT NULL,
  connected_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','reconnect_needed','disconnected')),
  last_event_at timestamptz,
  last_outbound_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, team_id),
  UNIQUE(id, workspace_id),
  UNIQUE(id, team_id)
);
CREATE INDEX IF NOT EXISTS slack_installations_team_idx ON public.slack_installations(team_id) WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS slack_installations_one_workspace_idx
  ON public.slack_installations(workspace_id) WHERE status <> 'disconnected';

CREATE TABLE IF NOT EXISTS public.slack_channel_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  installation_id uuid NOT NULL,
  team_id text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('approvals','marketing','intelligence')),
  channel_id text NOT NULL,
  channel_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, purpose),
  FOREIGN KEY (installation_id, workspace_id) REFERENCES public.slack_installations(id, workspace_id) ON DELETE CASCADE,
  FOREIGN KEY (installation_id, team_id) REFERENCES public.slack_installations(id, team_id) ON DELETE CASCADE
);
-- A channel must never silently resolve to two client workspaces.
CREATE UNIQUE INDEX IF NOT EXISTS slack_channel_one_workspace_idx ON public.slack_channel_mappings(team_id, channel_id);

CREATE TABLE IF NOT EXISTS public.slack_user_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  installation_id uuid NOT NULL,
  slack_user_id text NOT NULL,
  mellox_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  linked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(installation_id, slack_user_id),
  UNIQUE(installation_id, mellox_user_id),
  FOREIGN KEY (installation_id, workspace_id) REFERENCES public.slack_installations(id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.slack_link_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  installation_id uuid NOT NULL,
  mellox_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  FOREIGN KEY (installation_id, workspace_id) REFERENCES public.slack_installations(id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.slack_preferences (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  approvals boolean NOT NULL DEFAULT true,
  publishing_failures boolean NOT NULL DEFAULT true,
  competitor_alerts boolean NOT NULL DEFAULT false,
  market_alerts boolean NOT NULL DEFAULT false,
  geo_alerts boolean NOT NULL DEFAULT false,
  performance_alerts boolean NOT NULL DEFAULT false,
  daily_brief boolean NOT NULL DEFAULT false,
  brief_hour smallint NOT NULL DEFAULT 9 CHECK (brief_hour BETWEEN 0 AND 23),
  brief_timezone text NOT NULL DEFAULT 'UTC',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.slack_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  installation_id uuid NOT NULL,
  delivery_key text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('event','action')),
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done','failed')),
  attempts int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE(installation_id, delivery_key),
  FOREIGN KEY (installation_id, workspace_id) REFERENCES public.slack_installations(id, workspace_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS slack_inbox_due_idx ON public.slack_inbox(status, next_attempt_at);

CREATE TABLE IF NOT EXISTS public.slack_threads (
  workspace_id uuid NOT NULL,
  installation_id uuid NOT NULL,
  channel_id text NOT NULL,
  thread_ts text NOT NULL,
  messages jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (installation_id, channel_id, thread_ts),
  FOREIGN KEY (installation_id, workspace_id) REFERENCES public.slack_installations(id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.slack_action_refs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  installation_id uuid NOT NULL,
  content_item_id uuid REFERENCES public.content_items(id) ON DELETE CASCADE,
  action text NOT NULL,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (installation_id, workspace_id) REFERENCES public.slack_installations(id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS public.slack_outbound (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  installation_id uuid NOT NULL,
  dedupe_key text NOT NULL,
  channel_id text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent','failed')),
  attempts int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  slack_ts text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  UNIQUE(installation_id, dedupe_key),
  FOREIGN KEY (installation_id, workspace_id) REFERENCES public.slack_installations(id, workspace_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS slack_outbound_due_idx ON public.slack_outbound(status, next_attempt_at);

-- A Slack shortcut can be redelivered after the draft was saved but before the
-- worker acknowledged completion. Keep the domain content insert idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS content_items_slack_ref_idx
  ON public.content_items (workspace_id, (meta->>'slack_ref'))
  WHERE meta ? 'slack_ref';

-- All writes use verified server paths. Credentials and payloads are invisible
-- to browser roles even when a member can read other workspace metadata.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['slack_installations','slack_channel_mappings','slack_user_links','slack_link_codes','slack_preferences','slack_inbox','slack_threads','slack_action_refs','slack_outbound'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
  END LOOP;
END $$;

-- Atomic one-time claims and expired lease recovery across app instances.
CREATE OR REPLACE FUNCTION private.claim_slack_inbox(p_limit int)
RETURNS SETOF public.slack_inbox LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.slack_inbox q SET status='running', attempts=q.attempts+1,
    lease_until=now()+interval '2 minutes'
  WHERE q.id IN (
    SELECT id FROM public.slack_inbox
    WHERE (status='pending' AND next_attempt_at<=now()) OR (status='running' AND lease_until<now())
    ORDER BY created_at LIMIT LEAST(GREATEST(p_limit,1),25) FOR UPDATE SKIP LOCKED
  ) RETURNING q.*;
$$;
REVOKE ALL ON FUNCTION private.claim_slack_inbox(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.claim_slack_inbox(int) TO service_role;

CREATE OR REPLACE FUNCTION private.claim_slack_outbound(p_limit int)
RETURNS SETOF public.slack_outbound LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.slack_outbound q SET status='sending', attempts=q.attempts+1,
    lease_until=now()+interval '2 minutes'
  WHERE q.id IN (
    SELECT id FROM public.slack_outbound
    WHERE (status='pending' AND next_attempt_at<=now()) OR (status='sending' AND lease_until<now())
    ORDER BY created_at LIMIT LEAST(GREATEST(p_limit,1),25) FOR UPDATE SKIP LOCKED
  ) RETURNING q.*;
$$;
REVOKE ALL ON FUNCTION private.claim_slack_outbound(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.claim_slack_outbound(int) TO service_role;

DO $$ BEGIN
  IF to_regnamespace('cron') IS NOT NULL AND to_regclass('vault.decrypted_secrets') IS NOT NULL
    AND (SELECT count(*) FROM vault.decrypted_secrets
         WHERE name IN ('mellox_app_base_url','mellox_cron_secret') AND coalesce(decrypted_secret,'') <> '') = 2 THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='mellox-slack') THEN PERFORM cron.unschedule('mellox-slack'); END IF;
    PERFORM cron.schedule('mellox-slack','* * * * *',
      format('SELECT public.call_app_hook(%L);','/api/public/hooks/slack'));
  END IF;
END $$;
