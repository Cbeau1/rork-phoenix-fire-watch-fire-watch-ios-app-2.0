-- Readable full export for organization admins: one sheet per area of the app, with names instead of ids
-- and dates/times in the organization's time zone. Only the caller's organization is included.
create or replace function private.export_sheet(p_name text, p_query text, p_org uuid, p_tz text)
returns json language plpgsql security definer set search_path = public as $fn$
declare r json;
begin
  -- The left join keeps one all-empty row when there's no data, so the column headers still come through.
  execute format(
    'select coalesce(json_agg(t order by t.__n), ''[]''::json) from (select q.* from (select 1) d left join (select row_number() over () as __n, x.* from (%s) x) q on true) t',
    p_query) into r using p_org, p_tz;
  return json_build_object('name', p_name, 'rows', r);
end $fn$;
revoke all on function private.export_sheet(text, text, uuid, text) from public, anon, authenticated;

create or replace function public.admin_export_report()
returns json language plpgsql stable security definer set search_path = public as $fn$
declare
  org uuid := public.my_org_id();
  tz text;
  o organizations;
  sheets json[] := '{}';
  -- shared snippets ($1 = org id, $2 = time zone)
  t_ text := 'to_char(%s at time zone $2, ''YYYY-MM-DD HH24:MI'')';
  nm text := 'lower(regexp_replace(trim(%s), ''\s+'', '' '', ''g''))';
