-- 1) Admins can correct a submitted patrol report (time, officer, areas, status, notes).
--    Every correction keeps the before/after copy in patrol_edits.
-- 2) Fire inspector contact directory, optionally assigned to properties.
-- Rollback:
--   drop function public.patrol_edit(uuid, timestamptz, text, text[], text, text, text);
--   drop table public.patrol_edits;
--   alter table public.patrols drop column edited_at, drop column edited_by_name;
--   alter table public.properties drop column inspector_id;
--   drop table public.fire_inspectors;

-- ---------- patrol corrections ----------
alter table public.patrols add column if not exists edited_at timestamptz;
alter table public.patrols add column if not exists edited_by_name text not null default '';

create table if not exists public.patrol_edits (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  patrol_id uuid not null references public.patrols(id) on delete cascade,
  edited_at timestamptz not null default now(),
  edited_by uuid references public.profiles(id) on delete set null,
  edited_by_name text not null default '',
  reason text not null default '' check (char_length(reason) <= 500),
  before jsonb not null,
  after jsonb not null
);
create index if not exists patrol_edits_patrol_idx on public.patrol_edits(patrol_id, edited_at desc);
alter table public.patrol_edits enable row level security;
drop policy if exists "Admins read patrol edits" on public.patrol_edits;
create policy "Admins read patrol edits" on public.patrol_edits for select to authenticated
  using (org_id = public.my_org_id() and public.is_org_admin());
grant select on public.patrol_edits to authenticated;
grant select, insert, update, delete on public.patrol_edits to service_role;

