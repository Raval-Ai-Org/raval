
CREATE TABLE public.client_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Shared with client',
  slug text NOT NULL UNIQUE,
  token_hash text NOT NULL,
  client_name text,
  client_email text,
  password_hash text,
  expires_at timestamptz,
  allow_comments boolean NOT NULL DEFAULT true,
  allow_approvals boolean NOT NULL DEFAULT true,
  allow_download boolean NOT NULL DEFAULT false,
  branding jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active',
  last_viewed_at timestamptz,
  view_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_client_shares_workspace ON public.client_shares(workspace_id, created_at DESC);
CREATE INDEX idx_client_shares_slug ON public.client_shares(slug);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_shares TO authenticated;
GRANT ALL ON public.client_shares TO service_role;
ALTER TABLE public.client_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members manage workspace shares" ON public.client_shares
  FOR ALL TO authenticated
  USING (private.is_workspace_member(workspace_id, auth.uid()))
  WITH CHECK (private.is_workspace_member(workspace_id, auth.uid()));

CREATE TRIGGER trg_client_shares_updated_at
  BEFORE UPDATE ON public.client_shares
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


CREATE TABLE public.client_share_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id uuid NOT NULL REFERENCES public.client_shares(id) ON DELETE CASCADE,
  kind text NOT NULL,
  ref_id uuid,
  title text,
  description text,
  position integer NOT NULL DEFAULT 0,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  visible boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_client_share_items_share ON public.client_share_items(share_id, position);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_share_items TO authenticated;
GRANT ALL ON public.client_share_items TO service_role;
ALTER TABLE public.client_share_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members manage share items" ON public.client_share_items
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.client_shares s WHERE s.id = share_id AND private.is_workspace_member(s.workspace_id, auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.client_shares s WHERE s.id = share_id AND private.is_workspace_member(s.workspace_id, auth.uid())));


CREATE TABLE public.client_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id uuid NOT NULL REFERENCES public.client_shares(id) ON DELETE CASCADE,
  item_id uuid REFERENCES public.client_share_items(id) ON DELETE SET NULL,
  kind text NOT NULL,
  body text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_name text,
  actor_email text,
  marketer_decision text NOT NULL DEFAULT 'pending',
  marketer_decided_at timestamptz,
  marketer_decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_client_events_share ON public.client_events(share_id, created_at DESC);
CREATE INDEX idx_client_events_pending ON public.client_events(share_id, marketer_decision);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.client_events TO authenticated;
GRANT ALL ON public.client_events TO service_role;
ALTER TABLE public.client_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members read events" ON public.client_events
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.client_shares s WHERE s.id = share_id AND private.is_workspace_member(s.workspace_id, auth.uid())));

CREATE POLICY "Members update events" ON public.client_events
  FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.client_shares s WHERE s.id = share_id AND private.is_workspace_member(s.workspace_id, auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.client_shares s WHERE s.id = share_id AND private.is_workspace_member(s.workspace_id, auth.uid())));

CREATE POLICY "Members delete events" ON public.client_events
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.client_shares s WHERE s.id = share_id AND private.is_workspace_member(s.workspace_id, auth.uid())));
