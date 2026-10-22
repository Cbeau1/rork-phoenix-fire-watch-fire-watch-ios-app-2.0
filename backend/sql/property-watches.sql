-- Fire watch start/stop per property. A "watch" is one engagement at a property: it starts on a date and is closed
-- out with END WATCH, which totals the watch's revenue/cost/profit (same rules as profit_dashboard), removes the
-- property's not-yet-worked scheduled shifts after the end, and blocks new shifts there until a new watch starts.
-- Additive only. Rollback:
--   drop trigger if exists shifts_watch_guard on public.shifts; drop trigger if exists properties_open_watch on public.properties;
--   drop function if exists public.shift__watch_guard(), public.property__open_watch(),
--     public.property_watch__totals(uuid, date, date), public.property_watches(), public.property_watch_preview(uuid, date, date),
--     public.property_watch_end(uuid, date, date), public.property_watch_start(uuid, date);
--   drop table if exists public.property_watches;

create table if not exists public.property_watches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  started_on date not null,
  ended_on date,
  ended_at timestamptz,
  ended_by uuid,
  summary jsonb,             -- totals frozen at close-out (for the record)
  shifts_cleared int not null default 0,
  created_at timestamptz not null default now(),
  created_by uuid,
  check (ended_on is null or ended_on >= started_on)
);
create unique index if not exists property_watches_one_open on public.property_watches (property_id) where ended_on is null;
create index if not exists property_watches_org on public.property_watches (org_id, property_id, started_on desc);

alter table public.property_watches enable row level security;
drop policy if exists "Org members read watches" on public.property_watches;
create policy "Org members read watches" on public.property_watches for select to authenticated
  using (org_id = public.my_org_id());
revoke all on public.property_watches from anon;
revoke insert, update, delete on public.property_watches from authenticated;
grant select on public.property_watches to authenticated;

-- Backfill: every existing property gets an open watch from its first activity (time entry, shift) or creation day.
insert into public.property_watches (org_id, property_id, started_on)
select p.org_id, p.id,
       least(
         (p.created_at at time zone public.org__tz(p.org_id))::date,
         coalesce((select min((t.clock_in at time zone public.org__tz(p.org_id))::date) from public.time_entries t where t.property_id = p.id), 'infinity'::date),
         coalesce((select min(s.shift_date) from public.shifts s where s.property_id = p.id), 'infinity'::date))
from public.properties p
where not exists (select 1 from public.property_watches w where w.property_id = p.id);

-- New properties start with an open watch from the day they're added (editable when the watch is ended).
create or replace function public.property__open_watch()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.property_watches (org_id, property_id, started_on, created_by)
  values (new.org_id, new.id, (now() at time zone public.org__tz(new.org_id))::date, auth.uid())
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists properties_open_watch on public.properties;
create trigger properties_open_watch after insert on public.properties for each row execute function public.property__open_watch();

-- No new shifts after a property's watch has ended (until a new watch is started).
create or replace function public.shift__watch_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_end date;
begin
  if tg_op = 'UPDATE' and new.shift_date = old.shift_date and new.property_id = old.property_id then return new; end if;
  if exists (select 1 from public.property_watches w where w.property_id = new.property_id and w.ended_on is null) then return new; end if;
  select max(ended_on) into v_end from public.property_watches w where w.property_id = new.property_id;
  if v_end is not null and new.shift_date > v_end then
    raise exception 'The fire watch at this property ended on %. Start a new watch on the Profit page to schedule it again.',
      to_char(v_end, 'Mon FMDD, YYYY') using errcode = '22023';
  end if;
  return new;
end $$;
drop trigger if exists shifts_watch_guard on public.shifts;
create trigger shifts_watch_guard before insert or update of shift_date, property_id on public.shifts
  for each row execute function public.shift__watch_guard();

