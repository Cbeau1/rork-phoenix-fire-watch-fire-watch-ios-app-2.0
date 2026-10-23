-- Paper fire watch logs: scans / photos of handwritten logs, stored with a property as a backup.
-- Files: crm-documents/<org>/paper-logs/<property>/<uuid>.<ext> (admins read via the existing crm-documents policy).
-- Admin only. Additive. Rollback:
--   drop function if exists public.paper_log_add(uuid, date, text, text, text, text, bigint),
--     public.paper_log_update(uuid, date, text), public.paper_log_delete(uuid), public.paper_logs(uuid);
--   drop policy if exists "Admins upload paper logs" on storage.objects;
--   drop policy if exists "Admins delete paper logs" on storage.objects;
--   drop table if exists public.property_paper_logs;

create table if not exists public.property_paper_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  log_date date not null,
  note text not null default '' check (length(note) <= 1000),
  file_path text not null unique,
  file_name text not null check (length(file_name) between 1 and 200),
  mime_type text not null default '',
  size_bytes bigint not null default 0 check (size_bytes >= 0 and size_bytes <= 26214400),
  uploaded_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists property_paper_logs_property on public.property_paper_logs (property_id, log_date desc, created_at desc);

alter table public.property_paper_logs enable row level security;
drop policy if exists "Admins read paper logs" on public.property_paper_logs;
create policy "Admins read paper logs" on public.property_paper_logs for select to authenticated
  using (org_id = public.my_org_id() and public.is_org_admin());
revoke all on public.property_paper_logs from anon;
revoke insert, update, delete on public.property_paper_logs from authenticated;
grant select on public.property_paper_logs to authenticated;

drop policy if exists "Admins upload paper logs" on storage.objects;
create policy "Admins upload paper logs" on storage.objects for insert to authenticated
  with check (bucket_id = 'crm-documents' and (storage.foldername(name))[1] = (public.my_org_id())::text
              and (storage.foldername(name))[2] = 'paper-logs'
              and lower(storage.extension(name)) in ('pdf', 'jpg', 'jpeg', 'png', 'heic', 'heif', 'webp')
              and public.is_org_admin());
drop policy if exists "Admins delete paper logs" on storage.objects;
create policy "Admins delete paper logs" on storage.objects for delete to authenticated
  using (bucket_id = 'crm-documents' and (storage.foldername(name))[1] = (public.my_org_id())::text
         and (storage.foldername(name))[2] = 'paper-logs' and public.is_org_admin());

-- Records an uploaded file. The file must already be in this org's paper-logs folder for that property.
create or replace function public.paper_log_add(p_property uuid, p_date date, p_note text, p_path text, p_name text, p_mime text, p_size bigint)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.my_org_id(); v_id uuid;
begin
  if v_org is null or not public.is_org_admin() then raise exception 'Only admins can upload paper logs.' using errcode = '42501'; end if;
  if not exists (select 1 from public.properties where id = p_property and org_id = v_org) then
    raise exception 'Property not found.' using errcode = '22023';
  end if;
  if p_date is null then raise exception 'Enter the date the log covers.' using errcode = '22023'; end if;
  if p_date > (now() at time zone public.org__tz(v_org))::date + 1 then
    raise exception 'The log date can''t be in the future.' using errcode = '22023';
  end if;
  if p_path is null or p_path not like v_org::text || '/paper-logs/' || p_property::text || '/%' then
    raise exception 'Invalid file.' using errcode = '22023';
  end if;
  insert into public.property_paper_logs (org_id, property_id, log_date, note, file_path, file_name, mime_type, size_bytes, uploaded_by)
  values (v_org, p_property, p_date, left(btrim(coalesce(p_note, '')), 1000), p_path,
          left(coalesce(nullif(btrim(p_name), ''), 'paper-log'), 200), left(coalesce(p_mime, ''), 100), greatest(coalesce(p_size, 0), 0), auth.uid())
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.paper_log_add(uuid, date, text, text, text, text, bigint) from public, anon;
grant execute on function public.paper_log_add(uuid, date, text, text, text, text, bigint) to authenticated;

create or replace function public.paper_log_update(p_id uuid, p_date date, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.my_org_id();
begin
  if v_org is null or not public.is_org_admin() then raise exception 'Only admins can edit paper logs.' using errcode = '42501'; end if;
  if p_date is null then raise exception 'Enter the date the log covers.' using errcode = '22023'; end if;
  if p_date > (now() at time zone public.org__tz(v_org))::date + 1 then
    raise exception 'The log date can''t be in the future.' using errcode = '22023';
  end if;
  update public.property_paper_logs set log_date = p_date, note = left(btrim(coalesce(p_note, '')), 1000), updated_at = now()
   where id = p_id and org_id = v_org;
  if not found then raise exception 'Paper log not found.' using errcode = '22023'; end if;
end $$;
revoke all on function public.paper_log_update(uuid, date, text) from public, anon;
grant execute on function public.paper_log_update(uuid, date, text) to authenticated;

-- Deletes the record and returns its file path so the caller can remove the file.
create or replace function public.paper_log_delete(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.my_org_id(); v_path text;
begin
  if v_org is null or not public.is_org_admin() then raise exception 'Only admins can delete paper logs.' using errcode = '42501'; end if;
  delete from public.property_paper_logs where id = p_id and org_id = v_org returning file_path into v_path;
  if not found then raise exception 'Paper log not found.' using errcode = '22023'; end if;
  return v_path;
end $$;
revoke all on function public.paper_log_delete(uuid) from public, anon;
grant execute on function public.paper_log_delete(uuid) to authenticated;

-- Paper logs for one property, newest log date first, with the uploader's name.
create or replace function public.paper_logs(p_property uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := public.my_org_id();
begin
  if v_org is null or not public.is_org_admin() then raise exception 'Only admins can view paper logs.' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', l.id, 'property_id', l.property_id, 'log_date', l.log_date, 'note', l.note, 'file_path', l.file_path,
      'file_name', l.file_name, 'mime_type', l.mime_type, 'size_bytes', l.size_bytes, 'created_at', l.created_at,
      'uploaded_by_name', coalesce(nullif(btrim(pr.full_name), ''), 'Admin'))
      order by l.log_date desc, l.created_at desc)
    from public.property_paper_logs l left join public.profiles pr on pr.id = l.uploaded_by
    where l.org_id = v_org and l.property_id = p_property), '[]'::jsonb);
end $$;
revoke all on function public.paper_logs(uuid) from public, anon;
grant execute on function public.paper_logs(uuid) to authenticated;
