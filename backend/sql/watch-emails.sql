-- Automatic client emails when a fire watch starts and when it ends.
-- Additive: three new tables, read-only RLS for admins (writes go through the watch-notify edge function),
-- a due-list for the cron, and a cron job. Reverse with the DROP block at the bottom.

-- Org-wide details used in the emails (signature, phone lines, invoice timing).
create table if not exists public.watch_email_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  auto_enabled boolean not null default true,
  your_phone text not null default '',
  direct_line text not null default '',
  office_line text not null default '',
  invoice_days int not null default 3 check (invoice_days between 1 and 60),
  review_url text not null default '',
  signer_name text not null default '',
  signer_title text not null default '',
  company_legal text not null default '',
  website text not null default '',
  -- Only watches started/ended after this moment are emailed automatically (no surprise emails for old watches).
  live_since timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- Per-property choices and the fields the app can't work out on its own.
create table if not exists public.property_watch_email (
  property_id uuid primary key references public.properties(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  send_start boolean not null default true,
  send_end boolean not null default true,
  recipients text[] not null default '{}',
  client_first_name text not null default '',
  onsite_contact text not null default '',
  billing_email text not null default '',
  coverage text not null default '',
  officers int check (officers is null or officers between 1 and 50),
  deposit_amount numeric(12,2) check (deposit_amount is null or deposit_amount >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
create index if not exists property_watch_email_org on public.property_watch_email (org_id);

-- One row per watch + kind: what was sent, to whom, and when.
create table if not exists public.watch_emails (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid not null references public.properties(id) on delete cascade,
  watch_id uuid not null references public.property_watches(id) on delete cascade,
  kind text not null check (kind in ('start', 'end')),
  status text not null check (status in ('sending', 'sent', 'failed', 'skipped')),
  trigger text not null default 'auto' check (trigger in ('auto', 'manual')),
  sent_to text[] not null default '{}',
  intended_to text[] not null default '{}',
  test_mode boolean not null default false,
  subject text not null default '',
  error text not null default '',
  event_at timestamptz,
  attempts int not null default 0,
  sent_at timestamptz,
  sent_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (watch_id, kind)
);
create index if not exists watch_emails_property on public.watch_emails (property_id, created_at desc);

alter table public.watch_email_settings enable row level security;
alter table public.property_watch_email enable row level security;
alter table public.watch_emails enable row level security;
drop policy if exists "Admins read watch email settings" on public.watch_email_settings;
create policy "Admins read watch email settings" on public.watch_email_settings for select to authenticated
  using (org_id = public.my_org_id() and public.is_org_admin());
drop policy if exists "Admins read property watch email" on public.property_watch_email;
create policy "Admins read property watch email" on public.property_watch_email for select to authenticated
  using (org_id = public.my_org_id() and public.is_org_admin());
drop policy if exists "Admins read watch emails" on public.watch_emails;
create policy "Admins read watch emails" on public.watch_emails for select to authenticated
  using (org_id = public.my_org_id() and public.is_org_admin());
revoke insert, update, delete on public.watch_email_settings, public.property_watch_email, public.watch_emails from anon, authenticated;

-- First scheduled shift start and last scheduled shift end inside a watch (org-local times → instants).
create or replace function private.watch_shift_bounds(p_watch uuid)
returns table (first_start timestamptz, last_end timestamptz)
language sql stable security definer set search_path = '' as $$
  select min((s.shift_date + s.start_time) at time zone z.tz),
         max((s.shift_date + s.end_time + case when s.end_time <= s.start_time then interval '1 day' else interval '0' end) at time zone z.tz)
  from public.property_watches w
  cross join lateral (select public.org__tz(w.org_id) as tz) z
  join public.shifts s on s.property_id = w.property_id and s.shift_date >= w.started_on
   and (w.ended_on is null or s.shift_date <= w.ended_on)
  where w.id = p_watch;
$$;
revoke all on function private.watch_shift_bounds(uuid) from public, anon, authenticated;

-- Emails that are due now.
--  start: open watch, first shift begins within 24h (and not more than 12h ago).
--  end:   ended watch whose last scheduled shift is over.
create or replace function public.watch_email__due(p_limit int default 10)
returns table (watch_id uuid, kind text)
language sql stable security definer set search_path = '' as $$
  select x.watch_id, x.kind from (
    select w.id as watch_id, 'start'::text as kind, b.first_start as at
    from public.property_watches w
    join public.watch_email_settings s on s.org_id = w.org_id and s.auto_enabled
    left join public.property_watch_email pe on pe.property_id = w.property_id
    cross join lateral private.watch_shift_bounds(w.id) b
    where w.ended_on is null and coalesce(pe.send_start, true) and w.created_at >= s.live_since
      and b.first_start is not null and b.first_start <= now() + interval '24 hours' and b.first_start > now() - interval '12 hours'
      and not exists (select 1 from public.watch_emails e where e.watch_id = w.id and e.kind = 'start')
    union all
    select w.id, 'end', w.ended_at
    from public.property_watches w
    join public.watch_email_settings s on s.org_id = w.org_id and s.auto_enabled
    left join public.property_watch_email pe on pe.property_id = w.property_id
    cross join lateral private.watch_shift_bounds(w.id) b
    where w.ended_on is not null and coalesce(pe.send_end, true) and w.ended_at >= s.live_since
      and w.ended_at > now() - interval '7 days'
      and coalesce(b.last_end, w.ended_at) <= now()
      and not exists (select 1 from public.watch_emails e where e.watch_id = w.id and e.kind = 'end')
  ) x order by x.at limit greatest(1, least(p_limit, 50));
$$;
revoke all on function public.watch_email__due(int) from public, anon, authenticated;
grant execute on function public.watch_email__due(int) to service_role;

create or replace function public.watch_email__bounds(p_watch uuid)
returns table (first_start timestamptz, last_end timestamptz)
language sql stable security definer set search_path = '' as $$ select * from private.watch_shift_bounds(p_watch); $$;
revoke all on function public.watch_email__bounds(uuid) from public, anon, authenticated;
grant execute on function public.watch_email__bounds(uuid) to service_role;

-- Cron: only call the edge function when something is due (or a send got stuck).
create or replace function private.run_watch_emails()
returns void language plpgsql security definer set search_path = '' as $$
declare v_secret text;
begin
  if not exists (select 1 from public.watch_email__due(1))
     and not exists (select 1 from public.watch_emails e where e.status = 'failed' and e.trigger = 'auto' and e.attempts < 3
                     and e.updated_at < now() - interval '20 minutes') then
    return;
  end if;
  select value into v_secret from private.app_secrets where name = 'cron';
  perform net.http_post(
    url := 'https://lnavpbgqeqjhgjqjvmbz.supabase.co/functions/v1/watch-notify',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := '{"action":"cron"}'::jsonb
  );
end $$;
revoke all on function private.run_watch_emails() from public, anon, authenticated;

select cron.unschedule('phoenix-watch-emails') where exists (select 1 from cron.job where jobname = 'phoenix-watch-emails');
select cron.schedule('phoenix-watch-emails', '*/5 * * * *', 'select private.run_watch_emails()');

-- Phoenix Fire Watch's signature details (as provided by the owner).
insert into public.watch_email_settings (org_id, your_phone, office_line, review_url, signer_name, signer_title, company_legal, website)
values ('74c5cea5-343f-4647-93d8-f0d4622faf6a', '727-729-9332', '727-729-9332', 'https://g.page/r/Cffig-SH7iyaEBM/review',
        'Corey Beauregard', 'Owner', 'Phoenix Fire Watch LLC', 'www.phoenixfirewatch.com')
on conflict (org_id) do nothing;

/* Rollback:
select cron.unschedule('phoenix-watch-emails');
drop function if exists private.run_watch_emails();
drop function if exists public.watch_email__bounds(uuid);
drop function if exists public.watch_email__due(int);
drop function if exists private.watch_shift_bounds(uuid);
drop table if exists public.watch_emails;
drop table if exists public.property_watch_email;
drop table if exists public.watch_email_settings;
*/