-- Totals for one property over a date range, using profit_dashboard's rules (caller must be admin + pay).
create or replace function public.property_watch__totals(p_property uuid, p_start date, p_end date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_start date := greatest(p_start, p_end - 400); v jsonb; r jsonb;
begin
  v := public.profit_dashboard('custom', v_start, p_end);
  select e into r from jsonb_array_elements(v->'properties') e where (e->>'id')::uuid = p_property;
  r := coalesce(r, '{}'::jsonb);
  return jsonb_build_object(
    'from', v_start, 'to', p_end, 'truncated', v_start > p_start,
    'hours', coalesce((r->>'hours')::numeric, 0),
    'revenue', coalesce((r->>'revenue')::numeric, 0),
    'labor', coalesce((r->>'wages')::numeric, 0) + coalesce((r->>'burden')::numeric, 0) + coalesce((r->>'agency')::numeric, 0),
    'expenses', coalesce((r->>'expenses')::numeric, 0),
    'profit', coalesce((r->>'revenue')::numeric, 0) - coalesce((r->>'wages')::numeric, 0) - coalesce((r->>'burden')::numeric, 0)
              - coalesce((r->>'agency')::numeric, 0) - coalesce((r->>'expenses')::numeric, 0),
    'pending_hours', coalesce((r->>'pending_hours')::numeric, 0),
    'pending_revenue', coalesce((r->>'pending_revenue')::numeric, 0),
    'pending_cost', coalesce((r->>'pending_cost')::numeric, 0),
    'unpriced_revenue_hours', coalesce((r->>'unpriced_revenue_hours')::numeric, 0),
    'rate', r->'current_rate');
end $$;
revoke all on function public.property_watch__totals(uuid, date, date) from public, anon, authenticated;

-- Shifts END WATCH would remove: after the end day, plus later-today shifts not yet started when ending today.
-- Never removes a shift that already has clock-ins, patrols, incidents or payments attached.
create or replace function public.property_watch__clearable(p_property uuid, p_end date)
returns table (id uuid, shift_date date, start_time time)
language sql stable security definer set search_path = public as $$
  select s.id, s.shift_date, s.start_time
  from public.shifts s
  join public.properties p on p.id = s.property_id
  where s.property_id = p_property
    and (s.shift_date > p_end
         or (s.shift_date = p_end and p_end = (now() at time zone public.org__tz(p.org_id))::date
             and s.start_time > (now() at time zone public.org__tz(p.org_id))::time))
    and not exists (select 1 from public.time_entries t where t.shift_id = s.id)
    and not exists (select 1 from public.patrols x where x.shift_id = s.id)
    and not exists (select 1 from public.incidents x where x.shift_id = s.id)
    and not exists (select 1 from public.shift_payments x where x.shift_id = s.id)
  order by s.shift_date, s.start_time;
$$;
revoke all on function public.property_watch__clearable(uuid, date) from public, anon, authenticated;

create or replace function public.property_watch__guard()
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := public.my_org_id();
begin
  if v_org is null or not public.is_org_admin() then raise exception 'Only admins can manage fire watches.' using errcode = '42501'; end if;
  if not public.wf_has('pay') then raise exception 'You need the Employee pay permission to manage fire watches.' using errcode = '42501'; end if;
  return v_org;
end $$;
revoke all on function public.property_watch__guard() from public, anon, authenticated;

-- Profit page list: open watches with running totals, recently ended watches, properties with no open watch.
create or replace function public.property_watches()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := public.property_watch__guard(); v_today date := (now() at time zone public.org__tz(v_org))::date;
begin
  return jsonb_build_object(
    'today', v_today,
    'active', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', w.id, 'property_id', p.id, 'name', p.name, 'started_on', w.started_on,
        'totals', public.property_watch__totals(p.id, least(w.started_on, v_today), v_today),
        'upcoming_shifts', (select count(*) from public.shifts s where s.property_id = p.id and s.shift_date > v_today),
        'on_duty', (select count(*) from public.time_entries t where t.property_id = p.id and t.status = 'open' and t.clock_out is null))
        order by w.started_on, p.name)
      from public.property_watches w join public.properties p on p.id = w.property_id
      where w.org_id = v_org and w.ended_on is null), '[]'::jsonb),
    'ended', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', z.id, 'property_id', z.property_id, 'name', z.name, 'started_on', z.started_on, 'ended_on', z.ended_on,
        'ended_at', z.ended_at, 'shifts_cleared', z.shifts_cleared,
        'totals', public.property_watch__totals(z.property_id, z.started_on, z.ended_on))
        order by z.ended_on desc, z.ended_at desc)
      from (select w.*, p.name from public.property_watches w join public.properties p on p.id = w.property_id
            where w.org_id = v_org and w.ended_on is not null order by w.ended_on desc, w.ended_at desc limit 25) z), '[]'::jsonb),
    'idle', coalesce((
      select jsonb_agg(jsonb_build_object('property_id', p.id, 'name', p.name,
        'last_ended_on', (select max(ended_on) from public.property_watches w where w.property_id = p.id)) order by p.name)
      from public.properties p
      where p.org_id = v_org and not exists (select 1 from public.property_watches w where w.property_id = p.id and w.ended_on is null)), '[]'::jsonb));
end $$;
revoke all on function public.property_watches() from public, anon;
grant execute on function public.property_watches() to authenticated;

