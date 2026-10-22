-- Daily report v2: each property picks its own send time (was fixed at 9:00 AM). Additive only.
-- The report always covers the 24 hours before the send time. A missed send is still made up for
-- up to 4 hours later (same local day), exactly like the 9 a.m. version.
-- Rollback: drop function public.daily_report_upsert_settings(uuid,boolean,text[],boolean,boolean,text,time);
--   alter table public.daily_report_settings drop column send_time; then re-run the claim / cron
--   functions from daily-reports.sql.

alter table public.daily_report_settings
  add column if not exists send_time time not null default '09:00';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'daily_report_settings_send_time_chk') then
    alter table public.daily_report_settings
      add constraint daily_report_settings_send_time_chk check (extract(second from send_time) = 0);
  end if;
end $$;

-- Admin: save settings for one property, including the send time.
create or replace function public.daily_report_upsert_settings(
  p_property uuid, p_enabled boolean, p_recipients text[], p_include_photos boolean,
  p_send_when_empty boolean, p_timezone text, p_send_time time
) returns public.daily_report_settings
language plpgsql security definer set search_path = '' as $$
declare v_row public.daily_report_settings;
begin
  if p_send_time is null then raise exception 'Pick a send time.'; end if;
  -- Validation + upsert of everything else lives in the original function.
  perform public.daily_report_upsert_settings(p_property, p_enabled, p_recipients, p_include_photos, p_send_when_empty, p_timezone);
  update public.daily_report_settings
     set send_time = date_trunc('minute', p_send_time)::time, updated_at = now(), updated_by = auth.uid()
   where property_id = p_property
  returning * into v_row;
  return v_row;
end $$;
revoke all on function public.daily_report_upsert_settings(uuid, boolean, text[], boolean, boolean, text, time) from public, anon;
grant execute on function public.daily_report_upsert_settings(uuid, boolean, text[], boolean, boolean, text, time) to authenticated;

-- Service: create due scheduled runs (send time → +4 h, same local day), retries, and stuck sends.
create or replace function public.daily_report__claim(p_limit int default 5)
returns setof public.daily_report_runs
language plpgsql security definer set search_path = '' as $$
begin
  update public.daily_report_runs
     set status = 'failed', error = 'The send did not finish (timed out). Use Retry to send again.'
   where status = 'sending' and attempts >= 3 and last_attempt_at < now() - interval '15 minutes';

  insert into public.daily_report_runs (org_id, property_id, report_date, tz, window_start, window_end, trigger, status)
  select s.org_id, s.property_id, d.local_date, d.tz,
         ((d.local_date - 1) + s.send_time) at time zone d.tz,
         (d.local_date + s.send_time) at time zone d.tz,
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
    and d.local_time >= s.send_time and d.local_time - s.send_time < interval '4 hours'
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

-- Cron (every 5 minutes): only call the edge function when something is due.
create or replace function private.run_daily_reports()
returns void language plpgsql security definer set search_path = '' as $$
declare v_secret text;
begin
  if not exists (
    select 1 from public.daily_report_settings s
    cross join lateral (select (now() at time zone public.daily_report__tz(s.property_id)) lt) n
    where s.enabled and cardinality(s.recipients) > 0
      and n.lt::time >= s.send_time and n.lt::time - s.send_time < interval '4 hours'
      and not exists (
        select 1 from public.daily_report_runs r
        where r.property_id = s.property_id and r.trigger = 'schedule' and r.report_date = n.lt::date)
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