begin
  if org is null or not public.is_org_admin() then
    raise exception 'Only organization admins can export data.' using errcode = '42501';
  end if;
  select * into o from organizations where id = org;
  tz := coalesce(nullif(o.timezone, ''), 'America/New_York');
  begin perform now() at time zone tz; exception when others then tz := 'America/New_York'; end;

  sheets := sheets || private.export_sheet('Properties & clients', $q$
    select p.name as "Property", p.address as "Address", p.contact_name as "Client contact", p.contact_phone as "Client phone",
      p.contact_email as "Client email", p.patrol_interval_minutes as "Patrol every (min)",
      case when p.geofence_enabled then 'On (' || p.geofence_radius_m || ' m)' else 'Off' end as "Geofence",
      p.notes as "Notes", to_char(p.created_at at time zone $2, 'YYYY-MM-DD') as "Added"
    from properties p where p.org_id = $1 order by p.name $q$, org, tz);

  sheets := sheets || private.export_sheet('Employees', $q$
    select trim(w.first_name || ' ' || w.last_name) as "Name", w.worker_code as "Employee #",
      case w.source when 'agency' then 'Temp agency' else 'Direct' end as "Type", a.name as "Agency", w.agency_worker_ref as "Agency ref",
      w.position as "Position", initcap(replace(w.status, '_', ' ')) as "Status", w.phone as "Phone", w.email as "Email", w.address as "Address",
      w.start_date::text as "Start date", e.employment_type as "Employment type", e.supervisor as "Supervisor", e.end_date::text as "End date",
      (select r.hourly_rate from wf_pay_rates r where r.worker_id = w.id order by r.effective_date desc, r.created_at desc limit 1) as "Current pay rate",
      array_to_string(w.service_areas, ', ') as "Service areas", w.availability as "Availability", w.preferred_contact as "Preferred contact",
      w.emergency_name as "Emergency contact", w.emergency_relationship as "Relationship", w.emergency_phone as "Emergency phone",
      pr.email as "App login", initcap(pr.role) as "App role", case when w.archived_at is null then '' else 'Archived' end as "Archived"
    from wf_workers w
    left join wf_agencies a on a.id = w.agency_id
    left join wf_employment e on e.worker_id = w.id
    left join profiles pr on pr.id = w.profile_id
    where w.org_id = $1
    union all
    -- people on the schedule or with an app login who don't have an employee record
    select coalesce(pr.full_name, s.name), null, 'Not in directory', null, null, null, case when pr.active is false then 'Inactive' else 'Active' end,
      null, null, null, null, null, null, null, null, null, null, null, null, null, null, pr.email, initcap(pr.role), ''
    from (select s.name, s.profile_id from staff s where s.org_id = $1
          union select p.full_name, p.id from profiles p where p.org_id = $1) s
    left join profiles pr on pr.id = s.profile_id
    where not exists (select 1 from wf_workers w where w.org_id = $1 and (w.profile_id = s.profile_id
      or lower(trim(w.first_name || ' ' || w.last_name)) = lower(trim(s.name))))
    order by 3, 1 $q$, org, tz);

  sheets := sheets || private.export_sheet('Pay rates', $q$
    select trim(w.first_name || ' ' || w.last_name) as "Employee", case w.source when 'agency' then 'Temp agency' else 'Direct' end as "Type",
      r.hourly_rate as "Hourly rate", r.effective_date::text as "Effective", r.note as "Note", to_char(r.created_at at time zone $2, 'YYYY-MM-DD HH24:MI') as "Entered"
    from wf_pay_rates r join wf_workers w on w.id = r.worker_id where r.org_id = $1
    order by 1, r.effective_date desc $q$, org, tz);

  sheets := sheets || private.export_sheet('Temp agencies', $q$
    select a.name as "Agency", a.primary_contact as "Contact", a.phone as "Phone", a.email as "Email",
      a.after_hours_contact as "After-hours contact", a.after_hours_phone as "After-hours phone",
      a.billing_contact as "Billing contact", a.billing_email as "Billing email", a.billing_phone as "Billing phone",
      a.address as "Address", a.account_number as "Account #", a.payment_terms as "Terms",
      (array['Mon','Tue','Wed','Thu','Fri','Sat','Sun'])[a.bill_week_start] || '–' || (array['Mon','Tue','Wed','Thu','Fri','Sat','Sun'])[((a.bill_week_start + 5) % 7) + 1]
        || ', invoiced ' || (array['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'])[a.invoice_weekday] as "Billing week",
      case when a.active then 'Active' else 'Inactive' end as "Status", a.notes as "Notes"
    from wf_agencies a where a.org_id = $1 order by a.name $q$, org, tz);

  sheets := sheets || private.export_sheet('Placements', $q$
    select trim(w.first_name || ' ' || w.last_name) as "Worker", a.name as "Agency", coalesce(p.name, pl.property_name) as "Property",
      pl.start_date::text as "Start", pl.end_date::text as "End", initcap(pl.status) as "Status", pl.agency_ref as "Agency ref",
      pl.ot_terms as "OT terms", pl.holiday_terms as "Holiday terms", pl.end_reason as "End reason", pl.notes as "Notes"
    from wf_placements pl left join wf_workers w on w.id = pl.worker_id left join wf_agencies a on a.id = pl.agency_id
    left join properties p on p.id = pl.property_id where pl.org_id = $1 order by pl.start_date desc $q$, org, tz);

  sheets := sheets || private.export_sheet('Schedule', $q$
    select s.shift_date::text as "Date", to_char(s.shift_date, 'Dy') as "Day", to_char(s.start_time, 'HH24:MI') as "Start",
      to_char(s.end_time, 'HH24:MI') as "End",
      round((extract(epoch from (s.end_time - s.start_time)) / 3600 + case when s.end_time <= s.start_time then 24 else 0 end)::numeric, 2) as "Hours",
      p.name as "Property", st.name as "Employee", s.notes as "Notes",
      case when sp.shift_id is null then '' else 'Paid ' || to_char(sp.paid_at at time zone $2, 'YYYY-MM-DD') end as "Paid"
    from shifts s left join properties p on p.id = s.property_id left join staff st on st.id = s.staff_id
    left join shift_payments sp on sp.shift_id = s.id
    where s.org_id = $1 order by s.shift_date desc, s.start_time $q$, org, tz);

  sheets := sheets || private.export_sheet('Timesheets', $q$
    select to_char(te.clock_in at time zone $2, 'YYYY-MM-DD') as "Date", to_char(te.clock_in at time zone $2, 'Dy') as "Day",
      te.worker_name as "Employee", p.name as "Property",
      to_char(te.clock_in at time zone $2, 'YYYY-MM-DD HH24:MI') as "Clock in", to_char(te.clock_out at time zone $2, 'YYYY-MM-DD HH24:MI') as "Clock out",
      round((floor(extract(epoch from (te.clock_out - te.clock_in)) / 60) / 60.0)::numeric, 2) as "Hours",
      case when te.clock_out is null then 'Clocked in' else initcap(te.status) end as "Status",
      ap.full_name as "Approved by", to_char(te.approved_at at time zone $2, 'YYYY-MM-DD HH24:MI') as "Approved at",
      case when te.edited then 'Yes' else '' end as "Edited", initcap(te.source) as "Source",
      te.employee_note as "Employee note", te.admin_note as "Admin note"
    from time_entries te left join properties p on p.id = te.property_id left join profiles ap on ap.id = te.approved_by
    where te.org_id = $1 order by te.clock_in desc $q$, org, tz);

  sheets := sheets || private.export_sheet('Payroll by week', $q$
    with e as (
      select te.*, (te.clock_in at time zone $2)::date as day,
        floor(extract(epoch from (te.clock_out - te.clock_in)) / 60)::int as mins,
        coalesce(te.profile_id::text, 'name:' || lower(regexp_replace(trim(te.worker_name), '\s+', ' ', 'g'))) as pkey
      from time_entries te where te.org_id = $1 and te.status = 'approved' and te.clock_out is not null
    ), r as (
      select e.*, (e.day - (extract(isodow from e.day)::int - 1)) as wk,
        (select w.id from wf_workers w where w.org_id = $1 and ((e.profile_id is not null and w.profile_id = e.profile_id)
           or lower(regexp_replace(trim(w.first_name || ' ' || w.last_name), '\s+', ' ', 'g')) = lower(regexp_replace(trim(e.worker_name), '\s+', ' ', 'g')))
         order by (w.profile_id = e.profile_id) desc nulls last limit 1) as worker_id
      from e
    ), priced as (
      select r.*, coalesce(
        (select pr.hourly_rate from wf_pay_rates pr where pr.worker_id = r.worker_id and pr.effective_date <= r.day order by pr.effective_date desc, pr.created_at desc limit 1),
        (select pr.hourly_rate from wf_pay_rates pr where pr.worker_id = r.worker_id order by pr.effective_date asc, pr.created_at asc limit 1)) as rate
      from r
    ), wk as (
      select pkey, wk, max(worker_name) as name, max(worker_id::text) as worker_id, count(*) as shifts, sum(mins) as mins,
        sum(case when rate is not null then mins end) as priced_min, sum(mins / 60.0 * rate) as straight,
        sum(case when rate is null then mins else 0 end) as unpriced
      from priced group by pkey, wk
    )
    select wk.wk::text as "Week starting (Mon)", (wk.wk + 6)::text as "Week ending (Sun)", wk.name as "Employee",
      case w.source when 'agency' then 'Temp agency' when 'direct' then 'Direct' else '' end as "Type", a.name as "Agency",
      wk.shifts as "Shifts", round(wk.mins / 60.0, 2) as "Total hours", round(least(wk.mins, 2400) / 60.0, 2) as "Regular hours",
      round(greatest(wk.mins - 2400, 0) / 60.0, 2) as "Overtime hours",
      round(coalesce(wk.straight, 0), 2) as "Straight pay",
      round(case when wk.mins > 2400 and wk.priced_min > 0 then (wk.mins - 2400) / 60.0 * 0.5 * (wk.straight / (wk.priced_min / 60.0)) else 0 end, 2) as "OT premium (0.5x)",
      round(coalesce(wk.straight, 0) + case when wk.mins > 2400 and wk.priced_min > 0 then (wk.mins - 2400) / 60.0 * 0.5 * (wk.straight / (wk.priced_min / 60.0)) else 0 end, 2) as "Gross pay (est.)",
      case when wk.unpriced > 0 then round(wk.unpriced / 60.0, 2) || ' hrs have no pay rate' else '' end as "Note"
    from wk left join wf_workers w on w.id = wk.worker_id::uuid left join wf_agencies a on a.id = w.agency_id
    order by wk.wk desc, wk.name $q$, org, tz);

  sheets := sheets || private.export_sheet('Agency invoices', $q$
    select a.name as "Agency", i.invoice_number as "Invoice #", case when i.auto_generated then 'Automatic (weekly)' else 'Entered' end as "Source",
      i.period_start::text as "Service from", i.period_end::text as "Service to", i.invoice_date::text as "Invoice date", i.due_date::text as "Due date",
      i.total as "Total", initcap(replace(i.status, '_', ' ')) as "Status", i.paid_on::text as "Paid on", i.payment_ref as "Payment ref",
      i.review_notes as "Notes", case when i.archived_at is null then '' else 'Archived' end as "Archived"
    from wf_invoices i left join wf_agencies a on a.id = i.agency_id where i.org_id = $1 order by i.period_start desc nulls last $q$, org, tz);

  sheets := sheets || private.export_sheet('Invoice lines', $q$
    select i.invoice_number as "Invoice #", a.name as "Agency", trim(w.first_name || ' ' || w.last_name) as "Worker",
      initcap(l.line_type) as "Type", l.service_start::text as "Date", l.description as "Description", l.hours as "Hours", l.rate as "Rate", l.amount as "Amount"
    from wf_invoice_lines l join wf_invoices i on i.id = l.invoice_id left join wf_agencies a on a.id = i.agency_id left join wf_workers w on w.id = l.worker_id
    where l.org_id = $1 order by i.period_start desc nulls last, l.service_start, l.description $q$, org, tz);

  sheets := sheets || private.export_sheet('Expenditures', $q$
    select x.code as "Ref", x.spent_on::text as "Date", x.vendor as "Vendor", x.description as "Description", c.name as "Category",
      x.amount as "Amount", x.tax_amount as "Tax", x.currency as "Currency", initcap(replace(x.paid_by, '_', ' ')) as "Paid by", x.payer_name as "Payer",
      initcap(replace(x.payment_method, '_', ' ')) as "Method", x.account_label as "Account", coalesce(p.name, x.property_name) as "Property",
      a.name as "Agency", x.invoice_ref as "Invoice ref", x.purpose as "Purpose", x.notes as "Notes",
      case when x.recurring_id is not null then 'Monthly recurring' else '' end as "Recurring",
      case when x.archived_at is null then '' else 'Archived: ' || coalesce(x.archive_reason, '') end as "Archived",
      to_char(x.created_at at time zone $2, 'YYYY-MM-DD HH24:MI') as "Entered"
    from ex_expenditures x left join ex_categories c on c.id = x.category_id left join properties p on p.id = x.property_id
    left join wf_agencies a on a.id = x.agency_id where x.org_id = $1 order by x.spent_on desc, x.code desc $q$, org, tz);

  sheets := sheets || private.export_sheet('Recurring expenses', $q$
    select r.vendor as "Vendor", r.description as "Description", c.name as "Category", r.amount as "Monthly amount", r.currency as "Currency",
      r.day_of_month as "Day of month", r.start_on::text as "Starts", r.end_on::text as "Ends",
      case when r.archived_at is not null then 'Stopped' when r.paused_at is not null then 'Paused' else 'Active' end as "Status",
      initcap(replace(r.payment_method, '_', ' ')) as "Method", coalesce(p.name, r.property_name) as "Property", r.last_run_on::text as "Last added", r.notes as "Notes"
    from ex_recurring r left join ex_categories c on c.id = r.category_id left join properties p on p.id = r.property_id
    where r.org_id = $1 order by r.vendor $q$, org, tz);

  sheets := sheets || private.export_sheet('Reimbursements', $q$
    select r.code as "Ref", x.code as "Expenditure", case r.direction when 'person' then 'Owed to person' else initcap(replace(r.direction, '_', ' ')) end as "Direction",
      r.party_name as "Party", r.requested_amount as "Requested", r.approved_amount as "Approved", r.requested_on::text as "Requested on",
      r.due_on::text as "Due", initcap(replace(r.status, '_', ' ')) as "Status", r.invoice_ref as "Invoice ref", r.review_note as "Review note", r.notes as "Notes"
    from ex_reimbursements r left join ex_expenditures x on x.id = r.expenditure_id where r.org_id = $1 order by r.requested_on desc $q$, org, tz);

  sheets := sheets || private.export_sheet('Payments', $q$
    select p.code as "Ref", p.paid_on::text as "Date", initcap(replace(p.direction, '_', ' ')) as "Direction", p.party_name as "Party",
      p.amount as "Amount", p.currency as "Currency", initcap(replace(p.method, '_', ' ')) as "Method", p.reference as "Reference", p.notes as "Notes"
    from ex_payments p where p.org_id = $1 order by p.paid_on desc $q$, org, tz);

  sheets := sheets || private.export_sheet('Patrol logs', $q$
    select to_char(pa.date_time at time zone $2, 'YYYY-MM-DD HH24:MI') as "Date & time", p.name as "Property", pa.officer_name as "Officer",
      initcap(replace(pa.status, '_', ' ')) as "Status", array_to_string(pa.areas, ', ') as "Areas", pa.notes as "Notes",
      coalesce(array_length(pa.photos, 1), 0) as "Photos",
      case when pa.latitude is null then '' else round(pa.latitude::numeric, 5) || ', ' || round(pa.longitude::numeric, 5) end as "Location"
    from patrols pa left join properties p on p.id = pa.property_id where pa.org_id = $1 order by pa.date_time desc $q$, org, tz);

  sheets := sheets || private.export_sheet('Watch notes', $q$
    select to_char(n.created_at at time zone $2, 'YYYY-MM-DD HH24:MI') as "Written", n.author_name as "Author", n.content as "Note",
      to_char(n.resolved_at at time zone $2, 'YYYY-MM-DD HH24:MI') as "Resolved"
    from watch_notes n where n.org_id = $1 order by n.created_at desc $q$, org, tz);

  sheets := sheets || private.export_sheet('Documents', $q$
    select d.title as "Title", initcap(replace(d.category, '_', ' ')) as "Category",
      coalesce(trim(w.first_name || ' ' || w.last_name), a.name, i.invoice_number, initcap(d.owner_type)) as "Belongs to",
      d.issue_date::text as "Issued", d.expiration_date::text as "Expires", initcap(d.classification) as "Classification",
      case when d.signed then 'Yes' else '' end as "Signed", d.current_version as "Version",
      to_char(d.created_at at time zone $2, 'YYYY-MM-DD') as "Uploaded", case when d.archived_at is null then '' else 'Archived' end as "Archived"
    from wf_documents d left join wf_workers w on w.id = d.worker_id left join wf_agencies a on a.id = d.agency_id
    left join wf_invoices i on i.id = d.invoice_id where d.org_id = $1 order by d.created_at desc $q$, org, tz);

  sheets := sheets || private.export_sheet('Equipment', $q$
    select trim(w.first_name || ' ' || w.last_name) as "Employee", eq.item_name as "Item", initcap(eq.item_type) as "Type", eq.asset_number as "Asset #",
      eq.quantity as "Qty", initcap(eq.ownership) as "Ownership", eq.issued_on::text as "Issued", eq.returned_on::text as "Returned",
      initcap(replace(eq.status, '_', ' ')) as "Status", eq.notes as "Notes"
    from wf_equipment eq left join wf_workers w on w.id = eq.worker_id where eq.org_id = $1 order by eq.issued_on desc nulls last $q$, org, tz);

  sheets := sheets || private.export_sheet('Personnel records', $q$
    select trim(w.first_name || ' ' || w.last_name) as "Employee", initcap(replace(r.record_type, '_', ' ')) as "Type", r.title as "Title",
      to_char(r.event_at at time zone $2, 'YYYY-MM-DD HH24:MI') as "When", p.name as "Property", initcap(replace(r.status, '_', ' ')) as "Status",
      r.reporting_person as "Reported by", r.allegation as "Allegation", r.observations as "Observations", r.worker_response as "Worker response",
      r.findings as "Findings", r.outcome as "Outcome", r.action_taken as "Action taken", r.followup_due::text as "Follow-up due"
    from wf_personnel_records r left join wf_workers w on w.id = r.worker_id left join properties p on p.id = r.property_id
    where r.org_id = $1 order by r.event_at desc $q$, org, tz);

  sheets := sheets || private.export_sheet('App users', $q$
    select p.full_name as "Name", p.email as "Email", initcap(p.role) as "Role", case when p.active then 'Active' else 'Inactive' end as "Status",
      to_char(p.created_at at time zone $2, 'YYYY-MM-DD') as "Joined", to_char(p.terms_accepted_at at time zone $2, 'YYYY-MM-DD') as "Accepted terms"
    from profiles p where p.org_id = $1 order by p.full_name $q$, org, tz);

  return json_build_object('org_name', o.name, 'timezone', tz, 'exported_at', now(), 'sheets', array_to_json(sheets));
end $fn$;

revoke all on function public.admin_export_report() from public, anon;
grant execute on function public.admin_export_report() to authenticated;
