-- Phase 3: no-login shift links, GPS check-in with admin override, shift patrols & incidents,
-- live dispatch board and overdue alerts. Additive only.
-- Rollback: drop the new tables/functions/cron job, drop the added columns, restore the
-- time_entries_source_check to ('clock','manual').

-- ---------- columns on existing tables ----------
alter table public.staff add column if not exists phone text not null default '' check (char_length(phone) <= 40);

alter table public.patrols add column if not exists shift_id uuid references public.shifts(id) on delete set null;
alter table public.patrols add column if not exists source text not null default 'app' check (source in ('app', 'link'));
alter table public.patrols add column if not exists client_op_id uuid;
alter table public.patrols add column if not exists outside_fence boolean not null default false;
create unique index if not exists patrols_client_op_uq on public.patrols(client_op_id) where client_op_id is not null;
create index if not exists patrols_shift_idx on public.patrols(shift_id, date_time desc) where shift_id is not null;

alter table public.time_entries drop constraint if exists time_entries_source_check;
alter table public.time_entries add constraint time_entries_source_check check (source in ('clock', 'manual', 'link'));

-- ---------- dispatch settings ----------
create table if not exists public.dispatch_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  alert_phones text[] not null default '{}',
  grace_minutes int not null default 10 check (grace_minutes between 0 and 120),
  late_minutes int not null default 15 check (late_minutes between 5 and 240),
  sms_alerts boolean not null default true,
  -- While test mode is on, every text/email goes ONLY to the test recipients below.
  test_mode boolean not null default true,
  test_phone text not null default '' check (char_length(test_phone) <= 40),
  test_email text not null default '' check (char_length(test_email) <= 200),
  updated_at timestamptz not null default now()
);
alter table public.dispatch_settings enable row level security;
drop policy if exists "Admins read dispatch settings" on public.dispatch_settings;
create policy "Admins read dispatch settings" on public.dispatch_settings for select to authenticated
  using (org_id = public.my_org_id() and public.is_org_admin());
drop policy if exists "Admins insert dispatch settings" on public.dispatch_settings;
create policy "Admins insert dispatch settings" on public.dispatch_settings for insert to authenticated
  with check (org_id = public.my_org_id() and public.is_org_admin());
drop policy if exists "Admins update dispatch settings" on public.dispatch_settings;
create policy "Admins update dispatch settings" on public.dispatch_settings for update to authenticated
  using (org_id = public.my_org_id() and public.is_org_admin())
  with check (org_id = public.my_org_id() and public.is_org_admin());
grant select, insert, update on public.dispatch_settings to authenticated;

insert into public.dispatch_settings(org_id, test_mode, test_phone, test_email)
values ('74c5cea5-343f-4647-93d8-f0d4622faf6a', true, '+16614317747', 'cb@phoenixfirewatch.com')
on conflict (org_id) do nothing;

-- ---------- shift links (token hashes only) ----------
create table if not exists public.shift_links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  shift_id uuid not null references public.shifts(id) on delete cascade,
  token_hash text not null unique check (char_length(token_hash) = 64),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  opened_at timestamptz,
  last_seen_at timestamptz,
  sent_to text not null default '',
  sent_at timestamptz,
  send_error text not null default ''
);
create unique index if not exists shift_links_one_active on public.shift_links(shift_id) where revoked_at is null;
alter table public.shift_links enable row level security; -- no policies: only the server reads/writes

-- ---------- append-only shift event log ----------
create table if not exists public.shift_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  shift_id uuid not null references public.shifts(id) on delete cascade,
  kind text not null check (kind in ('check_in', 'check_out', 'override', 'link_sent', 'link_opened')),
  at timestamptz not null default now(),
  received_at timestamptz not null default now(),
  actor_name text not null default '',
  lat double precision, lng double precision, accuracy_m double precision, distance_m double precision,
  overridden boolean not null default false,
  time_entry_id uuid references public.time_entries(id) on delete set null,
  note text not null default '' check (char_length(note) <= 2000),
  client_op_id uuid unique
);
create index if not exists shift_events_shift_idx on public.shift_events(shift_id, at);
alter table public.shift_events enable row level security;
drop policy if exists "Admins read shift events" on public.shift_events;
create policy "Admins read shift events" on public.shift_events for select to authenticated
  using (org_id = public.my_org_id() and public.is_org_admin());
grant select on public.shift_events to authenticated;

