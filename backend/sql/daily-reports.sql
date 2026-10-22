-- Phase 4: daily 9 a.m. (property-local) patrol report PDFs by email. Additive only.
-- Every run is recorded in daily_report_runs (sent / skipped / failed + error), failures are
-- retried automatically up to 3 times and can be retried by an admin at any time.
-- Rollback: select cron.unschedule('phoenix-daily-reports'); drop function private.run_daily_reports(),
-- public.daily_report__claim(int), public.daily_report__data(uuid,timestamptz,timestamptz), public.daily_report__tz(uuid), public.daily_report_upsert_settings(uuid,boolean,text[],boolean,boolean,text);
-- drop table public.daily_report_runs, public.daily_report_settings; empty + delete bucket 'daily-reports'.

-- ---------- per-property settings (off by default) ----------
create table if not exists public.daily_report_settings (
  property_id uuid primary key references public.properties(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  enabled boolean not null default false,
  recipients text[] not null default '{}' check (cardinality(recipients) <= 20),
  include_photos boolean not null default true,
  send_when_empty boolean not null default false,
  -- IANA zone; '' = use the organization's timezone.
  timezone text not null default '' check (char_length(timezone) <= 64),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);
alter table public.daily_report_settings enable row level security;
drop policy if exists "Admins read daily report settings" on public.daily_report_settings;
create policy "Admins read daily report settings" on public.daily_report_settings for select to authenticated
  using (org_id = public.my_org_id() and public.is_org_admin());
revoke all on public.daily_report_settings from anon;
grant select on public.daily_report_settings to authenticated;
grant select, insert, update, delete on public.daily_report_settings to service_role;

-- ---------- run log (one scheduled run per property per local day) ----------
create table if not exists public.daily_report_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  report_date date not null,
  tz text not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  trigger text not null default 'schedule' check (trigger in ('schedule', 'manual')),
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed', 'skipped')),
  attempts int not null default 0,
  last_attempt_at timestamptz,
  next_retry_at timestamptz,
  intended_to text[] not null default '{}',
  sent_to text[] not null default '{}',
  test_mode boolean not null default false,
  patrol_count int not null default 0,
  incident_count int not null default 0,
  photo_count int not null default 0,
  pdf_path text not null default '',
  note text not null default '',
  error text not null default '',
  email_id text not null default '',
  requested_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create unique index if not exists daily_report_runs_sched_uq on public.daily_report_runs(property_id, report_date) where trigger = 'schedule';
create index if not exists daily_report_runs_prop_idx on public.daily_report_runs(property_id, created_at desc);
create index if not exists daily_report_runs_org_idx on public.daily_report_runs(org_id, created_at desc);
create index if not exists daily_report_runs_retry_idx on public.daily_report_runs(next_retry_at) where status = 'failed';
alter table public.daily_report_runs enable row level security;
drop policy if exists "Admins read daily report runs" on public.daily_report_runs;
create policy "Admins read daily report runs" on public.daily_report_runs for select to authenticated
  using (org_id = public.my_org_id() and public.is_org_admin());
revoke all on public.daily_report_runs from anon;
grant select on public.daily_report_runs to authenticated;
grant select, insert, update, delete on public.daily_report_runs to service_role;

-- ---------- private PDF storage (org/property/date-run.pdf) ----------
insert into storage.buckets (id, name, public) values ('daily-reports', 'daily-reports', false)
  on conflict (id) do nothing;
drop policy if exists "Admins read daily reports" on storage.objects;
create policy "Admins read daily reports" on storage.objects for select to authenticated
  using (bucket_id = 'daily-reports' and (storage.foldername(name))[1] = public.my_org_id()::text and public.is_org_admin());

-- ---------- helpers ----------
create or replace function public.daily_report__tz(p_property uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(nullif(s.timezone, ''), public.org__tz(p.org_id))
  from public.properties p
  left join public.daily_report_settings s on s.property_id = p.id
  where p.id = p_property;
$$;
revoke all on function public.daily_report__tz(uuid) from public, anon, authenticated;

-- Admin: save settings for one property (validates org, emails, timezone server-side).
create or replace function public.daily_report_upsert_settings(
  p_property uuid, p_enabled boolean, p_recipients text[], p_include_photos boolean,
  p_send_when_empty boolean, p_timezone text
) returns public.daily_report_settings
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid;
  v_list text[];
  v_tz text := btrim(coalesce(p_timezone, ''));
  v_row public.daily_report_settings;
  v_e text;
begin
  if not public.is_org_admin() then raise exception 'Only admins can change daily reports.'; end if;
  select org_id into v_org from public.properties where id = p_property;
  if v_org is null or v_org <> public.my_org_id() then raise exception 'Property not found.'; end if;

  select coalesce(array_agg(distinct e), '{}') into v_list
  from (select lower(btrim(x)) e from unnest(coalesce(p_recipients, '{}')) x) t where e <> '';
  if cardinality(v_list) > 20 then raise exception 'Up to 20 recipients.'; end if;
  foreach v_e in array v_list loop
    if v_e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Not a valid email: %', v_e; end if;
  end loop;
  if v_tz <> '' and not exists (select 1 from pg_catalog.pg_timezone_names where name = v_tz) then
    raise exception 'Unknown timezone: %', v_tz;
  end if;
  if coalesce(p_enabled, false) and cardinality(v_list) = 0 then
    raise exception 'Add at least one recipient before turning on daily reports.';
  end if;

  insert into public.daily_report_settings as s
    (property_id, org_id, enabled, recipients, include_photos, send_when_empty, timezone, updated_at, updated_by)
  values (p_property, v_org, coalesce(p_enabled, false), v_list, coalesce(p_include_photos, true),
          coalesce(p_send_when_empty, false), v_tz, now(), auth.uid())
  on conflict (property_id) do update set
    enabled = excluded.enabled, recipients = excluded.recipients, include_photos = excluded.include_photos,
    send_when_empty = excluded.send_when_empty, timezone = excluded.timezone,
    updated_at = now(), updated_by = auth.uid()
  returning * into v_row;
  return v_row;
end $$;
revoke all on function public.daily_report_upsert_settings(uuid, boolean, text[], boolean, boolean, text) from public, anon;
grant execute on function public.daily_report_upsert_settings(uuid, boolean, text[], boolean, boolean, text) to authenticated;

-- Service: create due scheduled runs (09:00–12:59 local, once per day), pick up due retries and
-- runs stuck mid-send, and mark them all 'sending'. Concurrency-safe (skip locked + unique index).
create or replace function public.daily_report__claim(p_limit int default 5)
returns setof public.daily_report_runs
language plpgsql security definer set search_path = '' as $$
begin
  -- Sends that died mid-flight after the last automatic attempt become visible failures.
  update public.daily_report_runs
     set status = 'failed', error = 'The send did not finish (timed out). Use Retry to send again.'
   where status = 'sending' and attempts >= 3 and last_attempt_at < now() - interval '15 minutes';

  insert into public.daily_report_runs (org_id, property_id, report_date, tz, window_start, window_end, trigger, status)
  select s.org_id, s.property_id, d.local_date, d.tz,
         ((d.local_date - 1) + time '09:00') at time zone d.tz,
         (d.local_date + time '09:00') at time zone d.tz,
         'schedule', 'queued'
  from public.daily_report_settings s
  join public.properties p on p.id = s.property_id and p.org_id = s.org_id
  cross join lateral (
    select coalesce(nullif(s.timezone, ''), public.org__tz(s.org_id)) tz
  ) z
  cross join lateral (
    select z.tz, (now() at time zone z.tz)::date local_date, (now() at time zone z.tz)::time local_time
  ) d
  where s.enabled and cardinality(s.recipients) > 0
    and d.local_time >= time '09:00' and d.local_time < time '13:00'
  on conflict (property_id, report_date) where trigger = 'schedule' do nothing;

  return query
  with picked as (
    select r.id from public.daily_report_runs r
    where (r.status = 'queued')
       or (r.status = 'failed' and r.trigger = 'schedule' and r.attempts < 3 and r.next_retry_at <= now())
       or (r.status = 'sending' and r.last_attempt_at < now() - interval '15 minutes' and r.attempts < 3)
    order by r.created_at
    limit greatest(1, least(coalesce(p_limit, 5), 20))
    for update skip locked
  )
  update public.daily_report_runs r
     set status = 'sending', attempts = r.attempts + 1, last_attempt_at = now(), next_retry_at = null
    from picked where r.id = picked.id
  returning r.*;
end $$;
revoke all on function public.daily_report__claim(int) from public, anon, authenticated;
grant execute on function public.daily_report__claim(int) to service_role;

-- Service: everything the PDF needs for one property + window.
create or replace function public.daily_report__data(p_property uuid, p_start timestamptz, p_end timestamptz)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'org', (select jsonb_build_object('id', o.id, 'name', o.name) from public.organizations o where o.id = p.org_id),
    'property', jsonb_build_object(
      'id', p.id, 'name', p.name, 'address', p.address, 'contact_name', p.contact_name,
      'patrol_interval_minutes', p.patrol_interval_minutes),
    'patrols', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'at', x.date_time, 'officer', x.officer_name, 'areas', x.areas, 'status', x.status,
        'notes', x.notes, 'photos', x.photos, 'outside_fence', x.outside_fence, 'source', x.source,
        'distance_m', x.geofence_distance_m) order by x.date_time)
      from public.patrols x where x.property_id = p.id and x.date_time >= p_start and x.date_time < p_end), '[]'),
    'incidents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'at', i.occurred_at, 'reported_by', i.reported_by, 'category', i.category,
        'severity', i.severity, 'description', i.description, 'photos', i.photos,
        'resolved_at', i.resolved_at, 'resolved_by', i.resolved_by_name, 'resolution', i.resolution_note) order by i.occurred_at)
      from public.incidents i where i.property_id = p.id and i.occurred_at >= p_start and i.occurred_at < p_end), '[]'),
    'time', coalesce((
      select jsonb_agg(jsonb_build_object(
        'worker', t.worker_name, 'clock_in', t.clock_in, 'clock_out', t.clock_out, 'source', t.source) order by t.clock_in)
      from public.time_entries t where t.property_id = p.id
        and t.clock_in < p_end and coalesce(t.clock_out, 'infinity'::timestamptz) > p_start), '[]'),
    'handoffs', coalesce((
      select jsonb_agg(jsonb_build_object('at', e.at, 'by', e.actor_name, 'note', e.note) order by e.at)
      from public.shift_events e join public.shifts sh on sh.id = e.shift_id
      where sh.property_id = p.id and e.kind = 'check_out' and btrim(coalesce(e.note, '')) <> ''
        and e.at >= p_start and e.at < p_end), '[]')
  )
  from public.properties p where p.id = p_property;
