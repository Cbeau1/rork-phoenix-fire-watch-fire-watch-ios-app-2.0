-- Rollback for patrol-timer-handoff.sql: restores sl_view, dispatch_board, dispatch__scan as they were on 2026-10-23.

CREATE OR REPLACE FUNCTION public.sl_view(p_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;

CREATE OR REPLACE FUNCTION public.dispatch_board()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
                     'phone', coalesce(nullif(st.phone, ''), (select wk.phone from public.wf_workers wk where wk.staff_id = st.id and wk.archived_at is null limit 1), ''),
                     'auto_text', coalesce((select wk.auto_link_text from public.wf_workers wk where wk.staff_id = st.id and wk.archived_at is null limit 1), false),
                     'auto_email', coalesce((select wk.auto_link_email from public.wf_workers wk where wk.staff_id = st.id and wk.archived_at is null limit 1), false)),
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
end $function$;

CREATE OR REPLACE FUNCTION public.dispatch__scan()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
end $function$;
