-- Every expenditure counts toward profit, and monthly recurring charges count from their start month.
--  1. profit_dashboard: payroll/agency-category expenditures now count as costs (they were excluded). Timecard labor
--     for shifts linked to such an expenditure is not counted again. New keys: properties[].labor_expenses, paid_labor_hours.
--  2. Fire watch totals: subtract a share of company overhead (expenditures with no property). Each month's overhead
--     is split across the watches running that month by days on watch (a running watch counts through month end).
--  3. Monthly recurring: the charge for the start month is included (due on its day that month), even when the
--     start date falls after that day. Pause/resume still skips months missed while paused.
-- Rollback: re-run profit-agency-rates.sql (profit_dashboard), watch-invoices.sql + property-watches.sql
-- (property_watch__totals 3-arg, property_watches), and restore private.ex_recurring_generate's `occ >= r.start_on` check.

-- 1. Profit dashboard
create or replace function public.profit_dashboard(p_period text DEFAULT 'month'::text, p_start date DEFAULT NULL::date, p_end date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    select t.id, t.property_id, t.status, t.clock_in, t.worker_name, t.shift_id,
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
           -- labor already recorded as a payroll/agency expenditure linked to this shift isn't counted again
           (e2.shift_id is not null and exists (
              select 1 from public.ex_shift_links l
              join public.ex_expenditures xe on xe.id = l.expenditure_id and xe.archived_at is null
              left join public.ex_categories xc on xc.id = xe.category_id
              where l.shift_id = e2.shift_id and l.org_id = v_org and coalesce(xc.kind, 'general') in ('payroll', 'agency'))) as paid,
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
           case when x0.paid then 0
                when x0.ag_rate is null and x0.pay is not null and x0.wsource <> 'agency'
                then x0.hrs * x0.pay + x0.ot * 0.5 * x0.pay else 0 end as wages,
           case when x0.paid then 0
                when x0.ag_rate is not null
                  then x0.hrs * x0.ag_rate + x0.ot * (coalesce(x0.ag_ot, x0.ag_rate * 1.5) - x0.ag_rate)
                when x0.pay is not null and x0.wsource = 'agency'
                  then x0.hrs * x0.pay + x0.ot * 0.5 * x0.pay
                else 0 end as agency,
           (not x0.paid and x0.ag_rate is null and x0.pay is null) as unpriced_cost,
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
  ex as (select * from ex_all),
  exp_prop as (select property_id, sum(amount) as amt, sum(amount) filter (where kind in ('payroll', 'agency')) as labor_amt from ex where property_id is not null group by property_id),
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
           ep.amt as expenses, ep.labor_amt as labor_expenses
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
        'labor_expenses', round(coalesce(labor_expenses, 0)::numeric, 2),
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
    'excluded_labor_expenses', 0,
    'paid_labor_hours', (select round(coalesce(sum(hrs), 0)::numeric, 2) from xb where paid and b = 'a'),
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
end $function$;

-- 2. Fire watch totals with overhead share
drop function if exists public.property_watch__totals(uuid, date, date);
create or replace function public.property_watch__totals(p_property uuid, p_start date, p_end date, p_running boolean default false)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_start date := greatest(p_start, p_end - 400); v jsonb; r jsonb;
  v_tz text; v_from timestamptz; v_to timestamptz;
  v_hours numeric; v_rev numeric; v_cost numeric;
  v_billed numeric := 0; v_billed_hours numeric := 0; v_covered numeric := 0; v_n int := 0;
  v_unbilled_hours numeric; v_unbilled_rev numeric; v_revenue numeric; inv record; f numeric;
  v_org uuid; v_today date; v_own_end date; v_month_end date; v_overhead numeric := 0;
begin
  v := public.profit_dashboard('custom', v_start, p_end);
  select e into r from jsonb_array_elements(v->'properties') e where (e->>'id')::uuid = p_property;
  r := coalesce(r, '{}'::jsonb);
  v_hours := coalesce((r->>'hours')::numeric, 0);
  v_rev := coalesce((r->>'revenue')::numeric, 0);
  v_cost := coalesce((r->>'wages')::numeric, 0) + coalesce((r->>'burden')::numeric, 0)
          + coalesce((r->>'agency')::numeric, 0) + coalesce((r->>'expenses')::numeric, 0);

  select p.org_id, public.org__tz(p.org_id) into v_org, v_tz from public.properties p where p.id = p_property;
  v_today := (now() at time zone v_tz)::date;
  v_month_end := (date_trunc('month', v_today::timestamp) + interval '1 month - 1 day')::date;
  v_own_end := case when p_running then greatest(p_end, (date_trunc('month', p_end::timestamp) + interval '1 month - 1 day')::date) else p_end end;

  -- Company overhead share: each month's no-property expenditures split across that month's watches by days on watch.
  with w as (
    select v_start as s, v_own_end as e
    union all
    select x.started_on, coalesce(x.ended_on, greatest(v_month_end, x.started_on))
    from public.property_watches x
    where x.org_id = v_org
      and not (x.property_id = p_property and x.started_on <= v_own_end and coalesce(x.ended_on, 'infinity'::date) >= v_start)),
  oh as (
    select x.amount, date_trunc('month', x.spent_on::timestamp)::date as m,
           (date_trunc('month', x.spent_on::timestamp) + interval '1 month - 1 day')::date as me
    from public.ex_expenditures x
    where x.org_id = v_org and x.archived_at is null and x.property_id is null
      and x.spent_on between date_trunc('month', v_start::timestamp)::date
                         and (date_trunc('month', v_own_end::timestamp) + interval '1 month - 1 day')::date)
  select coalesce(sum(oh.amount * own.d / tot.d), 0) into v_overhead
  from oh
  cross join lateral (select greatest(0, least(v_own_end, oh.me) - greatest(v_start, oh.m) + 1)::numeric as d) own
  cross join lateral (select sum(greatest(0, least(w.e, oh.me) - greatest(w.s, oh.m) + 1))::numeric as d from w) tot
  where own.d > 0 and tot.d > 0;
  v_from := (v_start::timestamp) at time zone v_tz;
  v_to := ((p_end + 1)::timestamp) at time zone v_tz;

  for inv in
    select i.amount, i.hours, i.period_start, i.period_end, i.issued_on
    from public.client_invoices i
    where i.property_id = p_property and i.status <> 'void'
      and case when i.period_start is not null and i.period_end is not null
               then i.period_start < v_to and i.period_end > v_from
               else i.issued_on between v_start and p_end end
  loop
    v_n := v_n + 1;
    if inv.period_start is not null and inv.period_end is not null then
      f := extract(epoch from (least(inv.period_end, v_to) - greatest(inv.period_start, v_from)))
         / extract(epoch from (inv.period_end - inv.period_start));
      v_covered := v_covered + coalesce((public.client_invoice__worked(p_property,
                     greatest(inv.period_start, v_from), least(inv.period_end, v_to))->>'approved')::numeric, 0);
    else
      f := 1;
    end if;
    v_billed := v_billed + inv.amount * f;
    v_billed_hours := v_billed_hours + coalesce(inv.hours, 0) * f;
  end loop;

  v_unbilled_hours := greatest(v_hours - v_covered, 0);
  v_unbilled_rev := case when v_hours > 0 then v_rev * v_unbilled_hours / v_hours else 0 end;
  v_revenue := case when v_n > 0 then round(v_billed + v_unbilled_rev, 2) else v_rev end;

  return jsonb_build_object(
    'from', v_start, 'to', p_end, 'truncated', v_start > p_start,
    'hours', case when v_n > 0 then round(v_billed_hours + v_unbilled_hours, 2) else v_hours end,
    'revenue', v_revenue,
    'labor', coalesce((r->>'wages')::numeric, 0) + coalesce((r->>'burden')::numeric, 0) + coalesce((r->>'agency')::numeric, 0),
    'expenses', coalesce((r->>'expenses')::numeric, 0),
    'labor_expenses', coalesce((r->>'labor_expenses')::numeric, 0),
    'overhead', round(v_overhead, 2),
    'profit', round(v_revenue - v_cost - v_overhead, 2),
    'pending_hours', coalesce((r->>'pending_hours')::numeric, 0),
    'pending_revenue', coalesce((r->>'pending_revenue')::numeric, 0),
    'pending_cost', coalesce((r->>'pending_cost')::numeric, 0),
    'unpriced_revenue_hours', coalesce((r->>'unpriced_revenue_hours')::numeric, 0),
    'rate', r->'current_rate',
    'invoices', v_n,
    'billed', round(v_billed, 2),
    'billed_hours', round(v_billed_hours, 2),
    'unbilled_hours', case when v_n > 0 then round(v_unbilled_hours, 2) else 0 end,
    'unbilled_revenue', case when v_n > 0 then round(v_unbilled_rev, 2) else 0 end,
    'timecard_hours', v_hours,
    'timecard_revenue', v_rev);
end $$;
revoke all on function public.property_watch__totals(uuid, date, date, boolean) from public, anon, authenticated;

create or replace function public.property_watches()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_org uuid := public.property_watch__guard(); v_today date := (now() at time zone public.org__tz(v_org))::date;
begin
  return jsonb_build_object(
    'today', v_today,
    'active', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', w.id, 'property_id', p.id, 'name', p.name, 'started_on', w.started_on,
        'totals', public.property_watch__totals(p.id, least(w.started_on, v_today), v_today, true),
        'upcoming_shifts', (select count(*) from public.shifts s where s.property_id = p.id and s.shift_date > v_today),
        'on_duty', (select count(*) from public.time_entries t where t.property_id = p.id and t.status = 'open' and t.clock_out is null))
        order by w.started_on, p.name)
      from public.property_watches w join public.properties p on p.id = w.property_id
      where w.org_id = v_org and w.ended_on is null), '[]'::jsonb),
    'ended', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', z.id, 'property_id', z.property_id, 'name', z.name, 'started_on', z.started_on, 'ended_on', z.ended_on,
        'ended_at', z.ended_at, 'shifts_cleared', z.shifts_cleared,
        'totals', public.property_watch__totals(z.property_id, z.started_on, z.ended_on))
        order by z.ended_on desc, z.ended_at desc)
      from (select w.*, p.name from public.property_watches w join public.properties p on p.id = w.property_id
            where w.org_id = v_org and w.ended_on is not null order by w.ended_on desc, w.ended_at desc limit 25) z), '[]'::jsonb),
    'idle', coalesce((
      select jsonb_agg(jsonb_build_object('property_id', p.id, 'name', p.name,
        'last_ended_on', (select max(ended_on) from public.property_watches w where w.property_id = p.id)) order by p.name)
      from public.properties p
      where p.org_id = v_org and not exists (select 1 from public.property_watches w where w.property_id = p.id and w.ended_on is null)), '[]'::jsonb));
