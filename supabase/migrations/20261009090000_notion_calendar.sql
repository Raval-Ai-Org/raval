-- Notion calendar: safe connection metadata in workspace_connections, credentials
-- and identity mappings available only to server service role.
ALTER TABLE public.workspace_connections DROP CONSTRAINT IF EXISTS workspace_connections_provider_check;
ALTER TABLE public.workspace_connections ADD CONSTRAINT workspace_connections_provider_check
  CHECK (provider IN ('github','wordpress','webflow','framer','shopify','google','canva','notion'));
CREATE UNIQUE INDEX IF NOT EXISTS workspace_notion_one_active_idx
  ON public.workspace_connections(workspace_id) WHERE provider = 'notion' AND status <> 'revoked';

CREATE TABLE IF NOT EXISTS public.notion_oauth_credentials (
  connection_id uuid PRIMARY KEY REFERENCES public.workspace_connections(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  access_token_enc text NOT NULL,
  bot_id text,
  selected_database_id text,
  selected_data_source_id text,
  selected_parent_page_id text,
  selected_destination_name text,
  selected_destination_url text,
  last_sync_at timestamptz,
  sync_lock_owner uuid,
  sync_lock_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notion_credentials_workspace_idx ON public.notion_oauth_credentials(workspace_id);
ALTER TABLE public.notion_oauth_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notion_oauth_credentials FROM anon, authenticated;
GRANT ALL ON public.notion_oauth_credentials TO service_role;

CREATE TABLE IF NOT EXISTS public.notion_content_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  content_item_id uuid NOT NULL REFERENCES public.content_items(id) ON DELETE CASCADE,
  notion_page_id text NOT NULL,
  notion_data_source_id text NOT NULL,
  last_mellox_updated_at timestamptz,
  last_notion_edited_at timestamptz,
  last_sync_hash text,
  last_mellox_hash text,
  last_notion_hash text,
  last_sync_direction text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notion_mapping_item_destination_unique UNIQUE(workspace_id, content_item_id, notion_data_source_id),
  CONSTRAINT notion_mapping_page_unique UNIQUE(workspace_id, notion_page_id)
);
CREATE INDEX IF NOT EXISTS notion_mapping_destination_idx ON public.notion_content_mappings(workspace_id, notion_data_source_id);
ALTER TABLE public.notion_content_mappings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notion_content_mappings FROM anon, authenticated;
GRANT ALL ON public.notion_content_mappings TO service_role;
