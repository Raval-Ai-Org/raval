-- workspace_sdr — per-workspace SDR identity (server-only).
-- FR-014: the user client must NEVER read these credentials. RLS is enabled with
-- NO authenticated policies; only service_role (server fns + provisioning) can
-- access. See specs/001-sdr-integration/data-model.md.
create table if not exists public.workspace_sdr (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  sdr_workspace_id text not null,
  encrypted_api_key text not null,
  webhook_secret text,
  sdr_base_url text not null,
  status text not null default 'provisioning',
  last_provisioned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id)
);

alter table public.workspace_sdr enable row level security;

-- Intentionally NO policies for authenticated/anon: service_role bypasses RLS.
grant all on public.workspace_sdr to service_role;