-- ---------- check-in location overrides ----------
create table if not exists public.checkin_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  shift_id uuid not null references public.shifts(id) on delete cascade,
  requested_at timestamptz not null default now(),
  lat double precision, lng double precision, accuracy_m double precision, distance_m double precision,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'used', 'expired')),
  decided_by uuid references public.profiles(id) on delete set null,
  decided_by_name text not null default '',
  decided_at timestamptz,
  used_at timestamptz
);
create unique index if not exists checkin_requests_one_open on public.checkin_requests(shift_id) where status in ('pending', 'approved');
alter table public.checkin_requests enable row level security;
drop policy if exists "Admins read checkin requests" on public.checkin_requests;
create policy "Admins read checkin requests" on public.checkin_requests for select to authenticated
  using (org_id = public.my_org_id() and public.is_org_admin());
grant select on public.checkin_requests to authenticated;

-- ---------- incidents ----------
create table if not exists public.incidents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  shift_id uuid references public.shifts(id) on delete set null,
  reported_by text not null default '' check (char_length(reported_by) <= 120),
  category text not null check (category in ('fire_smoke', 'alarm', 'hazard', 'injury', 'security', 'equipment', 'other')),
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high')),
  description text not null check (char_length(description) between 3 and 4000),
  photos text[] not null default '{}',
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  lat double precision, lng double precision, accuracy_m double precision, distance_m double precision,
  client_op_id uuid unique,
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_by_name text not null default '',
  resolution_note text not null default '' check (char_length(resolution_note) <= 2000)
);
create index if not exists incidents_org_idx on public.incidents(org_id, occurred_at desc);
alter table public.incidents enable row level security;
drop policy if exists "Members read incidents" on public.incidents;
create policy "Members read incidents" on public.incidents for select to authenticated using (org_id = public.my_org_id());
grant select on public.incidents to authenticated;

-- ---------- alerts ----------
create table if not exists public.dispatch_alerts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  shift_id uuid not null references public.shifts(id) on delete cascade,
  kind text not null check (kind in ('patrol_overdue', 'no_check_in')),
  due_at timestamptz not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  acknowledged_at timestamptz,
  acknowledged_by_name text not null default '',
  notified_at timestamptz,
  notify_error text not null default '',
  unique (shift_id, kind, due_at)
);
create index if not exists dispatch_alerts_open on public.dispatch_alerts(org_id) where resolved_at is null;
alter table public.dispatch_alerts enable row level security;
drop policy if exists "Admins read dispatch alerts" on public.dispatch_alerts;
create policy "Admins read dispatch alerts" on public.dispatch_alerts for select to authenticated
  using (org_id = public.my_org_id() and public.is_org_admin());
grant select on public.dispatch_alerts to authenticated;

