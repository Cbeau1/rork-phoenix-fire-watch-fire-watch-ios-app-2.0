-- Temp agency billing weeks: each agency has its own billing week (default Tuesday through Monday,
-- i.e. Tuesday 12:00 AM to the next Tuesday 12:00 AM) and invoice day (default Wednesday).
alter table public.wf_agencies add column if not exists bill_week_start smallint not null default 2
  check (bill_week_start between 1 and 7);
alter table public.wf_agencies add column if not exists invoice_weekday smallint not null default 3
  check (invoice_weekday between 1 and 7);
comment on column public.wf_agencies.bill_week_start is 'ISO weekday the billing week starts (1=Mon … 7=Sun).';
comment on column public.wf_agencies.invoice_weekday is 'ISO weekday the weekly invoice is dated, first one after the week ends.';

create or replace function private.wf_bill_week(d date, start_dow int)
returns date language sql immutable as $fn$
  select d - ((extract(isodow from d)::int - coalesce(start_dow, 2) + 7) % 7)
$fn$;

-- First invoice weekday on or after the morning the week closes.
create or replace function private.wf_bill_invoice_date(wk date, inv_dow int)
returns date language sql immutable as $fn$
  select (wk + 7) + ((coalesce(inv_dow, 3) - extract(isodow from wk + 7)::int + 7) % 7)
$fn$;

