-- content_publications — webhook-driven per-destination delivery mirror (FR-010).
-- Written only by the webhook receiver / server fns (service_role); workspace
-- members may SELECT their own rows. UNIQUE(content_item_id, sdr_target_id) makes
-- webhook application idempotent (FR-021). See data-model.md.
create table if not exists public.content_publications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  content_item_id uuid not null references public.content_items(id) on delete cascade,
  sdr_post_id text not null,
  sdr_target_id text not null,
  platform text not null,
  account_id text not null,
  status text not null default 'pending',
  platform_post_id text,
  platform_post_url text,
  error_category text,
  last_error text,
  attempt int not null default 0,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (content_item_id, sdr_target_id)
);

alter table public.content_publications enable row level security;

create policy "publications_select_members"
  on public.content_publications for select
  using (public.is_workspace_member(workspace_id, auth.uid()));

grant select on public.content_publications to authenticated;
grant all on public.content_publications to service_role;

create index publications_content_item_idx on public.content_publications(content_item_id);
create index publications_ws_status_idx on public.content_publications(workspace_id, status);
create index publications_platform_idx on public.content_publications(platform);