-- =====================================================================
-- Shift-link functions (called only by the edge function with the service role)
-- =====================================================================
create or replace function public.sl__ctx(p_hash text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare l public.shift_links; s public.shifts; st public.staff; p public.properties; tz text; win tstzrange;
begin
  select * into l from public.shift_links where token_hash = p_hash;
  if l.id is null or l.revoked_at is not null then
    raise exception 'This shift link is no longer active. Ask your dispatcher for a new one.' using errcode = 'P0404';
  end if;
  if l.expires_at < now() then raise exception 'This shift link has expired.' using errcode = 'P0410'; end if;
  select * into s from public.shifts where id = l.shift_id;
  select * into st from public.staff where id = s.staff_id;
  select * into p from public.properties where id = s.property_id;
  tz := public.org__tz(s.org_id);
  win := public.shift__window(s, tz);
  return jsonb_build_object('link_id', l.id, 'org_id', s.org_id, 'shift_id', s.id, 'staff_id', st.id, 'staff_name', st.name,
    'profile_id', st.profile_id, 'property_id', p.id, 'tz', tz, 'start', lower(win), 'end', upper(win));
end $$;

/** Latest non-rejected time entry for a shift. */
create or replace function public.sl__entry(p_shift uuid)
returns public.time_entries language sql stable security definer set search_path = public as $$
  select * from public.time_entries where shift_id = p_shift and status <> 'rejected' order by clock_in desc limit 1;
$$;

create or replace function public.sl_view(p_hash text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c jsonb; s public.shifts; p public.properties; e public.time_entries; o public.organizations; r public.checkin_requests;
        last_at timestamptz; out jsonb;
begin
  c := public.sl__ctx(p_hash);
  select * into s from public.shifts where id = (c->>'shift_id')::uuid;
  select * into p from public.properties where id = s.property_id;
  select * into o from public.organizations where id = s.org_id;
  e := public.sl__entry(s.id);
  select * into r from public.checkin_requests where shift_id = s.id and status in ('pending', 'approved') order by requested_at desc limit 1;
  update public.shift_links set opened_at = coalesce(opened_at, now()), last_seen_at = now() where id = (c->>'link_id')::uuid;
  select max(date_time) into last_at from public.patrols where shift_id = s.id;
  out := jsonb_build_object(
    'company', o.name,
    'tz', c->>'tz',
    'guard', c->>'staff_name',
    'shift', jsonb_build_object('id', s.id, 'date', s.shift_date, 'start_time', s.start_time, 'end_time', s.end_time,
                                'starts_at', c->>'start', 'ends_at', c->>'end', 'notes', s.notes),
    'property', jsonb_build_object('id', p.id, 'name', p.name, 'address', p.address, 'access', p.access_instructions,
                                   'interval', p.patrol_interval_minutes, 'geofence', p.geofence_enabled,
                                   'lat', p.geofence_lat, 'lng', p.geofence_lng, 'radius', p.geofence_radius_m,
                                   'contact', p.contact_name, 'contact_phone', p.contact_phone),
    'entry', case when e.id is null then null else jsonb_build_object('id', e.id, 'clock_in', e.clock_in, 'clock_out', e.clock_out) end,
    'request', case when r.id is null then null else jsonb_build_object('id', r.id, 'status', r.status, 'distance_m', r.distance_m, 'requested_at', r.requested_at) end,
    'last_patrol_at', last_at,
    'patrols', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'at', x.date_time, 'status', x.status, 'areas', x.areas,
                         'notes', x.notes, 'photos', cardinality(x.photos), 'outside', x.outside_fence, 'client_op_id', x.client_op_id) order by x.date_time desc)
                         from (select * from public.patrols where shift_id = s.id order by date_time desc limit 30) x), '[]'::jsonb),
    'incidents', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'at', i.occurred_at, 'category', i.category, 'severity', i.severity,
                         'description', i.description, 'client_op_id', i.client_op_id) order by i.occurred_at desc)
                         from public.incidents i where i.shift_id = s.id), '[]'::jsonb),
    'handoff', (select note from public.shift_events where shift_id = s.id and kind = 'check_out' order by at desc limit 1),
    'previous_handoff', (select jsonb_build_object('note', ev.note, 'by', ev.actor_name, 'at', ev.at) from public.shift_events ev
                          join public.shifts s2 on s2.id = ev.shift_id
                          where s2.property_id = s.property_id and ev.kind = 'check_out' and ev.shift_id <> s.id and ev.note <> ''
                            and ev.at > now() - interval '3 days' and ev.at <= now()
                          order by ev.at desc limit 1)
  );
  return out;
end $$;

