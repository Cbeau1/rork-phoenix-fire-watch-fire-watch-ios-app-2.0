-- Optional client TEXT messages when a fire watch starts and ends (alongside the watch emails).
-- Additive and OFF by default: two per-property switches (default false), an optional phone list,
-- a send log, a due-list for the cron, and the existing cron now also checks for due texts.
-- Test mode (dispatch_settings.test_mode) is enforced in the watch-notify edge function: texts then go ONLY to the test phone.
-- Reverse with the block at the bottom.

alter table public.property_watch_email add column if not exists text_start boolean not null default false;
alter table public.property_watch_email add column if not exists text_end boolean not null default false;
alter table public.property_watch_email add column if not exists text_phones text[] not null default '{}';

-- One row per watch + kind: what was texted, to whom, and when.
create table if not exists public.watch_texts (
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
  body text not null default '',
  error text not null default '',
  attempts int not null default 0,
  sent_at timestamptz,
  sent_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (watch_id, kind)
);
create index if not exists watch_texts_property on public.watch_texts (property_id, created_at desc);

alter table public.watch_texts enable row level security;
drop policy if exists "Admins read watch texts" on public.watch_texts;
create policy "Admins read watch texts" on public.watch_texts for select to authenticated
  using (org_id = public.my_org_id() and public.is_org_admin());
revoke insert, update, delete on public.watch_texts from anon, authenticated;

-- Texts that are due now. Same timing and live_since gate as the emails, but only where the
-- property's text switch is explicitly ON (no row = off).
create or replace function public.watch_text__due(p_limit int default 10)
returns table (watch_id uuid, kind text)
language sql stable security definer set search_path = '' as $$
  select x.watch_id, x.kind from (
    select w.id as watch_id, 'start'::text as kind, b.first_start as at
    from public.property_watches w
    join public.watch_email_settings s on s.org_id = w.org_id and s.auto_enabled
    join public.property_watch_email pe on pe.property_id = w.property_id and pe.text_start
    cross join lateral private.watch_shift_bounds(w.id) b
    where w.ended_on is null and w.created_at >= s.live_since
      and b.first_start is not null and b.first_start <= now() + interval '24 hours' and b.first_start > now() - interval '12 hours'
      and not exists (select 1 from public.watch_texts t where t.watch_id = w.id and t.kind = 'start')
    union all
    select w.id, 'end', w.ended_at
    from public.property_watches w
    join public.watch_email_settings s on s.org_id = w.org_id and s.auto_enabled
    join public.property_watch_email pe on pe.property_id = w.property_id and pe.text_end
    cross join lateral private.watch_shift_bounds(w.id) b
    where w.ended_on is not null and w.ended_at >= s.live_since
      and w.ended_at > now() - interval '7 days'
      and coalesce(b.last_end, w.ended_at) <= now()
      and not exists (select 1 from public.watch_texts t where t.watch_id = w.id and t.kind = 'end')
  ) x order by x.at limit greatest(1, least(p_limit, 50));
$$;
revoke all on function public.watch_text__due(int) from public, anon, authenticated;
grant execute on function public.watch_text__due(int) to service_role;

-- Cron gate: now also wakes the function for due or retryable texts.
create or replace function private.run_watch_emails()
returns void language plpgsql security definer set search_path = '' as $$
declare v_secret text;
begin
  if not exists (select 1 from public.watch_email__due(1))
     and not exists (select 1 from public.watch_text__due(1))
     and not exists (select 1 from public.watch_emails e where e.status = 'failed' and e.trigger = 'auto' and e.attempts < 3
                     and e.updated_at < now() - interval '20 minutes')
     and not exists (select 1 from public.watch_texts t where t.status = 'failed' and t.trigger = 'auto' and t.attempts < 3
                     and t.updated_at < now() - interval '20 minutes') then
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

/* Rollback:
-- restore private.run_watch_emails() from watch-emails.sql, then:
drop function if exists public.watch_text__due(int);
drop table if exists public.watch_texts;
alter table public.property_watch_email drop column if exists text_start, drop column if exists text_end, drop column if exists text_phones;
*/