create or replace function public.patrol_edit(
  p_id uuid, p_date_time timestamptz, p_officer text, p_areas text[], p_status text, p_notes text, p_reason text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me public.profiles;
  r public.patrols;
  v_areas text[];
  b jsonb;
  a jsonb;
begin
  select * into me from public.profiles where id = auth.uid();
  if me.id is null or not me.active or me.role <> 'admin' then
    raise exception 'Only admins can edit patrol reports.' using errcode = '42501';
  end if;
  select * into r from public.patrols where id = p_id for update;
  if r.id is null or r.org_id <> me.org_id then raise exception 'Report not found.' using errcode = 'P0002'; end if;

  if p_date_time is null then raise exception 'Enter the patrol date and time.'; end if;
  if p_date_time > now() + interval '10 minutes' then raise exception 'The patrol time can''t be in the future.'; end if;
  if p_date_time < now() - interval '2 years' then raise exception 'That date is too far in the past.'; end if;
  if coalesce(btrim(p_officer), '') = '' or char_length(p_officer) > 120 then raise exception 'Enter the officer name (up to 120 characters).'; end if;
  if p_status not in ('clear', 'follow-up', 'incident') then raise exception 'Pick a status.'; end if;
  if char_length(coalesce(p_notes, '')) > 8000 then raise exception 'Notes are too long (8,000 characters max).'; end if;
  select coalesce(array_agg(x), '{}') into v_areas
    from (select btrim(x) x from unnest(coalesce(p_areas, '{}')) x where btrim(x) <> '') t;
  if cardinality(v_areas) = 0 then raise exception 'Add at least one area.'; end if;
  if cardinality(v_areas) > 30 then raise exception 'Up to 30 areas.'; end if;

  b := jsonb_build_object('date_time', r.date_time, 'officer_name', r.officer_name, 'areas', to_jsonb(r.areas), 'status', r.status, 'notes', r.notes);
  a := jsonb_build_object('date_time', p_date_time, 'officer_name', btrim(p_officer), 'areas', to_jsonb(v_areas), 'status', p_status, 'notes', btrim(coalesce(p_notes, '')));
  if a = b then return jsonb_build_object('changed', false); end if;

  update public.patrols
     set date_time = p_date_time, officer_name = btrim(p_officer), areas = v_areas, status = p_status,
         notes = btrim(coalesce(p_notes, '')), edited_at = now(), edited_by_name = coalesce(me.full_name, '')
   where id = p_id;
  insert into public.patrol_edits(org_id, patrol_id, edited_by, edited_by_name, reason, before, after)
  values (r.org_id, r.id, me.id, coalesce(me.full_name, ''), left(btrim(coalesce(p_reason, '')), 500), b, a);
  return jsonb_build_object('changed', true, 'edited_at', now(), 'edited_by_name', coalesce(me.full_name, ''));
end $$;
revoke all on function public.patrol_edit(uuid, timestamptz, text, text[], text, text, text) from public, anon;
grant execute on function public.patrol_edit(uuid, timestamptz, text, text[], text, text, text) to authenticated;

-- ---------- fire inspectors ----------
create table if not exists public.fire_inspectors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null default public.my_org_id() references public.organizations(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  title text not null default '' check (char_length(title) <= 120),
  department text not null default '' check (char_length(department) <= 160),
  jurisdiction text not null default '' check (char_length(jurisdiction) <= 160),
  phone text not null default '' check (char_length(phone) <= 40),
  mobile text not null default '' check (char_length(mobile) <= 40),
  email text not null default '' check (char_length(email) <= 200),
  address text not null default '' check (char_length(address) <= 400),
  notes text not null default '' check (char_length(notes) <= 4000),
  created_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists fire_inspectors_org_idx on public.fire_inspectors(org_id, name);
alter table public.fire_inspectors enable row level security;
drop policy if exists "Members read inspectors" on public.fire_inspectors;
create policy "Members read inspectors" on public.fire_inspectors for select to authenticated
  using (org_id = public.my_org_id());
drop policy if exists "Admins add inspectors" on public.fire_inspectors;
create policy "Admins add inspectors" on public.fire_inspectors for insert to authenticated
  with check (org_id = public.my_org_id() and public.is_org_admin());
drop policy if exists "Admins update inspectors" on public.fire_inspectors;
create policy "Admins update inspectors" on public.fire_inspectors for update to authenticated
  using (org_id = public.my_org_id() and public.is_org_admin())
  with check (org_id = public.my_org_id() and public.is_org_admin());
drop policy if exists "Admins delete inspectors" on public.fire_inspectors;
create policy "Admins delete inspectors" on public.fire_inspectors for delete to authenticated
  using (org_id = public.my_org_id() and public.is_org_admin());
grant select, insert, update, delete on public.fire_inspectors to authenticated;
grant all on public.fire_inspectors to service_role;

alter table public.properties add column if not exists inspector_id uuid references public.fire_inspectors(id) on delete set null;

-- Assigning an inspector to a property (admin only, same org).
create or replace function public.property_set_inspector(p_property uuid, p_inspector uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_org_admin() then raise exception 'Only admins can assign inspectors.' using errcode = '42501'; end if;
  if not exists (select 1 from public.properties where id = p_property and org_id = public.my_org_id()) then
    raise exception 'Property not found.' using errcode = 'P0002';
  end if;
  if p_inspector is not null and not exists (select 1 from public.fire_inspectors where id = p_inspector and org_id = public.my_org_id()) then
    raise exception 'Inspector not found.' using errcode = 'P0002';
  end if;
  update public.properties set inspector_id = p_inspector where id = p_property;
  -- Keep the property's fire marshal contact (used in agreements and report recipients) in step.
  if p_inspector is not null then
    update public.properties p
       set fire_marshal_name = i.name, fire_marshal_phone = coalesce(nullif(i.phone, ''), i.mobile), fire_marshal_email = i.email
      from public.fire_inspectors i
     where p.id = p_property and i.id = p_inspector;
  end if;
end $$;
revoke all on function public.property_set_inspector(uuid, uuid) from public, anon;
grant execute on function public.property_set_inspector(uuid, uuid) to authenticated;

-- Editing an inspector updates the fire marshal contact on every property they're assigned to.
create or replace function public.fire_inspectors__sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  update public.properties
     set fire_marshal_name = new.name, fire_marshal_phone = coalesce(nullif(new.phone, ''), new.mobile), fire_marshal_email = new.email
   where inspector_id = new.id and org_id = new.org_id;
  return new;
end $$;
drop trigger if exists fire_inspectors_sync on public.fire_inspectors;
create trigger fire_inspectors_sync before update on public.fire_inspectors
  for each row execute function public.fire_inspectors__sync();
-- Rollback (extra): drop trigger fire_inspectors_sync on public.fire_inspectors; drop function public.fire_inspectors__sync();