create or replace function public.sl_check_in(p_hash text, p_lat double precision, p_lng double precision, p_acc double precision, p_note text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare c jsonb; s public.shifts; p public.properties; st public.staff; e public.time_entries; r public.checkin_requests;
        d double precision; slack double precision; overridden boolean := false; v_lat double precision := p_lat; v_lng double precision := p_lng;
begin
  c := public.sl__ctx(p_hash);
  select * into s from public.shifts where id = (c->>'shift_id')::uuid for update;
  select * into p from public.properties where id = s.property_id;
  select * into st from public.staff where id = s.staff_id;
  if now() < (c->>'start')::timestamptz - interval '60 minutes' then
    raise exception 'Check-in opens 1 hour before the shift starts.' using errcode = 'P0001';
  end if;
  if now() >= (c->>'end')::timestamptz then raise exception 'This shift has already ended.' using errcode = 'P0001'; end if;

  e := public.sl__entry(s.id);
  if e.id is not null and e.clock_out is null then
    return jsonb_build_object('ok', true, 'already', true, 'entry_id', e.id, 'clock_in', e.clock_in);
  end if;

  if v_lat is not null and (v_lat not between -90 and 90 or v_lng not between -180 and 180) then v_lat := null; v_lng := null; end if;
  if v_lat is not null and p.geofence_lat is not null then
    d := round(public.fw_distance_m(v_lat, v_lng, p.geofence_lat, p.geofence_lng)::numeric, 1);
  end if;

  if p.geofence_enabled then
    if v_lat is null then
      raise exception 'Location is required to check in. Turn on location access for your browser and try again.' using errcode = 'P0001';
    end if;
    slack := least(greatest(coalesce(p_acc, 0), 0), 50);
    if d - slack > p.geofence_radius_m then
      select * into r from public.checkin_requests where shift_id = s.id and status in ('pending', 'approved') for update;
      if r.id is not null and r.status = 'approved' and r.decided_at > now() - interval '2 hours' then
        update public.checkin_requests set status = 'used', used_at = now() where id = r.id;
        overridden := true;
      else
        if r.id is null then
          insert into public.checkin_requests(org_id, shift_id, lat, lng, accuracy_m, distance_m)
          values (s.org_id, s.id, v_lat, v_lng, p_acc, d) returning * into r;
        elsif r.status = 'approved' then
          update public.checkin_requests set status = 'expired' where id = r.id;
          insert into public.checkin_requests(org_id, shift_id, lat, lng, accuracy_m, distance_m)
          values (s.org_id, s.id, v_lat, v_lng, p_acc, d) returning * into r;
        else
          update public.checkin_requests set lat = v_lat, lng = v_lng, accuracy_m = p_acc, distance_m = d, requested_at = now()
          where id = r.id returning * into r;
        end if;
        return jsonb_build_object('ok', false, 'blocked', true, 'distance_m', d, 'radius_m', p.geofence_radius_m, 'request_id', r.id);
      end if;
    end if;
  end if;

  if st.profile_id is not null and exists (select 1 from public.time_entries where profile_id = st.profile_id and clock_out is null) then
    raise exception 'You''re already clocked in on the app. Clock out there first, or ask your dispatcher.' using errcode = 'P0001';
  end if;

  insert into public.time_entries(org_id, profile_id, worker_name, property_id, clock_in, employee_note, shift_id, source)
  values (s.org_id, st.profile_id, st.name, s.property_id, now(), left(coalesce(p_note, ''), 500), s.id, 'link')
  returning * into e;
  insert into public.time_entry_log(org_id, entry_id, actor_id, actor_name, action, detail)
  values (s.org_id, e.id, null, st.name || ' (shift link)', 'clock_in',
          public.tc__snap(e) || jsonb_build_object('shift_id', s.id, 'distance_m', d, 'overridden', overridden));
  insert into public.shift_events(org_id, shift_id, kind, actor_name, lat, lng, accuracy_m, distance_m, overridden, time_entry_id, note)
  values (s.org_id, s.id, 'check_in', st.name, v_lat, v_lng, p_acc, d, overridden, e.id, left(coalesce(p_note, ''), 2000));
  -- A check-in resolves any "hasn't checked in" alert for this shift.
  update public.dispatch_alerts set resolved_at = now() where shift_id = s.id and kind = 'no_check_in' and resolved_at is null;
  return jsonb_build_object('ok', true, 'entry_id', e.id, 'clock_in', e.clock_in, 'distance_m', d, 'overridden', overridden);
end $$;

/** Where a queued/live action happened, relative to the site fence. */
create or replace function public.sl__fence(p public.properties, p_lat double precision, p_lng double precision, p_acc double precision)
returns jsonb language plpgsql immutable set search_path = public as $$
declare d double precision; slack double precision;
begin
  if p_lat is null or p_lng is null or p.geofence_lat is null then
    return jsonb_build_object('distance', null, 'outside', false, 'missing', p_lat is null);
  end if;
  d := round(public.fw_distance_m(p_lat, p_lng, p.geofence_lat, p.geofence_lng)::numeric, 1);
  slack := least(greatest(coalesce(p_acc, 0), 0), 50);
  return jsonb_build_object('distance', d, 'outside', p.geofence_enabled and d - slack > p.geofence_radius_m, 'missing', false);
end $$;

/** Clamp a device timestamp into the guard's time on shift. */
create or replace function public.sl__clamp_at(p_at timestamptz, e public.time_entries)
returns timestamptz language sql stable set search_path = public as $$
  select least(greatest(coalesce(p_at, now()), e.clock_in), coalesce(e.clock_out, now()), now());
$$;

create or replace function public.sl__entry_at(p_shift uuid, p_at timestamptz)
returns public.time_entries language sql stable security definer set search_path = public as $$
  select * from public.time_entries where shift_id = p_shift and status <> 'rejected'
     and clock_in - interval '5 minutes' <= coalesce(p_at, now())
     and (clock_out is null or clock_out + interval '10 minutes' >= coalesce(p_at, now()))
   order by clock_in desc limit 1;
$$;

create or replace function public.sl_patrol(p_hash text, p_client_id uuid, p_at timestamptz, p_lat double precision, p_lng double precision,
  p_acc double precision, p_areas text[], p_status text, p_notes text, p_photos text[], p_queued boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c jsonb; s public.shifts; p public.properties; st public.staff; e public.time_entries; f jsonb; pid uuid; at timestamptz;
        areas text[];
begin
  c := public.sl__ctx(p_hash);
  select id into pid from public.patrols where client_op_id = p_client_id;
  if pid is not null then return jsonb_build_object('ok', true, 'id', pid, 'duplicate', true); end if;
  select * into s from public.shifts where id = (c->>'shift_id')::uuid;
  select * into p from public.properties where id = s.property_id;
  select * into st from public.staff where id = s.staff_id;
  e := public.sl__entry_at(s.id, p_at);
  if e.id is null then raise exception 'Check in before logging patrols.' using errcode = 'P0001'; end if;
  if coalesce(p_status, '') not in ('clear', 'follow-up', 'incident') then raise exception 'Choose a patrol status.' using errcode = 'P0001'; end if;
  select coalesce(array_agg(left(trim(a), 120)), '{}') into areas from unnest(coalesce(p_areas, '{}')) a where trim(a) <> '';
  if cardinality(areas) = 0 then raise exception 'List at least one area patrolled.' using errcode = 'P0001'; end if;
  if exists (select 1 from unnest(coalesce(p_photos, '{}')) ph where ph not like s.org_id::text || '/link/' || s.id::text || '/%') then
    raise exception 'Invalid photo.' using errcode = 'P0001';
  end if;
  f := public.sl__fence(p, p_lat, p_lng, p_acc);
  if p.geofence_enabled and not coalesce(p_queued, false) then
    if (f->>'missing')::boolean then raise exception 'Location is required to log a patrol. Turn on location access and try again.' using errcode = 'P0001'; end if;
    if (f->>'outside')::boolean then
      raise exception 'You''re about % m from %. Patrols must be logged on site (within % m).', round((f->>'distance')::numeric), p.name, p.geofence_radius_m using errcode = 'P0001';
    end if;
  end if;
  at := public.sl__clamp_at(p_at, e);
  insert into public.patrols(org_id, property_id, date_time, officer_name, areas, status, notes, photos, logged_by,
                             latitude, longitude, location_accuracy_m, shift_id, source, client_op_id, outside_fence)
  values (s.org_id, s.property_id, at, st.name, areas, p_status, left(coalesce(p_notes, ''), 2000), coalesce(p_photos, '{}'), null,
          p_lat, p_lng, p_acc, s.id, 'link', p_client_id, coalesce((f->>'outside')::boolean, false) or (p.geofence_enabled and (f->>'missing')::boolean))
  returning id into pid;
  update public.dispatch_alerts set resolved_at = now() where shift_id = s.id and kind = 'patrol_overdue' and resolved_at is null;
  return jsonb_build_object('ok', true, 'id', pid, 'at', at, 'outside', coalesce((f->>'outside')::boolean, false));
end $$;

create or replace function public.sl_incident(p_hash text, p_client_id uuid, p_at timestamptz, p_lat double precision, p_lng double precision,
  p_acc double precision, p_category text, p_severity text, p_description text, p_photos text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare c jsonb; s public.shifts; p public.properties; st public.staff; e public.time_entries; f jsonb; iid uuid; at timestamptz;
begin
  c := public.sl__ctx(p_hash);
  select id into iid from public.incidents where client_op_id = p_client_id;
  if iid is not null then return jsonb_build_object('ok', true, 'id', iid, 'duplicate', true); end if;
  select * into s from public.shifts where id = (c->>'shift_id')::uuid;
  select * into p from public.properties where id = s.property_id;
  select * into st from public.staff where id = s.staff_id;
  e := public.sl__entry_at(s.id, p_at);
  if e.id is null then raise exception 'Check in before reporting from this shift.' using errcode = 'P0001'; end if;
  if char_length(trim(coalesce(p_description, ''))) < 3 then raise exception 'Describe what happened.' using errcode = 'P0001'; end if;
  if exists (select 1 from unnest(coalesce(p_photos, '{}')) ph where ph not like s.org_id::text || '/link/' || s.id::text || '/%') then
    raise exception 'Invalid photo.' using errcode = 'P0001';
  end if;
  f := public.sl__fence(p, p_lat, p_lng, p_acc);
  at := public.sl__clamp_at(p_at, e);
  insert into public.incidents(org_id, property_id, shift_id, reported_by, category, severity, description, photos, occurred_at,
                               lat, lng, accuracy_m, distance_m, client_op_id)
  values (s.org_id, s.property_id, s.id, st.name, p_category, coalesce(nullif(p_severity, ''), 'medium'), left(trim(p_description), 4000),
          coalesce(p_photos, '{}'), at, p_lat, p_lng, p_acc, (f->>'distance')::double precision, p_client_id)
  returning id into iid;
  return jsonb_build_object('ok', true, 'id', iid, 'at', at);
end $$;

create or replace function public.sl_check_out(p_hash text, p_client_id uuid, p_at timestamptz, p_lat double precision, p_lng double precision,
  p_acc double precision, p_handoff text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c jsonb; s public.shifts; p public.properties; st public.staff; e public.time_entries; f jsonb; at timestamptz; before public.time_entries;
begin
  c := public.sl__ctx(p_hash);
  if exists (select 1 from public.shift_events where client_op_id = p_client_id) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;
  select * into s from public.shifts where id = (c->>'shift_id')::uuid;
  select * into p from public.properties where id = s.property_id;
  select * into st from public.staff where id = s.staff_id;
  select * into e from public.time_entries where shift_id = s.id and clock_out is null and status = 'open' order by clock_in desc limit 1 for update;
  if e.id is null then raise exception 'You''re not checked in on this shift.' using errcode = 'P0001'; end if;
  before := e;
  at := least(greatest(coalesce(p_at, now()), e.clock_in + interval '1 second'), now());
  if at <= e.clock_in then at := e.clock_in + interval '1 second'; end if;
  update public.time_entries set clock_out = at, status = 'pending',
    employee_note = case when trim(coalesce(p_handoff, '')) = '' then employee_note else left(trim(p_handoff), 500) end,
    updated_at = now()
  where id = e.id returning * into e;
  insert into public.time_entry_log(org_id, entry_id, actor_id, actor_name, action, detail)
  values (s.org_id, e.id, null, st.name || ' (shift link)', 'clock_out', public.tc__snap(e));
  f := public.sl__fence(p, p_lat, p_lng, p_acc);
  insert into public.shift_events(org_id, shift_id, kind, at, actor_name, lat, lng, accuracy_m, distance_m, time_entry_id, note, client_op_id)
  values (s.org_id, s.id, 'check_out', at, st.name, p_lat, p_lng, p_acc, (f->>'distance')::double precision, e.id,
          left(trim(coalesce(p_handoff, '')), 2000), p_client_id);
  update public.dispatch_alerts set resolved_at = now() where shift_id = s.id and resolved_at is null;
  return jsonb_build_object('ok', true, 'clock_out', at);
end $$;

-- Issue a new link (revoking the old one). Caller (edge function) has verified the admin.
create or replace function public.sl_issue(p_shift uuid, p_hash text, p_admin uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.shifts; adm public.profiles; tz text; win tstzrange; l public.shift_links;
begin
  select * into adm from public.profiles where id = p_admin and active and role = 'admin';
  select * into s from public.shifts where id = p_shift;
  if adm.id is null or s.id is null or s.org_id <> adm.org_id then raise exception 'Shift not found.' using errcode = 'P0001'; end if;
  tz := public.org__tz(s.org_id);
  win := public.shift__window(s, tz);
  if upper(win) + interval '12 hours' < now() then raise exception 'This shift ended too long ago to send a link.' using errcode = 'P0001'; end if;
  update public.shift_links set revoked_at = now() where shift_id = s.id and revoked_at is null;
  insert into public.shift_links(org_id, shift_id, token_hash, created_by, expires_at)
  values (s.org_id, s.id, p_hash, adm.id, upper(win) + interval '12 hours') returning * into l;
  return jsonb_build_object('id', l.id, 'expires_at', l.expires_at, 'org_id', s.org_id);
end $$;

-- =====================================================================
-- Admin RPCs (authenticated)
-- =====================================================================
create or replace function public.dispatch_board()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare me public.profiles; tz text;
begin
  me := public.tc__admin();
  tz := public.org__tz(me.org_id);
  return jsonb_build_object(
    'tz', tz,
    'now', now(),
    'shifts', coalesce((
      select jsonb_agg(row order by row->>'starts_at') from (
        select jsonb_build_object(
          'id', s.id, 'date', s.shift_date, 'start_time', s.start_time, 'end_time', s.end_time,
          'starts_at', lower(w.win), 'ends_at', upper(w.win), 'notes', s.notes,
          'property', jsonb_build_object('id', p.id, 'name', p.name, 'interval', p.patrol_interval_minutes, 'geofence', p.geofence_enabled),
          'staff', jsonb_build_object('id', st.id, 'name', st.name, 'profile_id', st.profile_id,
                     'phone', coalesce(nullif(st.phone, ''), (select wk.phone from public.wf_workers wk where wk.staff_id = st.id and wk.archived_at is null limit 1), '')),
          'entry', (select jsonb_build_object('id', e.id, 'clock_in', e.clock_in, 'clock_out', e.clock_out, 'source', e.source)
                      from public.time_entries e where e.shift_id = s.id and e.status <> 'rejected' order by e.clock_in desc limit 1),
          'check_in', (select jsonb_build_object('distance_m', ev.distance_m, 'overridden', ev.overridden, 'at', ev.at)
                         from public.shift_events ev where ev.shift_id = s.id and ev.kind = 'check_in' order by ev.at desc limit 1),
          'handoff', (select ev.note from public.shift_events ev where ev.shift_id = s.id and ev.kind = 'check_out' order by ev.at desc limit 1),
          'last_patrol_at', (select max(pa.date_time) from public.patrols pa where pa.shift_id = s.id
                               or (pa.shift_id is null and pa.property_id = s.property_id and pa.date_time >= lower(w.win) - interval '1 hour' and pa.date_time < upper(w.win))),
          'patrols', (select count(*) from public.patrols pa where pa.shift_id = s.id),
          'outside_patrols', (select count(*) from public.patrols pa where pa.shift_id = s.id and pa.outside_fence),
          'incidents', (select count(*) from public.incidents i where i.shift_id = s.id and i.resolved_at is null),
          'request', (select jsonb_build_object('id', r.id, 'status', r.status, 'distance_m', r.distance_m, 'accuracy_m', r.accuracy_m, 'requested_at', r.requested_at)
                        from public.checkin_requests r where r.shift_id = s.id and r.status in ('pending', 'approved') limit 1),
          'link', (select jsonb_build_object('created_at', l.created_at, 'sent_at', l.sent_at, 'sent_to', l.sent_to, 'opened_at', l.opened_at,
                                             'last_seen_at', l.last_seen_at, 'send_error', l.send_error, 'expires_at', l.expires_at)
                     from public.shift_links l where l.shift_id = s.id and l.revoked_at is null limit 1)
        ) as row
        from public.shifts s
        cross join lateral (select public.shift__window(s, tz) as win) w
        join public.properties p on p.id = s.property_id
        join public.staff st on st.id = s.staff_id
        where s.org_id = me.org_id and s.shift_date between (now() at time zone tz)::date - 2 and (now() at time zone tz)::date + 2
          and upper(w.win) > now() - interval '10 hours' and lower(w.win) < now() + interval '20 hours'
      ) q), '[]'::jsonb),
    'alerts', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'shift_id', a.shift_id, 'kind', a.kind, 'due_at', a.due_at,
                         'created_at', a.created_at, 'acknowledged_at', a.acknowledged_at, 'acknowledged_by', a.acknowledged_by_name,
                         'notified_at', a.notified_at, 'notify_error', a.notify_error) order by a.created_at desc)
                       from public.dispatch_alerts a where a.org_id = me.org_id and a.resolved_at is null), '[]'::jsonb),
    'incidents', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'shift_id', i.shift_id, 'property', p.name, 'reported_by', i.reported_by,
                          'category', i.category, 'severity', i.severity, 'description', i.description, 'photos', i.photos,
                          'occurred_at', i.occurred_at, 'distance_m', i.distance_m) order by i.occurred_at desc)
                        from public.incidents i join public.properties p on p.id = i.property_id
                        where i.org_id = me.org_id and i.resolved_at is null), '[]'::jsonb)
  );
