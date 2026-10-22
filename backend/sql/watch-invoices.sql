-- Fire watch totals use uploaded client invoices: the invoiced amount replaces timecard revenue for the time each
-- (non-void) invoice covers, and timecard revenue still counts for hours no invoice covers yet. Costs are unchanged.
-- An invoice that only partly overlaps a watch counts in proportion to the overlapping time.
-- Rollback: re-run the property_watch__totals definition from property-watches.sql.

create or replace function public.property_watch__totals(p_property uuid, p_start date, p_end date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_start date := greatest(p_start, p_end - 400); v jsonb; r jsonb;
  v_tz text; v_from timestamptz; v_to timestamptz;
  v_hours numeric; v_rev numeric; v_cost numeric;
  v_billed numeric := 0; v_billed_hours numeric := 0; v_covered numeric := 0; v_n int := 0;
  v_unbilled_hours numeric; v_unbilled_rev numeric; v_revenue numeric; inv record; f numeric;
begin
  v := public.profit_dashboard('custom', v_start, p_end);
  select e into r from jsonb_array_elements(v->'properties') e where (e->>'id')::uuid = p_property;
  r := coalesce(r, '{}'::jsonb);
  v_hours := coalesce((r->>'hours')::numeric, 0);
  v_rev := coalesce((r->>'revenue')::numeric, 0);
  v_cost := coalesce((r->>'wages')::numeric, 0) + coalesce((r->>'burden')::numeric, 0)
          + coalesce((r->>'agency')::numeric, 0) + coalesce((r->>'expenses')::numeric, 0);

  select public.org__tz(p.org_id) into v_tz from public.properties p where p.id = p_property;
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
    'profit', round(v_revenue - v_cost, 2),
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
revoke all on function public.property_watch__totals(uuid, date, date) from public, anon, authenticated;
