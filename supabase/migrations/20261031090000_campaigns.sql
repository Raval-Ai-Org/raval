-- Campaigns (ADR-0039): a planned run of posts and Stories with one purpose —
-- a launch, an event, a season, a sale, a series.
--
-- workspace_campaigns  one row per campaign. `brief` is CampaignBrief and
--                      `plan` is CampaignPlan (src/lib/campaigns/contracts.ts);
--                      `goal` holds the person's own target, link and count —
--                      Mellox never writes an estimate into it.
-- autopilot_actions    each piece of a started campaign is an ordinary
--                      `content` step with `campaign_id`, so it is made,
--                      approved and scheduled by the existing Autopilot worker
--                      (no new cron job, no second publishing path).
--
-- Read by members (RLS); written only by the server after a role check
-- (src/server/fns/campaigns.ts). Idempotent.

CREATE TABLE IF NOT EXISTS public.workspace_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type ~ '^[a-z][a-z0-9-]{1,39}$'),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'ready', 'running', 'paused', 'done', 'ended')),
  brief jsonb NOT NULL DEFAULT '{}'::jsonb,
  plan jsonb NOT NULL DEFAULT '{}'::jsonb,
  goal jsonb NOT NULL DEFAULT '{}'::jsonb,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  key_date date,
  version integer NOT NULL DEFAULT 1,
  acting_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  ended_at timestamptz,
  CONSTRAINT workspace_campaigns_brief_size CHECK (pg_column_size(brief) <= 16000),
  CONSTRAINT workspace_campaigns_plan_size CHECK (pg_column_size(plan) <= 60000),
  CONSTRAINT workspace_campaigns_goal_size CHECK (pg_column_size(goal) <= 2000),
  CONSTRAINT workspace_campaigns_dates CHECK (ends_on >= starts_on AND ends_on <= starts_on + 120)
);

CREATE INDEX IF NOT EXISTS workspace_campaigns_list_idx
  ON public.workspace_campaigns(workspace_id, status, starts_on);

ALTER TABLE public.workspace_campaigns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.workspace_campaigns FROM anon, authenticated;
GRANT SELECT ON public.workspace_campaigns TO authenticated;
GRANT ALL ON public.workspace_campaigns TO service_role;

DROP POLICY IF EXISTS "Members read campaigns" ON public.workspace_campaigns;
CREATE POLICY "Members read campaigns"
  ON public.workspace_campaigns FOR SELECT TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()));

DROP TRIGGER IF EXISTS workspace_campaigns_touch ON public.workspace_campaigns;
CREATE TRIGGER workspace_campaigns_touch BEFORE UPDATE ON public.workspace_campaigns
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- A campaign's pieces are Autopilot steps.
ALTER TABLE public.autopilot_actions
  ADD COLUMN IF NOT EXISTS campaign_id uuid REFERENCES public.workspace_campaigns(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS autopilot_actions_campaign_idx
  ON public.autopilot_actions(workspace_id, campaign_id)
  WHERE campaign_id IS NOT NULL;
