-- Storage metadata only. No Auth, billing or application schema changes.
create table if not exists private.media_storage_migrations (
  source_bucket text not null,
  source_path text not null,
  target_path text not null unique,
  workspace_id uuid not null,
  sha256 text,
  size_bytes bigint,
  status text not null default 'pending' check (status in ('pending','verified','active','rolled_back','deleted')),
  verified_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key(source_bucket, source_path)
);
revoke all on private.media_storage_migrations from public, anon, authenticated;

-- Exact string replacement, including nested jobs, snapshots, thumbnails and UGC.
create or replace function private.replace_media_reference(value jsonb, old_path text, new_path text)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare result jsonb;
begin
  case jsonb_typeof(value)
    when 'string' then return case when value #>> '{}' = old_path then to_jsonb(new_path) else value end;
    when 'array' then
      select coalesce(jsonb_agg(private.replace_media_reference(v,old_path,new_path) order by n),'[]'::jsonb)
      into result from jsonb_array_elements(value) with ordinality a(v,n);
    when 'object' then
      select coalesce(jsonb_object_agg(k,private.replace_media_reference(v,old_path,new_path)),'{}'::jsonb)
      into result from jsonb_each(value) a(k,v);
    else return value;
  end case;
  return result;
end $$;

-- Called only by the operator's direct DB connection, inside a transaction.
-- Catalog discovery covers new features without an incomplete hardcoded table list.
create or replace function private.switch_media_references(old_path text, new_path text)
returns bigint language plpgsql set search_path = '' as $$
declare c record; affected bigint; total bigint := 0; scope text;
begin
  if old_path !~ '^workspace/[0-9a-f-]{36}/assets/' or
     split_part(old_path,'/',2) <> split_part(new_path,'/',2) then
    raise exception 'Invalid workspace storage mapping';
  end if;
  -- A cached signed URL is not a durable reference. Content readers regenerate
  -- the URL from meta.asset_storage_path; preserve that path and clear the cache.
  if to_regclass('public.content_items') is not null then
    execute 'update public.content_items set media_url=null where workspace_id::text=$3 and meta->>''asset_storage_path''=$1 and media_url like $2'
    using old_path, '%/storage/v1/object/%/generated-assets/' || old_path || '%', split_part(old_path,'/',2);
  end if;
  for c in
    select cols.table_name, cols.column_name, cols.data_type,
      exists(select 1 from information_schema.columns owner_col where owner_col.table_schema='public'
        and owner_col.table_name=cols.table_name and owner_col.column_name='workspace_id' and owner_col.udt_name='uuid') as has_workspace
    from information_schema.columns cols
    join information_schema.tables t using (table_schema,table_name)
    where cols.table_schema='public' and t.table_type='BASE TABLE'
      and cols.is_generated='NEVER' and cols.data_type in ('text','character varying','json','jsonb')
  loop
    scope := case when c.has_workspace then ' and workspace_id=$4::uuid' else '' end;
    if c.data_type in ('json','jsonb') then
      execute format('update public.%I set %I=private.replace_media_reference(%I::jsonb,$1,$2)::%s where %I::text like $3 and %I::jsonb is distinct from private.replace_media_reference(%I::jsonb,$1,$2)%s',
        c.table_name,c.column_name,c.column_name,c.data_type,c.column_name,c.column_name,c.column_name,scope)
      using old_path,new_path,'%' || old_path || '%',split_part(old_path,'/',2);
    else
      execute format('update public.%I set %I=$2 where %I=$1%s',c.table_name,c.column_name,c.column_name,scope)
      using old_path,new_path,null,split_part(old_path,'/',2);
    end if;
    get diagnostics affected = row_count;
    total := total + affected;
  end loop;
  return total;
end $$;
revoke all on function private.switch_media_references(text,text) from public, anon, authenticated;
revoke all on function private.replace_media_reference(jsonb,text,text) from public, anon, authenticated;

-- Alias lookup keeps old in-flight jobs and cached paths working after cutover.
create or replace function public.resolve_media_storage_paths(paths text[])
returns table(source_path text,target_path text,status text)
language sql security definer set search_path = '' as $$
  select m.source_path,m.target_path,m.status from private.media_storage_migrations m
  where m.source_bucket='generated-assets' and m.source_path=any(paths)
;
$$;
revoke all on function public.resolve_media_storage_paths(text[]) from public, anon, authenticated;
grant execute on function public.resolve_media_storage_paths(text[]) to service_role;

create or replace function public.tombstone_migrated_media(paths text[])
returns void language sql security definer set search_path = '' as $$
  update private.media_storage_migrations set status='deleted',updated_at=now()
  where target_path=any(paths) and status <> 'deleted';
$$;
revoke all on function public.tombstone_migrated_media(text[]) from public, anon, authenticated;
grant execute on function public.tombstone_migrated_media(text[]) to service_role;

notify pgrst, 'reload schema';