CREATE OR REPLACE FUNCTION private.wf_agency_invoice_build(p_org uuid, p_agency uuid, p_week date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
declare
  tz text;
  wk date;
  inv_on date;
  is_ready boolean;
  ws timestamptz; we timestamptz;
  is_open boolean;
  inv public.wf_invoices;
  ag public.wf_agencies;
  terms int;
  r record;
  cur_worker uuid := null;
  run_min int := 0;
  reg int; ot int; rate numeric; ot_rate numeric; day date; label text;
  lines jsonb := '[]'::jsonb;
  v_total numeric := 0;
  reg_tot int := 0; ot_tot int := 0; unpriced int := 0; n_shifts int := 0;
  workers int; pend_n int; pend_min int;
  changed boolean;
  summary jsonb;
  new_status text;
begin
  select coalesce(nullif(o.timezone, ''), 'America/New_York') into tz from organizations o where o.id = p_org;
  select * into ag from wf_agencies a where a.id = p_agency and a.org_id = p_org;
  if tz is null or ag.id is null then return null; end if;
  wk := private.wf_bill_week(p_week, ag.bill_week_start);
  inv_on := private.wf_bill_invoice_date(wk, ag.invoice_weekday);
  perform pg_advisory_xact_lock(hashtext('wf_auto_inv:' || p_org || ':' || p_agency || ':' || wk));
  ws := wk::timestamp at time zone tz;
  we := (wk + 7)::timestamp at time zone tz;
  is_open := now() < we;
  -- Ready to pay from the start of the agency's invoice day (e.g. Wednesday after a Tue–Mon week).
  is_ready := now() >= (inv_on::timestamp at time zone tz);

  select * into inv from wf_invoices i where i.org_id = p_org and i.agency_id = p_agency and i.period_start = wk and i.auto_generated;
  if inv.id is not null and (inv.status = 'paid' or inv.archived_at is not null) then return inv.id; end if;

  for r in
    with m as (
      select distinct on (te.id) te.id, te.clock_in, te.clock_out, w.id as worker_id,
        trim(w.first_name || ' ' || w.last_name) as wname, coalesce(p.name, '') as site,
        floor(extract(epoch from (te.clock_out - te.clock_in)) / 60)::int as mins
      from time_entries te
      join wf_workers w on w.org_id = p_org and w.source = 'agency' and w.agency_id = p_agency
        and ((te.profile_id is not null and te.profile_id = w.profile_id)
          or (te.profile_id is null and lower(regexp_replace(trim(te.worker_name), '\s+', ' ', 'g'))
              = lower(regexp_replace(trim(w.first_name || ' ' || w.last_name), '\s+', ' ', 'g'))))
      left join properties p on p.id = te.property_id
      where te.org_id = p_org and te.status = 'approved' and te.clock_out is not null
        and te.clock_in >= ws and te.clock_in < we
        and not exists (select 1 from wf_invoice_lines l join wf_invoices i2 on i2.id = l.invoice_id
          where l.time_entry_id = te.id and i2.auto_generated and i2.id is distinct from inv.id
            and (i2.status = 'paid' or i2.archived_at is not null))
      order by te.id
    )
    select * from m order by wname, worker_id, clock_in
  loop
    if cur_worker is distinct from r.worker_id then
      cur_worker := r.worker_id;
      run_min := 0;
    end if;
    reg := greatest(0, least(r.mins, 2400 - run_min));
    ot := r.mins - reg;
    run_min := run_min + r.mins;
    n_shifts := n_shifts + 1;
    day := (r.clock_in at time zone tz)::date;
    rate := coalesce(
      (select pr.hourly_rate from wf_pay_rates pr where pr.worker_id = r.worker_id and pr.effective_date <= day
        order by pr.effective_date desc, pr.created_at desc limit 1),
      (select pr.hourly_rate from wf_pay_rates pr where pr.worker_id = r.worker_id
        order by pr.effective_date asc, pr.created_at asc limit 1));
    label := r.wname || ' — ' || to_char(r.clock_in at time zone tz, 'Dy Mon FMDD, FMHH12:MI AM') || ' – '
      || case when (r.clock_out at time zone tz)::date = day
           then to_char(r.clock_out at time zone tz, 'FMHH12:MI AM')
           else to_char(r.clock_out at time zone tz, 'Dy FMHH12:MI AM') end
      || case when r.site <> '' then ' · ' || r.site else '' end;
    if reg > 0 then
      lines := lines || jsonb_build_object(
        'time_entry_id', r.id, 'worker_id', r.worker_id, 'line_type', 'regular', 'service_start', day, 'service_end', day,
        'description', label, 'hours', round(reg / 60.0, 2), 'rate', rate,
        'amount', coalesce(round(round(reg / 60.0, 2) * rate, 2), 0));
      reg_tot := reg_tot + reg;
      if rate is null then unpriced := unpriced + reg; end if;
      v_total := v_total + coalesce(round(round(reg / 60.0, 2) * rate, 2), 0);
    end if;
    if ot > 0 then
      ot_rate := round(rate * 1.5, 2);
      lines := lines || jsonb_build_object(
        'time_entry_id', r.id, 'worker_id', r.worker_id, 'line_type', 'overtime', 'service_start', day, 'service_end', day,
        'description', label || ' (overtime)', 'hours', round(ot / 60.0, 2), 'rate', ot_rate,
        'amount', coalesce(round(round(ot / 60.0, 2) * ot_rate, 2), 0));
      ot_tot := ot_tot + ot;
      if rate is null then unpriced := unpriced + ot; end if;
      v_total := v_total + coalesce(round(round(ot / 60.0, 2) * ot_rate, 2), 0);
    end if;
  end loop;

  select count(distinct x.worker_id) into workers from jsonb_to_recordset(lines) as x(worker_id uuid);

  select count(*), coalesce(sum(floor(extract(epoch from (coalesce(te.clock_out, now()) - te.clock_in)) / 60)), 0)::int
    into pend_n, pend_min
  from time_entries te
  where te.org_id = p_org and te.status = 'pending' and te.clock_in >= ws and te.clock_in < we
    and exists (select 1 from wf_workers w where w.org_id = p_org and w.source = 'agency' and w.agency_id = p_agency
      and ((te.profile_id is not null and te.profile_id = w.profile_id)
        or (te.profile_id is null and lower(regexp_replace(trim(te.worker_name), '\s+', ' ', 'g'))
            = lower(regexp_replace(trim(w.first_name || ' ' || w.last_name), '\s+', ' ', 'g')))));

  if jsonb_array_length(lines) = 0 then
    if inv.id is not null and not exists (select 1 from wf_documents d where d.invoice_id = inv.id) then
      delete from wf_invoices where id = inv.id;
    end if;
    return null;
  end if;

  summary := jsonb_build_object(
    'regular_min', reg_tot, 'overtime_min', ot_tot, 'unpriced_min', unpriced, 'shifts', n_shifts, 'workers', workers,
    'pending_shifts', pend_n, 'pending_min', pend_min, 'week_closed', not is_open, 'ready', is_ready);
  terms := coalesce((regexp_match(lower(coalesce(ag.payment_terms, '')), 'net\s*(\d+)'))[1]::int, 30);

  if inv.id is null then
    insert into wf_invoices(org_id, agency_id, invoice_number, period_start, period_end, invoice_date, due_date, total,
      status, auto_generated, generated_at, auto_summary)
    values (p_org, p_agency, 'PFW-' || to_char(wk, 'IYYY') || '-W' || to_char(wk, 'IW'), wk, wk + 6, inv_on, inv_on + terms,
      v_total, case when is_ready then 'received' else 'draft' end, true, now(), summary)
    returning * into inv;
    changed := true;
  else
    select exists (
      (select x.time_entry_id, x.line_type, x.hours, x.rate, x.amount, x.description, x.worker_id
         from jsonb_to_recordset(lines) as x(time_entry_id uuid, line_type text, hours numeric, rate numeric, amount numeric, description text, worker_id uuid)
       except
       select l.time_entry_id, l.line_type, l.hours, l.rate, l.amount, l.description, l.worker_id from wf_invoice_lines l where l.invoice_id = inv.id)
      union all
      (select l.time_entry_id, l.line_type, l.hours, l.rate, l.amount, l.description, l.worker_id from wf_invoice_lines l where l.invoice_id = inv.id
       except
       select x.time_entry_id, x.line_type, x.hours, x.rate, x.amount, x.description, x.worker_id
         from jsonb_to_recordset(lines) as x(time_entry_id uuid, line_type text, hours numeric, rate numeric, amount numeric, description text, worker_id uuid))
    ) into changed;
    new_status := case when inv.status = 'draft' and is_ready then 'received' else inv.status end;
    if changed or inv.invoice_date is distinct from inv_on or inv.total is distinct from v_total or inv.auto_summary is distinct from summary or inv.status is distinct from new_status then
      update wf_invoices set total = v_total, auto_summary = summary, status = new_status,
        invoice_date = inv_on, due_date = inv_on + terms,
        generated_at = case when changed then now() else generated_at end
      where id = inv.id;
    end if;
  end if;

  if changed then
    delete from wf_invoice_lines where invoice_id = inv.id;
    insert into wf_invoice_lines(org_id, invoice_id, time_entry_id, worker_id, line_type, service_start, service_end, description, hours, rate, amount)
    select p_org, inv.id, x.time_entry_id, x.worker_id, x.line_type, x.service_start, x.service_end, x.description, x.hours, x.rate, x.amount
    from jsonb_to_recordset(lines) as x(time_entry_id uuid, worker_id uuid, line_type text, service_start date, service_end date,
      description text, hours numeric, rate numeric, amount numeric);
  end if;
  return inv.id;
end $fn$;

CREATE OR REPLACE FUNCTION private.wf_agency_invoices_sync(p_org uuid, p_since date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
declare
  tz text;
  r record;
  n int := 0;
begin
  select coalesce(nullif(o.timezone, ''), 'America/New_York') into tz from organizations o where o.id = p_org;
  if tz is null then return 0; end if;
  -- Unpaid auto invoices laid out on an old billing week are replaced by ones on the agency's current week.
  -- Ones with attachments or expense links are archived (kept for the record) instead of deleted.
  update wf_invoices i set archived_at = now()
  from wf_agencies a
  where a.id = i.agency_id and i.org_id = p_org and i.auto_generated and i.status <> 'paid' and i.archived_at is null
    and extract(isodow from i.period_start)::int <> a.bill_week_start
    and (exists (select 1 from wf_documents d where d.invoice_id = i.id)
      or exists (select 1 from ex_expenditures e where e.agency_invoice_id = i.id)
      or exists (select 1 from ex_reimbursements e where e.agency_invoice_id = i.id));
  delete from wf_invoices i
  using wf_agencies a
  where a.id = i.agency_id and i.org_id = p_org and i.auto_generated and i.status <> 'paid' and i.archived_at is null
    and extract(isodow from i.period_start)::int <> a.bill_week_start;
  for r in
    select distinct w.agency_id, private.wf_bill_week((te.clock_in at time zone tz)::date, a.bill_week_start) as wk
    from time_entries te
    join wf_workers w on w.org_id = p_org and w.source = 'agency' and w.agency_id is not null
    join wf_agencies a on a.id = w.agency_id
      and ((te.profile_id is not null and te.profile_id = w.profile_id)
        or (te.profile_id is null and lower(regexp_replace(trim(te.worker_name), '\s+', ' ', 'g'))
            = lower(regexp_replace(trim(w.first_name || ' ' || w.last_name), '\s+', ' ', 'g'))))
    where te.org_id = p_org and te.clock_in >= (p_since::timestamp at time zone tz)
    union
    select i.agency_id, i.period_start from wf_invoices i
    where i.org_id = p_org and i.auto_generated and i.status <> 'paid' and i.archived_at is null and i.period_start >= p_since
  loop
    perform private.wf_agency_invoice_build(p_org, r.agency_id, r.wk);
    n := n + 1;
  end loop;
  return n;
end $fn$;

CREATE OR REPLACE FUNCTION private.wf_time_entry_invoice_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
declare
  rows_ time_entries[];
  tz text;
  r record;
begin
  if TG_OP = 'UPDATE' and NEW.status is not distinct from OLD.status and NEW.clock_in is not distinct from OLD.clock_in
     and NEW.clock_out is not distinct from OLD.clock_out and NEW.profile_id is not distinct from OLD.profile_id
     and NEW.worker_name is not distinct from OLD.worker_name and NEW.property_id is not distinct from OLD.property_id then
    return null;
  end if;
  rows_ := case TG_OP when 'INSERT' then array[NEW] when 'DELETE' then array[OLD] else array[NEW, OLD] end;
  begin
    select coalesce(nullif(o.timezone, ''), 'America/New_York') into tz from organizations o where o.id = coalesce(NEW.org_id, OLD.org_id);
    for r in
      select distinct w.org_id, w.agency_id,
        private.wf_bill_week((x.clock_in at time zone tz)::date, a.bill_week_start) as wk
      from unnest(rows_) x
      join wf_workers w on w.org_id = x.org_id and w.source = 'agency' and w.agency_id is not null
      join wf_agencies a on a.id = w.agency_id
        and ((x.profile_id is not null and x.profile_id = w.profile_id)
          or (x.profile_id is null and lower(regexp_replace(trim(x.worker_name), '\s+', ' ', 'g'))
              = lower(regexp_replace(trim(w.first_name || ' ' || w.last_name), '\s+', ' ', 'g'))))
    loop
      perform private.wf_agency_invoice_build(r.org_id, r.agency_id, r.wk);
    end loop;
  exception when others then
    raise warning 'agency invoice refresh skipped: %', sqlerrm;
  end;
  return null;
end $fn$;

revoke all on function private.wf_bill_week(date, int) from public, anon, authenticated;
revoke all on function private.wf_bill_invoice_date(date, int) from public, anon, authenticated;
revoke all on function private.wf_agency_invoice_build(uuid, uuid, date) from public, anon, authenticated;
revoke all on function private.wf_agency_invoices_sync(uuid, date) from public, anon, authenticated;

-- Re-lay recent weeks on the new billing week.
do $do$
declare o uuid;
begin
  for o in select distinct w.org_id from wf_workers w where w.source = 'agency' and w.agency_id is not null loop
    perform private.wf_agency_invoices_sync(o, current_date - 120);
  end loop;
end $do$;