-- What END WATCH would do, without changing anything.
create or replace function public.property_watch_preview(p_watch uuid, p_start date, p_end date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := public.property_watch__guard(); w public.property_watches; v_today date := (now() at time zone public.org__tz(v_org))::date;
begin
  select * into w from public.property_watches where id = p_watch and org_id = v_org;
  if not found then raise exception 'Watch not found.' using errcode = '22023'; end if;
  if p_start is null or p_end is null or p_end < p_start then raise exception 'The end date must be on or after the start date.' using errcode = '22023'; end if;
  if p_end > v_today then raise exception 'The end date can''t be in the future.' using errcode = '22023'; end if;
  return jsonb_build_object(
    'totals', public.property_watch__totals(w.property_id, p_start, p_end),
    'clear', coalesce((select jsonb_agg(jsonb_build_object('date', c.shift_date, 'start', to_char(c.start_time, 'HH24:MI')))
                       from public.property_watch__clearable(w.property_id, p_end) c), '[]'::jsonb),
    'kept_shifts', (select count(*) from public.shifts s where s.property_id = w.property_id and s.shift_date > p_end)
                   - (select count(*) from public.property_watch__clearable(w.property_id, p_end) c where c.shift_date > p_end),
    'on_duty', (select count(*) from public.time_entries t where t.property_id = w.property_id and t.status = 'open' and t.clock_out is null),
    'later_entries', (select count(*) from public.time_entries t where t.property_id = w.property_id and t.status <> 'rejected'
                      and (t.clock_in at time zone public.org__tz(v_org))::date > p_end));
end $$;
revoke all on function public.property_watch_preview(uuid, date, date) from public, anon;
grant execute on function public.property_watch_preview(uuid, date, date) to authenticated;

-- END WATCH: close the watch, freeze its totals, clear not-yet-worked scheduled shifts after the end.
create or replace function public.property_watch_end(p_watch uuid, p_start date, p_end date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.property_watch__guard(); w public.property_watches; v_today date := (now() at time zone public.org__tz(v_org))::date;
  v_totals jsonb; v_n int;
begin
  select * into w from public.property_watches where id = p_watch and org_id = v_org for update;
  if not found then raise exception 'Watch not found.' using errcode = '22023'; end if;
  if w.ended_on is not null then raise exception 'This watch was already ended.' using errcode = '22023'; end if;
  if p_start is null or p_end is null or p_end < p_start then raise exception 'The end date must be on or after the start date.' using errcode = '22023'; end if;
  if p_end > v_today then raise exception 'The end date can''t be in the future.' using errcode = '22023'; end if;
  if exists (select 1 from public.property_watches x where x.property_id = w.property_id and x.id <> w.id
             and x.ended_on is not null and x.ended_on >= p_start) then
    raise exception 'That start date overlaps an earlier watch at this property.' using errcode = '22023';
  end if;

  v_totals := public.property_watch__totals(w.property_id, p_start, p_end);
  with gone as (
    delete from public.shifts s where s.id in (select c.id from public.property_watch__clearable(w.property_id, p_end) c) returning 1)
  select count(*) into v_n from gone;

  update public.property_watches
     set started_on = p_start, ended_on = p_end, ended_at = now(), ended_by = auth.uid(), summary = v_totals, shifts_cleared = v_n
   where id = w.id;
  return jsonb_build_object('totals', v_totals, 'shifts_cleared', v_n);
end $$;
revoke all on function public.property_watch_end(uuid, date, date) from public, anon;
grant execute on function public.property_watch_end(uuid, date, date) to authenticated;

-- Start a new watch at a property that has none open.
create or replace function public.property_watch_start(p_property uuid, p_start date)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.property_watch__guard(); v_last date; v_id uuid;
begin
  if not exists (select 1 from public.properties where id = p_property and org_id = v_org) then
    raise exception 'Property not found.' using errcode = '22023';
  end if;
  if exists (select 1 from public.property_watches where property_id = p_property and ended_on is null) then
    raise exception 'This property already has a watch running.' using errcode = '22023';
  end if;
  if p_start is null then raise exception 'Pick a start date.' using errcode = '22023'; end if;
  select max(ended_on) into v_last from public.property_watches where property_id = p_property;
  if v_last is not null and p_start <= v_last then
    raise exception 'The new watch must start after the last one ended (%).', to_char(v_last, 'Mon FMDD, YYYY') using errcode = '22023';
  end if;
  insert into public.property_watches (org_id, property_id, started_on, created_by)
  values (v_org, p_property, p_start, auth.uid()) returning id into v_id;
  return v_id;
end $$;
revoke all on function public.property_watch_start(uuid, date) from public, anon;
grant execute on function public.property_watch_start(uuid, date) to authenticated;
