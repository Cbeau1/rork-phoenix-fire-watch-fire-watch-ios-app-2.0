-- Shift links: auto-send 1 hour before start (off by default), revoke log, link status details,
-- and live officer location on the dispatch map (only while checked in, stops at shift end).
-- Additive only.
-- Rollback:
--   drop function public.sl_ping(text,double precision,double precision,double precision,double precision,double precision);
--   drop function public.sl_auto__due(int); drop table public.shift_locations; drop table public.shift_link_auto;
--   alter table public.dispatch_settings drop column auto_link_text, drop column auto_link_email, drop column link_origin;
--   alter table public.shift_links drop column auto;
--   restore shift_events_kind_check without 'link_revoked'; re-apply dispatch_board / sl_issue / run_dispatch_tick
--   from dispatch-shift-links.sql.

-- ---------- settings: auto-send switches (default OFF) + the site address links point to ----------
alter table public.dispatch_settings add column if not exists auto_link_text boolean not null default false;
alter table public.dispatch_settings add column if not exists auto_link_email boolean not null default false;
alter table public.dispatch_settings add column if not exists link_origin text not null default '' check (char_length(link_origin) <= 200);

alter table public.shift_links add column if not exists auto boolean not null default false;

alter table public.shift_events drop constraint if exists shift_events_kind_check;
alter table public.shift_events add constraint shift_events_kind_check
  check (kind in ('check_in', 'check_out', 'override', 'link_sent', 'link_opened', 'link_revoked'));