$$;
revoke all on function public.daily_report__data(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.daily_report__data(uuid, timestamptz, timestamptz) to service_role;

-- ---------- cron: every 5 minutes ----------
create or replace function private.run_daily_reports()
returns void language plpgsql security definer set search_path = '' as $$
declare v_secret text;
begin
  -- Only call the function when there is work, to keep the edge function quiet otherwise.
  if not exists (
    select 1 from public.daily_report_settings s
    where s.enabled and cardinality(s.recipients) > 0
      and (now() at time zone public.daily_report__tz(s.property_id))::time >= time '09:00'
      and (now() at time zone public.daily_report__tz(s.property_id))::time < time '13:00'
      and not exists (
        select 1 from public.daily_report_runs r
        where r.property_id = s.property_id and r.trigger = 'schedule'
          and r.report_date = (now() at time zone public.daily_report__tz(s.property_id))::date)
  ) and not exists (
    select 1 from public.daily_report_runs r
    where r.status = 'queued'
       or (r.status = 'failed' and r.trigger = 'schedule' and r.attempts < 3 and r.next_retry_at <= now())
       or (r.status = 'sending' and r.last_attempt_at < now() - interval '15 minutes')
  ) then
    return;
  end if;
  select value into v_secret from private.app_secrets where name = 'cron';
  perform net.http_post(
    url := 'https://lnavpbgqeqjhgjqjvmbz.supabase.co/functions/v1/daily-report',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := '{"action":"cron"}'::jsonb
  );
end $$;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'phoenix-daily-reports') then
    perform cron.unschedule('phoenix-daily-reports');
  end if;
  perform cron.schedule('phoenix-daily-reports', '*/5 * * * *', 'select private.run_daily_reports()');
end $$;
