-- Profit page: client invoices set revenue for the time they cover (same rule as fire watch totals),
-- payroll % is relabelled "payroll tax", and a business federal tax % (of positive net profit) is added.
-- Additive: one new column, one new RPC; profit_dashboard keeps every old key and adds timecard_* / billed keys.

alter table public.profit_settings add column if not exists federal_tax_pct numeric(5,2) not null default 0
  check (federal_tax_pct >= 0 and federal_tax_pct <= 100);

create or replace function public.profit_save_tax(p_pct numeric)
returns public.profit_settings language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.my_org_id(); v_row public.profit_settings;
begin
  if v_org is null or not public.is_org_admin() or not public.wf_has('pay') then
    raise exception 'You need the Employee pay permission to change this.' using errcode = '42501';
  end if;
  if p_pct is null or p_pct < 0 or p_pct > 100 then raise exception 'Enter a percentage from 0 to 100.' using errcode = '22023'; end if;
  insert into public.profit_settings (org_id, direct_burden_pct, federal_tax_pct, updated_at, updated_by)
  values (v_org, 0, round(p_pct, 2), now(), auth.uid())
  on conflict (org_id) do update set federal_tax_pct = excluded.federal_tax_pct, updated_at = now(), updated_by = auth.uid()
  returning * into v_row;
  return v_row;
end $$;
revoke all on function public.profit_save_tax(numeric) from public, anon;
grant execute on function public.profit_save_tax(numeric) to authenticated;