end $function$;

-- 3. Monthly recurring: the start month's charge is included
create or replace function private.ex_recurring_generate(p_org uuid, p_rec uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare r ex_recurring; tz text; today date; m date; occ date; n integer := 0; nid uuid; v_code text;
begin
  select coalesce(nullif(timezone, ''), 'America/New_York') into tz from organizations where id = p_org;
  begin today := (now() at time zone coalesce(tz, 'America/New_York'))::date;
  exception when others then today := (now() at time zone 'America/New_York')::date; end;
  for r in select * from ex_recurring where org_id = p_org and archived_at is null and paused_at is null
             and (p_rec is null or id = p_rec) and date_trunc('month', start_on)::date <= today for update skip locked loop
    m := greatest(date_trunc('month', r.start_on)::date, (date_trunc('month', today) - interval '24 months')::date);
    while m <= today loop
      occ := make_date(extract(year from m)::int, extract(month from m)::int,
               least(r.day_of_month::int, extract(day from (m + interval '1 month' - interval '1 day'))::int));
      exit when occ > today;
      if m >= date_trunc('month', r.start_on)::date and occ >= coalesce(r.skip_before, date_trunc('month', r.start_on)::date) and (r.end_on is null or occ <= r.end_on)
         and not exists (select 1 from ex_expenditures where recurring_id = r.id and recurring_period = m) then
        nid := null;
        v_code := ex__next(p_org, 'EXP');
        insert into ex_expenditures(org_id, code, spent_on, vendor, description, category_id, amount, currency, paid_by, payer_name,
          payment_method, account_label, property_id, property_name, notes, person_reimb_flag, client_recovery_flag,
          recurring_id, recurring_period, created_by, updated_by)
        values (p_org, v_code, occ, r.vendor, r.description, r.category_id, r.amount, r.currency, r.paid_by, r.payer_name,
          r.payment_method, r.account_label, r.property_id, r.property_name, r.notes,
          case when r.paid_by = 'business' then 'not_applicable' else 'not_requested' end, 'not_applicable',
          r.id, m, r.created_by, r.created_by)
        on conflict (recurring_id, recurring_period) where recurring_id is not null do nothing
        returning id into nid;
        if nid is not null then
          insert into ex_history(org_id, expenditure_id, action, summary, changed_fields, actor_id, actor_name)
          values (p_org, nid, 'create', left('Expenditure ' || v_code || ' added automatically from monthly recurring expense: ' || r.vendor || ' ' || r.currency || ' ' || r.amount::text, 500),
            '{}', null, 'Automatic (monthly recurring)');
          n := n + 1;
        end if;
      end if;
      m := (m + interval '1 month')::date;
    end loop;
    update ex_recurring set last_run_on = today where id = r.id;
  end loop;
  return n;
end $function$;
