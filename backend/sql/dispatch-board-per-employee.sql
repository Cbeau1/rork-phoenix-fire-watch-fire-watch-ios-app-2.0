-- dispatch_board: staff gains auto_text / auto_email (per-employee shift-link auto-send).
-- Rollback: apply dispatch-board-before-per-employee.sql
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
end $function$
;
