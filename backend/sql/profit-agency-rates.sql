-- Profit v2: a default bill rate per temp agency (used when a worker's placement has no rate of its own),
-- plus agency rates listed in profit_dashboard so they can be edited from the Profit page. Additive only.
-- Rollback: drop function public.profit_set_agency_rate(uuid, numeric, numeric); drop table public.profit_agency_rates;
--   then re-run the profit_dashboard definition from profit-dashboard.sql.

create table if not exists public.profit_agency_rates (
  agency_id uuid primary key references public.wf_agencies(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  regular_rate numeric(10,2) not null check (regular_rate > 0 and regular_rate < 1000),
  overtime_rate numeric(10,2) check (overtime_rate is null or (overtime_rate > 0 and overtime_rate < 1500)),
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.profit_agency_rates enable row level security;
drop policy if exists "Admins read agency rates" on public.profit_agency_rates;
create policy "Admins read agency rates" on public.profit_agency_rates for select to authenticated
  using (org_id = public.my_org_id() and public.is_org_admin());
revoke all on public.profit_agency_rates from anon;
revoke insert, update, delete on public.profit_agency_rates from authenticated;
grant select on public.profit_agency_rates to authenticated;

-- Admin + Employee pay: set (or clear with p_regular = null) an agency's default hourly bill rate.
create or replace function public.profit_set_agency_rate(p_agency uuid, p_regular numeric, p_overtime numeric default null)
returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.my_org_id();
begin
  if v_org is null or not public.is_org_admin() then raise exception 'Only admins can change agency rates.' using errcode = '42501'; end if;
  if not public.wf_has('pay') then raise exception 'You need the Employee pay permission to change agency rates.' using errcode = '42501'; end if;
  if not exists (select 1 from public.wf_agencies where id = p_agency and org_id = v_org) then
    raise exception 'Agency not found.' using errcode = '22023';
  end if;
  if p_regular is null then
    delete from public.profit_agency_rates where agency_id = p_agency and org_id = v_org;
    return;
  end if;
  if p_regular <= 0 or p_regular >= 1000 then raise exception 'Enter an hourly rate between $0 and $1,000.' using errcode = '22023'; end if;
  if p_overtime is not null and (p_overtime <= 0 or p_overtime >= 1500) then
    raise exception 'Enter an overtime rate between $0 and $1,500, or leave it blank.' using errcode = '22023';
  end if;
  insert into public.profit_agency_rates (agency_id, org_id, regular_rate, overtime_rate, updated_at, updated_by)
  values (p_agency, v_org, round(p_regular, 2), round(p_overtime, 2), now(), auth.uid())
  on conflict (agency_id) do update set regular_rate = excluded.regular_rate, overtime_rate = excluded.overtime_rate,
    updated_at = now(), updated_by = auth.uid();
end $$;
revoke all on function public.profit_set_agency_rate(uuid, numeric, numeric) from public, anon;
grant execute on function public.profit_set_agency_rate(uuid, numeric, numeric) to authenticated;

-- Dashboard: placement rate → agency default rate → worker pay rate.
-- Rules (mirrors Payroll):
--  * Hours by clock-in day in the org time zone; rejected entries never count.
--  * Approved = main numbers. Pending + still-open (to now) = separate estimate.
--  * Rate lookups use the rate in effect that day, else the earliest one on file (entered late).
--  * Weekly overtime (Mon–Sun, over 40 h, counted in clock-in order) adds half-time for direct staff,
--    or the agency's overtime rate (default 1.5×) for agency-billed hours.
--  * Agency workers cost their placement's bill rate, else the agency's default rate, else their pay rate;
--    no burden either way.
--  * Expenses in payroll/agency categories are excluded (already counted from timecards).
create or replace function public.profit_dashboard(p_period text default 'month', p_start date default null, p_end date default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_org uuid := public.my_org_id();
  v_tz text;
  v_today date;
  v_start date;
  v_end date;
  v_burden numeric;
  v_from timestamptz;
  v_to timestamptz;
  v_res jsonb;
begin
  if v_org is null or not public.is_org_admin() then raise exception 'Only admins can see profit.' using errcode = '42501'; end if;
  if not public.wf_has('pay') then raise exception 'You need the Employee pay permission to see profit.' using errcode = '42501'; end if;

  v_tz := public.org__tz(v_org);
  v_today := (now() at time zone v_tz)::date;
  case coalesce(p_period, 'month')
    when 'today' then v_start := v_today; v_end := v_today;
    when 'week' then v_start := v_today - (extract(isodow from v_today)::int - 1); v_end := v_today;
    when 'month' then v_start := date_trunc('month', v_today::timestamp)::date; v_end := v_today;
    when 'last_month' then
      v_start := (date_trunc('month', v_today::timestamp) - interval '1 month')::date;
      v_end := (date_trunc('month', v_today::timestamp) - interval '1 day')::date;
    when '30d' then v_start := v_today - 29; v_end := v_today;
    when 'ytd' then v_start := date_trunc('year', v_today::timestamp)::date; v_end := v_today;
    when 'custom' then v_start := p_start; v_end := p_end;
    else raise exception 'Unknown period.' using errcode = '22023';
  end case;
  if v_start is null or v_end is null or v_end < v_start or v_end - v_start > 400 then
    raise exception 'Pick a date range of up to 400 days.' using errcode = '22023';
  end if;

  select direct_burden_pct into v_burden from public.profit_settings where org_id = v_org;
  v_burden := coalesce(v_burden, 0);
  v_from := ((v_start - 7)::timestamp at time zone v_tz); -- one week back so weekly overtime is right
  v_to := ((v_end + 1)::timestamp at time zone v_tz);

  with
  wk as (
    select w.id, w.profile_id, w.source, w.agency_id, w.archived_at, trim(w.first_name || ' ' || w.last_name) as name,
           lower(regexp_replace(trim(w.first_name || ' ' || w.last_name), '\s+', ' ', 'g')) as nk
    from public.wf_workers w where w.org_id = v_org
  ),
  e as (
    select t.id, t.property_id, t.status, t.clock_in, t.worker_name,
           (t.clock_in at time zone v_tz)::date as day,
           greatest(0, extract(epoch from (coalesce(t.clock_out, now()) - t.clock_in)) / 3600.0) as hrs,
           coalesce(t.profile_id::text, 'name:' || lower(regexp_replace(trim(t.worker_name), '\s+', ' ', 'g'))) as pkey,
           (select k.id from wk k
             where (t.profile_id is not null and k.profile_id = t.profile_id)
                or k.nk = lower(regexp_replace(trim(t.worker_name), '\s+', ' ', 'g'))
             order by (t.profile_id is not null and k.profile_id = t.profile_id) desc, (k.archived_at is null) desc
             limit 1) as worker_id
    from public.time_entries t
    where t.org_id = v_org and t.status <> 'rejected' and t.clock_in >= v_from and t.clock_in < v_to
  ),
  e2 as (
    select e.*, k.source as wsource, k.agency_id as wagency, coalesce(k.name, e.worker_name) as wname,
           sum(e.hrs) over (
             partition by coalesce(e.worker_id::text, e.pkey), e.day - (extract(isodow from e.day)::int - 1)
             order by e.clock_in rows unbounded preceding) as cum
    from e left join wk k on k.id = e.worker_id
  ),
  x0 as (
    select e2.id, e2.property_id, e2.day, e2.hrs, e2.wname, e2.worker_id,
           case when e2.status = 'approved' then 'a' else 'p' end as b,
           e2.status = 'open' as live,
           coalesce(e2.wsource, 'direct') as wsource,
           greatest(0, least(e2.hrs, e2.cum - 40)) as ot,
           br.hourly_rate as bill,
           pr.hourly_rate as pay,
           coalesce(ag.regular_rate, ad.regular_rate) as ag_rate,
           case when ag.regular_rate is not null then ag.overtime_rate else ad.overtime_rate end as ag_ot
    from e2
    left join lateral (
      select b.hourly_rate from public.property_bill_rates b
      where e2.property_id is not null and b.property_id = e2.property_id and b.org_id = v_org
      order by (b.effective_date <= e2.day) desc,
               case when b.effective_date <= e2.day then b.effective_date end desc nulls last,
               b.effective_date asc, b.created_at desc
      limit 1) br on true
    left join lateral (
      select r.hourly_rate from public.wf_pay_rates r
      where e2.worker_id is not null and r.worker_id = e2.worker_id and r.org_id = v_org
      order by (r.effective_date <= e2.day) desc,
               case when r.effective_date <= e2.day then r.effective_date end desc nulls last,
               r.effective_date asc, r.created_at desc
      limit 1) pr on true
    left join lateral (
      select rt.regular_rate, rt.overtime_rate
      from public.wf_placements pl join public.wf_placement_rates rt on rt.placement_id = pl.id
      where e2.wsource = 'agency' and pl.worker_id = e2.worker_id and pl.org_id = v_org
        and pl.start_date <= e2.day and (pl.end_date is null or pl.end_date >= e2.day)
      order by (pl.property_id is not distinct from e2.property_id) desc,
               (rt.effective_date <= e2.day) desc,
               case when rt.effective_date <= e2.day then rt.effective_date end desc nulls last,
               rt.effective_date asc, rt.created_at desc
      limit 1) ag on true
    left join public.profit_agency_rates ad
      on e2.wsource = 'agency' and ad.agency_id = e2.wagency and ad.org_id = v_org
    where e2.day between v_start and v_end
  ),
  x as (
    select x0.*,
           x0.hrs * x0.bill as rev,
           case when x0.ag_rate is null and x0.pay is not null and x0.wsource <> 'agency'
                then x0.hrs * x0.pay + x0.ot * 0.5 * x0.pay else 0 end as wages,
           case when x0.ag_rate is not null
                  then x0.hrs * x0.ag_rate + x0.ot * (coalesce(x0.ag_ot, x0.ag_rate * 1.5) - x0.ag_rate)
                when x0.pay is not null and x0.wsource = 'agency'
                  then x0.hrs * x0.pay + x0.ot * 0.5 * x0.pay
                else 0 end as agency,
           (x0.ag_rate is null and x0.pay is null) as unpriced_cost,
           -- hourly cost rate (for the live "per hour" figure)
           case when x0.ag_rate is not null then x0.ag_rate
                when x0.pay is not null and x0.wsource = 'agency' then x0.pay
                when x0.pay is not null then x0.pay * (1 + v_burden / 100.0) end as cost_rate
    from x0
  ),
  xb as (
    select x.*, x.wages * v_burden / 100.0 as burden from x
  ),
  agg as (
    select property_id, b,
           sum(hrs) as hrs, sum(rev) as rev, sum(wages) as wages, sum(burden) as burden, sum(agency) as agency,
           sum(ot) as ot,
           sum(hrs) filter (where bill is null) as unpriced_rev_hrs,
           sum(hrs) filter (where unpriced_cost) as unpriced_cost_hrs
    from xb group by property_id, b
  ),
  ex_all as (
    select x.property_id, x.amount, x.spent_on, coalesce(c.name, 'Uncategorized') as cat, coalesce(c.kind, 'general') as kind
    from public.ex_expenditures x left join public.ex_categories c on c.id = x.category_id
    where x.org_id = v_org and x.archived_at is null and x.spent_on between v_start and v_end
  ),
  ex as (select * from ex_all where kind not in ('payroll', 'agency')),
  exp_prop as (select property_id, sum(amount) as amt from ex where property_id is not null group by property_id),
  cur_rate as (
    select distinct on (b.property_id) b.property_id, b.hourly_rate, b.effective_date, b.source
    from public.property_bill_rates b where b.org_id = v_org
    order by b.property_id, (b.effective_date <= v_today) desc,
             case when b.effective_date <= v_today then b.effective_date end desc nulls last,
             b.effective_date asc, b.created_at desc
  ),
  props as (
    select p.id, p.name,
           cr.hourly_rate as cur_rate, cr.effective_date as cur_rate_from, cr.source as cur_rate_source,
           a.hrs as a_hrs, a.rev as a_rev, a.wages as a_wages, a.burden as a_burden, a.agency as a_agency, a.ot as a_ot,
           coalesce(a.unpriced_rev_hrs, 0) + coalesce(pn.unpriced_rev_hrs, 0) as unpriced_rev_hrs,
           coalesce(a.unpriced_cost_hrs, 0) + coalesce(pn.unpriced_cost_hrs, 0) as unpriced_cost_hrs,
           pn.hrs as p_hrs, pn.rev as p_rev, coalesce(pn.wages, 0) + coalesce(pn.burden, 0) + coalesce(pn.agency, 0) as p_cost,
           ep.amt as expenses
    from public.properties p
    left join cur_rate cr on cr.property_id = p.id
    left join agg a on a.property_id = p.id and a.b = 'a'
    left join agg pn on pn.property_id = p.id and pn.b = 'p'
    left join exp_prop ep on ep.property_id = p.id
    where p.org_id = v_org
  )
  select jsonb_build_object(
    'tz', v_tz,
    'period', coalesce(p_period, 'month'),
    'start', v_start,
    'end', v_end,
    'today', v_today,
    'generated_at', now(),
    'burden_pct', v_burden,
    'properties', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'name', name,
        'current_rate', cur_rate, 'current_rate_from', cur_rate_from, 'current_rate_source', cur_rate_source,
        'hours', round(coalesce(a_hrs, 0)::numeric, 2),
        'revenue', round(coalesce(a_rev, 0)::numeric, 2),
        'wages', round(coalesce(a_wages, 0)::numeric, 2),
        'burden', round(coalesce(a_burden, 0)::numeric, 2),
        'agency', round(coalesce(a_agency, 0)::numeric, 2),
        'overtime_hours', round(coalesce(a_ot, 0)::numeric, 2),
        'expenses', round(coalesce(expenses, 0)::numeric, 2),
        'pending_hours', round(coalesce(p_hrs, 0)::numeric, 2),
        'pending_revenue', round(coalesce(p_rev, 0)::numeric, 2),
        'pending_cost', round(coalesce(p_cost, 0)::numeric, 2),
        'unpriced_revenue_hours', round(unpriced_rev_hrs::numeric, 2),
        'unpriced_cost_hours', round(unpriced_cost_hrs::numeric, 2)
      ) order by coalesce(a_rev, 0) desc, name)
      from props), '[]'::jsonb),
    'unassigned', (
      select jsonb_build_object(
        'hours', round(coalesce(sum(hrs) filter (where b = 'a'), 0)::numeric, 2),
        'cost', round(coalesce(sum(wages + burden + agency) filter (where b = 'a'), 0)::numeric, 2),
        'pending_hours', round(coalesce(sum(hrs) filter (where b = 'p'), 0)::numeric, 2),
        'pending_cost', round(coalesce(sum(wages + burden + agency) filter (where b = 'p'), 0)::numeric, 2))
      from agg where property_id is null),
    'overhead', coalesce((
      select jsonb_agg(jsonb_build_object('category', cat, 'amount', round(amt::numeric, 2)) order by amt desc)
      from (select cat, sum(amount) as amt from ex where property_id is null group by cat) o), '[]'::jsonb),
    'excluded_labor_expenses', (select round(coalesce(sum(amount), 0)::numeric, 2) from ex_all where kind in ('payroll', 'agency')),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object(
        'day', d.day,
        'revenue', round(coalesce(r.rev, 0)::numeric, 2),
        'cost', round((coalesce(r.cost, 0) + coalesce(xe.amt, 0))::numeric, 2),
        'pending_revenue', round(coalesce(r.p_rev, 0)::numeric, 2),
        'pending_cost', round(coalesce(r.p_cost, 0)::numeric, 2)
      ) order by d.day)
      from (select generate_series(v_start, v_end, interval '1 day')::date as day) d
      left join (
        select day,
               sum(rev) filter (where b = 'a') as rev,
               sum(wages + burden + agency) filter (where b = 'a') as cost,
               sum(rev) filter (where b = 'p') as p_rev,
               sum(wages + burden + agency) filter (where b = 'p') as p_cost
        from xb group by day) r on r.day = d.day
      left join (select spent_on as day, sum(amount) as amt from ex group by spent_on) xe on xe.day = d.day), '[]'::jsonb),
    'live', (
      select jsonb_build_object(
        'on_duty', count(*),
        'sites', count(distinct property_id),
        'revenue_per_hour', round(coalesce(sum(bill), 0)::numeric, 2),
        'cost_per_hour', round(coalesce(sum(cost_rate), 0)::numeric, 2),
        'unpriced', count(*) filter (where bill is null or cost_rate is null))
      from xb where live),
    'agencies', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'name', a.name, 'regular_rate', r.regular_rate, 'overtime_rate', r.overtime_rate,
        'workers', (select count(*) from public.wf_workers w where w.agency_id = a.id and w.org_id = v_org and w.archived_at is null))
        order by a.name)
      from public.wf_agencies a left join public.profit_agency_rates r on r.agency_id = a.id
      where a.org_id = v_org and a.archived_at is null), '[]'::jsonb),
    'missing_pay', coalesce((
      select jsonb_agg(jsonb_build_object('name', wname, 'hours', round(h::numeric, 2)) order by h desc)
      from (select wname, sum(hrs) as h from xb where unpriced_cost group by wname) m), '[]'::jsonb)
  ) into v_res;

  return v_res;
end $$;

revoke all on function public.profit_dashboard(text, date, date) from public, anon;
grant execute on function public.profit_dashboard(text, date, date) to authenticated;