-- One automatic attempt per shift (claimed before sending, so it can never double-send).
create table if not exists public.shift_link_auto (
  shift_id uuid primary key references public.shifts(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  attempted_at timestamptz not null default now(),
  ok boolean not null default false,
  note text not null default '' check (char_length(note) <= 1000)
);
alter table public.shift_link_auto enable row level security;
drop policy if exists "Admins read shift link auto" on public.shift_link_auto;
create policy "Admins read shift link auto" on public.shift_link_auto for select to authenticated
  using (org_id = public.my_org_id() and public.is_org_admin());
grant select on public.shift_link_auto to authenticated;
grant select, insert, update, delete on public.shift_link_auto to service_role;

-- ---------- live location pings ----------
create table if not exists public.shift_locations (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  shift_id uuid not null references public.shifts(id) on delete cascade,
  at timestamptz not null default now(),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  accuracy_m double precision,
  heading double precision,
  speed_mps double precision,
  distance_m double precision
);
create index if not exists shift_locations_shift_idx on public.shift_locations(shift_id, at desc);
create index if not exists shift_locations_at_idx on public.shift_locations(at);
alter table public.shift_locations enable row level security;
drop policy if exists "Admins read shift locations" on public.shift_locations;
create policy "Admins read shift locations" on public.shift_locations for select to authenticated
  using (org_id = public.my_org_id() and public.is_org_admin());
grant select on public.shift_locations to authenticated;
grant select, insert, delete on public.shift_locations to service_role;

/** Location ping from the guard's link page. Accepted only while checked in and before the shift ends. */
create or replace function public.sl_ping(p_hash text, p_lat double precision, p_lng double precision, p_acc double precision,
  p_heading double precision, p_speed double precision)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c jsonb; s public.shifts; p public.properties; e public.time_entries; d double precision; last_at timestamptz;
begin
  c := public.sl__ctx(p_hash);
  if now() >= (c->>'end')::timestamptz then return jsonb_build_object('ok', false, 'stop', true, 'reason', 'shift_ended'); end if;
  select * into s from public.shifts where id = (c->>'shift_id')::uuid;
  select * into e from public.time_entries where shift_id = s.id and clock_out is null and status = 'open' order by clock_in desc limit 1;
  if e.id is null then return jsonb_build_object('ok', false, 'stop', true, 'reason', 'not_checked_in'); end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'Invalid location.' using errcode = 'P0001';
  end if;
  select max(at) into last_at from public.shift_locations where shift_id = s.id;
  if last_at is not null and last_at > now() - interval '8 seconds' then return jsonb_build_object('ok', true, 'skipped', true); end if;
  select * into p from public.properties where id = s.property_id;
  if p.geofence_lat is not null then d := round(public.fw_distance_m(p_lat, p_lng, p.geofence_lat, p.geofence_lng)::numeric, 1); end if;
  insert into public.shift_locations(org_id, shift_id, lat, lng, accuracy_m, heading, speed_mps, distance_m)
  values (s.org_id, s.id, p_lat, p_lng, least(greatest(p_acc, 0), 100000), p_heading, p_speed, d);
  update public.shift_links set last_seen_at = now() where id = (c->>'link_id')::uuid;
  return jsonb_build_object('ok', true, 'ends_at', c->>'end');
end $$;

/** Shifts whose link should be auto-sent now (starts within the next hour, nothing sent yet, switch on). */
create or replace function public.sl_auto__due(p_limit int default 20)
returns table(shift_id uuid, org_id uuid) language sql stable security definer set search_path = public as $$
  select s.id, s.org_id
    from public.dispatch_settings ds
    join public.shifts s on s.org_id = ds.org_id
    cross join lateral (select public.shift__window(s, public.org__tz(s.org_id)) as win) w
   where (ds.auto_link_text or ds.auto_link_email)
     and s.staff_id is not null
     and s.shift_date between current_date - 1 and current_date + 2
     and lower(w.win) > now() and lower(w.win) <= now() + interval '60 minutes'
     and not exists (select 1 from public.shift_link_auto a where a.shift_id = s.id)
     and not exists (select 1 from public.shift_links l where l.shift_id = s.id and l.revoked_at is null)
   order by lower(w.win)
   limit greatest(1, least(p_limit, 50));
$$;

-- Issue a new link (revoking the old one). p_admin null = automatic send (service role only).
create or replace function public.sl_issue(p_shift uuid, p_hash text, p_admin uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.shifts; adm public.profiles; tz text; win tstzrange; l public.shift_links;
begin
  select * into s from public.shifts where id = p_shift;
  if p_admin is not null then
    select * into adm from public.profiles where id = p_admin and active and role = 'admin';
    if adm.id is null or s.id is null or s.org_id <> adm.org_id then raise exception 'Shift not found.' using errcode = 'P0001'; end if;
  elsif s.id is null then
    raise exception 'Shift not found.' using errcode = 'P0001';
  end if;
  tz := public.org__tz(s.org_id);
  win := public.shift__window(s, tz);
  if upper(win) + interval '12 hours' < now() then raise exception 'This shift ended too long ago to send a link.' using errcode = 'P0001'; end if;
  update public.shift_links set revoked_at = now() where shift_id = s.id and revoked_at is null;
  insert into public.shift_links(org_id, shift_id, token_hash, created_by, expires_at, auto)
  values (s.org_id, s.id, p_hash, adm.id, upper(win) + interval '12 hours', p_admin is null) returning * into l;
  return jsonb_build_object('id', l.id, 'expires_at', l.expires_at, 'org_id', s.org_id);
end $$;

-- ---------- dispatch board: + site location, live officer location/trail, link details ----------
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
          'property', jsonb_build_object('id', p.id, 'name', p.name, 'interval', p.patrol_interval_minutes, 'geofence', p.geofence_enabled,
                        'lat', p.geofence_lat, 'lng', p.geofence_lng, 'radius', p.geofence_radius_m),
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
                                             'last_seen_at', l.last_seen_at, 'send_error', l.send_error, 'expires_at', l.expires_at, 'auto', l.auto)
                     from public.shift_links l where l.shift_id = s.id and l.revoked_at is null limit 1),
          'revoked_at', (select max(l.revoked_at) from public.shift_links l where l.shift_id = s.id
                           and not exists (select 1 from public.shift_links l2 where l2.shift_id = s.id and l2.revoked_at is null)),
          'auto_attempt', (select jsonb_build_object('at', a.attempted_at, 'ok', a.ok, 'note', a.note) from public.shift_link_auto a where a.shift_id = s.id),
          'location', (select jsonb_build_object('lat', x.lat, 'lng', x.lng, 'accuracy_m', x.accuracy_m, 'at', x.at, 'distance_m', x.distance_m,
                                                 'heading', x.heading, 'speed_mps', x.speed_mps)
                         from public.shift_locations x where x.shift_id = s.id order by x.at desc limit 1),
          'trail', coalesce((select jsonb_agg(jsonb_build_array(t.lat, t.lng) order by t.at)
                               from (select x.lat, x.lng, x.at from public.shift_locations x
                                      where x.shift_id = s.id and x.at > now() - interval '90 minutes'
                                      order by x.at desc limit 240) t), '[]'::jsonb)
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

-- ---------- grants ----------
revoke all on function public.sl_ping(text,double precision,double precision,double precision,double precision,double precision) from public, anon, authenticated;
grant execute on function public.sl_ping(text,double precision,double precision,double precision,double precision,double precision) to service_role;
revoke all on function public.sl_auto__due(int) from public, anon, authenticated;
grant execute on function public.sl_auto__due(int) to service_role;
revoke all on function public.sl_issue(uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.sl_issue(uuid,text,uuid) to service_role;
revoke all on function public.dispatch_board() from public, anon;
grant execute on function public.dispatch_board() to authenticated;

-- ---------- cron: the 2-minute tick also auto-sends due links and trims old location pings ----------
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
  if exists (select 1 from public.sl_auto__due(1)) then
    perform net.http_post(
      url := 'https://lnavpbgqeqjhgjqjvmbz.supabase.co/functions/v1/shift-link',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
      body := '{"action":"auto"}'::jsonb
    );
  end if;
  delete from public.shift_locations where at < now() - interval '90 days';
end $$;