end $$;

create or replace function public.dispatch_decide_request(p_id uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = public as $$
declare me public.profiles; r public.checkin_requests;
begin
  me := public.tc__admin();
  select * into r from public.checkin_requests where id = p_id and org_id = me.org_id for update;
  if r.id is null then raise exception 'Request not found.'; end if;
  if r.status <> 'pending' then raise exception 'This request was already handled.'; end if;
  update public.checkin_requests set status = case when p_approve then 'approved' else 'denied' end,
    decided_by = me.id, decided_by_name = me.full_name, decided_at = now() where id = r.id;
  insert into public.shift_events(org_id, shift_id, kind, actor_name, lat, lng, accuracy_m, distance_m, note)
  values (r.org_id, r.shift_id, 'override', me.full_name, r.lat, r.lng, r.accuracy_m, r.distance_m,
          case when p_approve then 'Approved off-site check-in' else 'Denied off-site check-in' end);
end $$;

create or replace function public.dispatch_ack_alert(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me public.profiles;
begin
  me := public.tc__admin();
  update public.dispatch_alerts set acknowledged_at = coalesce(acknowledged_at, now()), acknowledged_by_name = me.full_name
   where id = p_id and org_id = me.org_id;
  if not found then raise exception 'Alert not found.'; end if;
end $$;

create or replace function public.dispatch_resolve_incident(p_id uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare me public.profiles;
begin
  me := public.tc__admin();
  update public.incidents set resolved_at = now(), resolved_by = me.id, resolved_by_name = me.full_name,
         resolution_note = left(trim(coalesce(p_note, '')), 2000)
   where id = p_id and org_id = me.org_id and resolved_at is null;
  if not found then raise exception 'This incident was already resolved.'; end if;
end $$;

-- =====================================================================
-- Alert scan (cron → edge function → this). Returns new alerts to text out.
-- =====================================================================
create or replace function public.dispatch__scan()
returns jsonb language plpgsql security definer set search_path = public as $$
declare out jsonb;
begin
  -- Close alerts for shifts that have ended.
  update public.dispatch_alerts a set resolved_at = now()
    from public.shifts s
   where a.shift_id = s.id and a.resolved_at is null and upper(public.shift__window(s, public.org__tz(s.org_id))) < now();

  with ds as (
    select o.id org_id, coalesce(d.grace_minutes, 10) grace, coalesce(d.late_minutes, 15) late, public.org__tz(o.id) tz
      from public.organizations o left join public.dispatch_settings d on d.org_id = o.id
  ), live as (
    select s.*, ds.grace, ds.late, public.shift__window(s, ds.tz) win, p.patrol_interval_minutes iv
      from public.shifts s join ds on ds.org_id = s.org_id join public.properties p on p.id = s.property_id
     where s.shift_date between current_date - 2 and current_date + 1
  ), overdue as (
    select l.id shift_id, l.org_id, e.clock_in,
           greatest(e.clock_in, coalesce((select max(pa.date_time) from public.patrols pa where pa.shift_id = l.id
                    or (pa.shift_id is null and pa.property_id = l.property_id and pa.date_time >= e.clock_in)), e.clock_in))
             + make_interval(mins => l.iv) as due, l.grace
      from live l
      join lateral (select * from public.time_entries t where t.shift_id = l.id and t.clock_out is null and t.status = 'open' order by t.clock_in desc limit 1) e on true
     where now() < upper(l.win)
  ), ins1 as (
    insert into public.dispatch_alerts(org_id, shift_id, kind, due_at)
    select org_id, shift_id, 'patrol_overdue', due from overdue where now() > due + make_interval(mins => grace)
    on conflict (shift_id, kind, due_at) do nothing returning *
  ), ins2 as (
    insert into public.dispatch_alerts(org_id, shift_id, kind, due_at)
    select l.org_id, l.id, 'no_check_in', lower(l.win) from live l
     where now() > lower(l.win) + make_interval(mins => l.late) and now() < upper(l.win)
       and not exists (select 1 from public.time_entries t where t.shift_id = l.id and t.status <> 'rejected')
    on conflict (shift_id, kind, due_at) do nothing returning *
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'org_id', a.org_id, 'kind', a.kind, 'due_at', a.due_at,
           'property', p.name, 'guard', st.name, 'tz', public.org__tz(a.org_id))), '[]'::jsonb) into out
    from (select * from ins1 union all select * from ins2) a
    join public.shifts s on s.id = a.shift_id join public.properties p on p.id = s.property_id join public.staff st on st.id = s.staff_id;

  -- A newer overdue alert supersedes the previous one for the same shift.
  update public.dispatch_alerts a set resolved_at = now()
   where a.kind = 'patrol_overdue' and a.resolved_at is null
     and exists (select 1 from public.dispatch_alerts b where b.shift_id = a.shift_id and b.kind = 'patrol_overdue' and b.due_at > a.due_at);
  return out;
end $$;

-- ---------- grants ----------
do $$
declare f text;
begin
  foreach f in array array[
    'sl__ctx(text)', 'sl__entry(uuid)', 'sl_view(text)', 'sl_check_in(text,double precision,double precision,double precision,text)',
    'sl__fence(public.properties,double precision,double precision,double precision)', 'sl__clamp_at(timestamptz,public.time_entries)',
    'sl__entry_at(uuid,timestamptz)',
    'sl_patrol(text,uuid,timestamptz,double precision,double precision,double precision,text[],text,text,text[],boolean)',
    'sl_incident(text,uuid,timestamptz,double precision,double precision,double precision,text,text,text,text[])',
    'sl_check_out(text,uuid,timestamptz,double precision,double precision,double precision,text)',
    'sl_issue(uuid,text,uuid)', 'dispatch__scan()'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  foreach f in array array['dispatch_board()', 'dispatch_decide_request(uuid,boolean)', 'dispatch_ack_alert(uuid)', 'dispatch_resolve_incident(uuid,text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

grant select, insert, update, delete on public.shift_links, public.shift_events, public.checkin_requests, public.incidents, public.dispatch_alerts, public.dispatch_settings to service_role;

-- ---------- cron: alert scan every 2 minutes ----------
create or replace function private.run_dispatch_tick()
returns void language plpgsql security definer set search_path = '' as $$
declare v_secret text;
begin
  select value into v_secret from private.app_secrets where name = 'cron';
  perform net.http_post(
    url := 'https://lnavpbgqeqjhgjqjvmbz.supabase.co/functions/v1/dispatch-tick',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := '{}'::jsonb
  );
end $$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'phoenix-dispatch-tick') then
    perform cron.unschedule('phoenix-dispatch-tick');
  end if;
  perform cron.schedule('phoenix-dispatch-tick', '*/2 * * * *', 'select private.run_dispatch_tick()');
end $$;
