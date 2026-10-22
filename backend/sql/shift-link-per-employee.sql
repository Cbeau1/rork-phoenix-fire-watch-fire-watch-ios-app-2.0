-- Per-employee shift-link auto text / auto email (default OFF).
-- Replaces the org-wide dispatch_settings.auto_link_text / auto_link_email switches
-- (those columns are kept, but no longer read).
-- Rollback:
--   alter table public.wf_workers drop column auto_link_text, drop column auto_link_email;
--   re-apply sl_auto__due from shift-link-auto-live.sql (and redeploy the previous shift-link function).

alter table public.wf_workers add column if not exists auto_link_text boolean not null default false;
alter table public.wf_workers add column if not exists auto_link_email boolean not null default false;

create or replace function public.sl_auto__due(p_limit int default 20)
returns table(shift_id uuid, org_id uuid) language sql stable security definer set search_path = public as $$
  select s.id, s.org_id
    from public.shifts s
    cross join lateral (select public.shift__window(s, public.org__tz(s.org_id)) as win) w
   where s.staff_id is not null
     and exists (
       select 1 from public.wf_workers wk
        where wk.org_id = s.org_id and wk.staff_id = s.staff_id and wk.archived_at is null
          and (wk.auto_link_text or wk.auto_link_email))
     and s.shift_date between current_date - 1 and current_date + 2
     and lower(w.win) > now() and lower(w.win) <= now() + interval '60 minutes'
     and not exists (select 1 from public.shift_link_auto a where a.shift_id = s.id)
     and not exists (select 1 from public.shift_links l where l.shift_id = s.id and l.revoked_at is null)
   order by lower(w.win)
   limit greatest(1, least(p_limit, 50));
$$;
revoke all on function public.sl_auto__due(int) from public, anon, authenticated;
grant execute on function public.sl_auto__due(int) to service_role;