CREATE OR REPLACE FUNCTION public.profit_dashboard(p_period text DEFAULT 'month'::text, p_start date DEFAULT NULL::date, p_end date DEFAULT NULL::date)
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
  v_tax numeric;
  v_pfrom timestamptz;
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

  select direct_burden_pct, federal_tax_pct into v_burden, v_tax from public.profit_settings where org_id = v_org;
  v_burden := coalesce(v_burden, 0);
  v_tax := coalesce(v_tax, 0);
  v_pfrom := (v_start::timestamp at time zone v_tz);
  v_from := ((v_start - 7)::timestamp at time zone v_tz); -- one week back so weekly overtime is right
  v_to := ((v_end + 1)::timestamp at time zone v_tz);

  with
  -- Client invoices that overlap the period. Their amount (spread evenly over the time they cover)
  -- replaces timecard revenue for that time, exactly like fire watch totals.
  inv as (
    select i.property_id, i.amount, coalesce(i.hours, 0) as hours, i.issued_on,
           case when i.period_start is not null and i.period_end > i.period_start then i.period_start end as ps,
           case when i.period_start is not null and i.period_end > i.period_start then i.period_end end as pe
    from public.client_invoices i
    where i.org_id = v_org and i.status <> 'void' and i.property_id is not null
      and case when i.period_start is not null and i.period_end > i.period_start
               then i.period_start < v_to and i.period_end > v_pfrom
               else i.issued_on between v_start and v_end end
  ),
  pdays as (
    select g::date as day, (g::date::timestamp at time zone v_tz) as ds, ((g::date + 1)::timestamp at time zone v_tz) as de
    from generate_series(v_start, v_end, interval '1 day') g
  ),
  inv_day as (
    select inv.property_id, pdays.day,
           sum(inv.amount * f.f) as billed, sum(inv.hours * f.f) as billed_hrs
    from inv join pdays
      on case when inv.ps is not null then inv.ps < pdays.de and inv.pe > pdays.ds else inv.issued_on = pdays.day end
    cross join lateral (
      select case when inv.ps is not null
                  then extract(epoch from (least(inv.pe, pdays.de) - greatest(inv.ps, pdays.ds))) / extract(epoch from (inv.pe - inv.ps))
                  else 1 end::numeric as f) f
    group by inv.property_id, pdays.day
  ),
  inv_prop as (select property_id, sum(billed) as billed, sum(billed_hrs) as billed_hrs from inv_day group by property_id),
  wk as (
    select w.id, w.profile_id, w.source, w.agency_id, w.archived_at, trim(w.first_name || ' ' || w.last_name) as name,
           lower(regexp_replace(trim(w.first_name || ' ' || w.last_name), '\s+', ' ', 'g')) as nk
    from public.wf_workers w where w.org_id = v_org
  ),
  e as (
    select t.id, t.property_id, t.status, t.clock_in, t.clock_out, t.worker_name, t.shift_id,
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
    select e2.id, e2.property_id, e2.day, e2.hrs, e2.wname, e2.worker_id, e2.clock_in, e2.clock_out,
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
           -- share of this timecard inside an invoiced period (its revenue is the invoice's)
           case when x0.hrs > 0 then least(1, coalesce((
             select sum(greatest(0, extract(epoch from (least(coalesce(x0.clock_out, now()), inv.pe) - greatest(x0.clock_in, inv.ps))) / 3600.0))
             from inv where inv.property_id = x0.property_id and inv.ps is not null), 0) / x0.hrs) else 0 end as cov,
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
    select x.*, x.wages * v_burden / 100.0 as burden,
           x.hrs * (1 - x.cov) as hrs_unc, coalesce(x.rev, 0) * (1 - x.cov) as rev_unc
    from x
  ),
  agg as (
    select property_id, b,
           sum(hrs) as hrs, sum(rev) as rev, sum(wages) as wages, sum(burden) as burden, sum(agency) as agency,
           sum(ot) as ot,
           sum(hrs_unc) as hrs_unc, sum(rev_unc) as rev_unc,
           sum(hrs_unc) filter (where bill is null) as unpriced_rev_hrs,
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
           a.hrs_unc as a_hrs_unc, a.rev_unc as a_rev_unc, ip.billed, ip.billed_hrs,
           pn.hrs as p_hrs, pn.rev_unc as p_rev, coalesce(pn.wages, 0) + coalesce(pn.burden, 0) + coalesce(pn.agency, 0) as p_cost,
           ep.amt as expenses, ep.labor_amt as labor_expenses
    from public.properties p
    left join cur_rate cr on cr.property_id = p.id
    left join agg a on a.property_id = p.id and a.b = 'a'
    left join agg pn on pn.property_id = p.id and pn.b = 'p'
    left join exp_prop ep on ep.property_id = p.id
    left join inv_prop ip on ip.property_id = p.id
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
    'federal_tax_pct', v_tax,
    'properties', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', id, 'name', name,
        'current_rate', cur_rate, 'current_rate_from', cur_rate_from, 'current_rate_source', cur_rate_source,
        'hours', round((coalesce(a_hrs_unc, 0) + coalesce(billed_hrs, 0))::numeric, 2),
        'revenue', round((coalesce(a_rev_unc, 0) + coalesce(billed, 0))::numeric, 2),
        'timecard_hours', round(coalesce(a_hrs, 0)::numeric, 2),
        'timecard_revenue', round(coalesce(a_rev, 0)::numeric, 2),
        'billed', round(coalesce(billed, 0)::numeric, 2),
        'billed_hours', round(coalesce(billed_hrs, 0)::numeric, 2),
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
      ) order by coalesce(a_rev_unc, 0) + coalesce(billed, 0) desc, name)
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
        'revenue', round((coalesce(r.rev, 0) + coalesce(ib.billed, 0))::numeric, 2),
        'cost', round((coalesce(r.cost, 0) + coalesce(xe.amt, 0))::numeric, 2),
        'pending_revenue', round(coalesce(r.p_rev, 0)::numeric, 2),
        'pending_cost', round(coalesce(r.p_cost, 0)::numeric, 2)
      ) order by d.day)
      from (select generate_series(v_start, v_end, interval '1 day')::date as day) d
      left join (
        select day,
               sum(rev_unc) filter (where b = 'a') as rev,
               sum(wages + burden + agency) filter (where b = 'a') as cost,
               sum(rev_unc) filter (where b = 'p') as p_rev,
               sum(wages + burden + agency) filter (where b = 'p') as p_cost
        from xb group by day) r on r.day = d.day
      left join (select spent_on as day, sum(amount) as amt from ex group by spent_on) xe on xe.day = d.day
      left join (select day, sum(billed) as billed from inv_day group by day) ib on ib.day = d.day), '[]'::jsonb),
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
end $function$
;

-- Watch totals do their own invoice math, so they read the raw timecard figures.
CREATE OR REPLACE FUNCTION public.property_watch__totals(p_property uuid, p_start date, p_end date, p_running boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_hours := coalesce((r->>'timecard_hours')::numeric, (r->>'hours')::numeric, 0);
  v_rev := coalesce((r->>'timecard_revenue')::numeric, (r->>'revenue')::numeric, 0);
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
end $function$
;
revoke all on function public.property_watch__totals(uuid, date, date, boolean) from public, anon, authenticated;

-- Rollback: re-run backend/sql/expenses-in-profit.sql (profit_dashboard + property_watch__totals),
-- drop function public.profit_save_tax(numeric); alter table public.profit_settings drop column federal_tax_pct;
