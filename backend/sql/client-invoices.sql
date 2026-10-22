-- Client billing: invoices Phoenix sends its clients (downloaded from the TD business invoicing portal and uploaded
-- here). Each invoice is tied to a property so the app can compare what was billed with the hours guards worked and
-- show what hasn't been billed yet. Admin + Employee pay permission only. Additive. Rollback:
--   drop function if exists public.client_billing(), public.client_invoice_save(jsonb, uuid[]),
--     public.client_invoice_status(uuid, text, date), public.client_invoice_delete(uuid),
--     public.client_invoice__guard(), public.client_invoice__worked(uuid, timestamptz, timestamptz);
--   drop policy if exists "Admins upload client invoices" on storage.objects;
--   drop policy if exists "Admins delete client invoices" on storage.objects;
--   drop table if exists public.client_invoices;

create table if not exists public.client_invoices (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  property_id uuid references public.properties(id) on delete set null,
  invoice_number text not null check (length(btrim(invoice_number)) between 1 and 60),
  customer_name text not null default '',
  issued_on date not null,
  due_on date,
  period_start timestamptz,
  period_end timestamptz,
  hours numeric(10,2) check (hours is null or hours >= 0),
  rate numeric(10,2) check (rate is null or rate >= 0),
  amount numeric(12,2) not null check (amount >= 0),
  description text not null default '',
  message text not null default '',
  lines jsonb not null default '[]'::jsonb,
  status text not null default 'open' check (status in ('open', 'paid', 'void')),
  paid_on date,
  file_path text,
  file_name text,
  source text not null default 'upload' check (source in ('upload', 'manual')),
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  check (period_start is null or period_end is null or period_end > period_start),
  unique (org_id, invoice_number)
);
create index if not exists client_invoices_org on public.client_invoices (org_id, issued_on desc);
create index if not exists client_invoices_property on public.client_invoices (property_id, period_end desc);

alter table public.client_invoices enable row level security;
drop policy if exists "Pay admins read client invoices" on public.client_invoices;
create policy "Pay admins read client invoices" on public.client_invoices for select to authenticated
  using (org_id = public.my_org_id() and public.is_org_admin() and public.wf_has('pay'));
revoke all on public.client_invoices from anon;
revoke insert, update, delete on public.client_invoices from authenticated;
grant select on public.client_invoices to authenticated;

-- Invoice PDFs live next to agreement templates: crm-documents/<org>/invoices/<file>.pdf (admins read via the existing policy).
drop policy if exists "Admins upload client invoices" on storage.objects;
create policy "Admins upload client invoices" on storage.objects for insert to authenticated
  with check (bucket_id = 'crm-documents' and (storage.foldername(name))[1] = (public.my_org_id())::text
              and (storage.foldername(name))[2] = 'invoices' and lower(storage.extension(name)) = 'pdf' and public.is_org_admin());
drop policy if exists "Admins delete client invoices" on storage.objects;
create policy "Admins delete client invoices" on storage.objects for delete to authenticated
  using (bucket_id = 'crm-documents' and (storage.foldername(name))[1] = (public.my_org_id())::text
         and (storage.foldername(name))[2] = 'invoices' and public.is_org_admin());

create or replace function public.client_invoice__guard()
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := public.my_org_id();
begin
  if v_org is null or not public.is_org_admin() then raise exception 'Only admins can manage client invoices.' using errcode = '42501'; end if;
  if not public.wf_has('pay') then raise exception 'You need the Employee pay permission to manage client invoices.' using errcode = '42501'; end if;
  return v_org;
end $$;
revoke all on function public.client_invoice__guard() from public, anon, authenticated;

-- Hours guards were on the clock at a property inside a time window (approved / pending / still open; rejected excluded).
create or replace function public.client_invoice__worked(p_property uuid, p_from timestamptz, p_to timestamptz)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'hours', coalesce(round(sum(h) , 2), 0),
    'approved', coalesce(round(sum(h) filter (where status = 'approved'), 2), 0),
    'pending', coalesce(round(sum(h) filter (where status <> 'approved'), 2), 0))
  from (
    select t.status,
           extract(epoch from (least(coalesce(t.clock_out, now()), p_to) - greatest(t.clock_in, p_from))) / 3600.0 as h
    from public.time_entries t
    where t.property_id = p_property and t.status <> 'rejected'
      and t.clock_in < p_to and coalesce(t.clock_out, now()) > p_from
  ) x where h > 0;
$$;
revoke all on function public.client_invoice__worked(uuid, timestamptz, timestamptz) from public, anon, authenticated;

-- Save (insert or update) an invoice. Local period times ("2026-10-12T16:00") are read in the org's time zone.
-- p_void: other invoices this one replaces (e.g. partial invoices consolidated into a final one) are marked void.
create or replace function public.client_invoice_save(p jsonb, p_void uuid[] default '{}')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.client_invoice__guard(); v_tz text := public.org__tz(v_org); v_id uuid := nullif(p->>'id', '')::uuid;
  v_prop uuid := nullif(p->>'property_id', '')::uuid; v_no text := btrim(coalesce(p->>'invoice_number', ''));
  v_path text := nullif(p->>'file_path', ''); v_start timestamptz; v_end timestamptz;
begin
  if v_no = '' then raise exception 'Enter the invoice number.' using errcode = '22023'; end if;
  if nullif(p->>'issued_on', '') is null then raise exception 'Enter the invoice date.' using errcode = '22023'; end if;
  if nullif(p->>'amount', '') is null then raise exception 'Enter the invoice total.' using errcode = '22023'; end if;
  if v_prop is not null and not exists (select 1 from public.properties where id = v_prop and org_id = v_org) then
    raise exception 'Property not found.' using errcode = '22023';
  end if;
  if v_path is not null and v_path not like v_org::text || '/invoices/%' then raise exception 'Invalid file.' using errcode = '22023'; end if;
  if exists (select 1 from public.client_invoices where org_id = v_org and lower(invoice_number) = lower(v_no) and id is distinct from v_id) then
    raise exception 'Invoice #% is already on file.', v_no using errcode = '23505';
  end if;
  v_start := case when nullif(p->>'period_start', '') is null then null else ((p->>'period_start')::timestamp at time zone v_tz) end;
  v_end := case when nullif(p->>'period_end', '') is null then null else ((p->>'period_end')::timestamp at time zone v_tz) end;
  if v_start is not null and v_end is not null and v_end <= v_start then
    raise exception 'The service period must end after it starts.' using errcode = '22023';
  end if;

  if v_id is null then
    insert into public.client_invoices (org_id, property_id, invoice_number, customer_name, issued_on, due_on, period_start, period_end,
      hours, rate, amount, description, message, lines, file_path, file_name, source, created_by)
    values (v_org, v_prop, v_no, coalesce(p->>'customer_name', ''), (p->>'issued_on')::date, nullif(p->>'due_on', '')::date, v_start, v_end,
      nullif(p->>'hours', '')::numeric, nullif(p->>'rate', '')::numeric, (p->>'amount')::numeric,
      left(coalesce(p->>'description', ''), 4000), left(coalesce(p->>'message', ''), 4000), coalesce(p->'lines', '[]'::jsonb),
      v_path, nullif(p->>'file_name', ''), case when v_path is null then 'manual' else 'upload' end, auth.uid())
    returning id into v_id;
  else
    update public.client_invoices set
      property_id = v_prop, invoice_number = v_no, customer_name = coalesce(p->>'customer_name', customer_name),
      issued_on = (p->>'issued_on')::date, due_on = nullif(p->>'due_on', '')::date, period_start = v_start, period_end = v_end,
      hours = nullif(p->>'hours', '')::numeric, rate = nullif(p->>'rate', '')::numeric, amount = (p->>'amount')::numeric,
      description = left(coalesce(p->>'description', description), 4000), message = left(coalesce(p->>'message', message), 4000),
      updated_at = now()
    where id = v_id and org_id = v_org;
    if not found then raise exception 'Invoice not found.' using errcode = '22023'; end if;
  end if;

  if coalesce(array_length(p_void, 1), 0) > 0 then
    update public.client_invoices set status = 'void', updated_at = now()
     where org_id = v_org and id = any(p_void) and id <> v_id and status = 'open';
  end if;
  return v_id;
end $$;
revoke all on function public.client_invoice_save(jsonb, uuid[]) from public, anon;
grant execute on function public.client_invoice_save(jsonb, uuid[]) to authenticated;

create or replace function public.client_invoice_status(p_id uuid, p_status text, p_paid_on date default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.client_invoice__guard();
begin
  if p_status not in ('open', 'paid', 'void') then raise exception 'Unknown status.' using errcode = '22023'; end if;
  update public.client_invoices
     set status = p_status,
         paid_on = case when p_status = 'paid' then coalesce(p_paid_on, (now() at time zone public.org__tz(v_org))::date) else null end,
         updated_at = now()
   where id = p_id and org_id = v_org;
  if not found then raise exception 'Invoice not found.' using errcode = '22023'; end if;
end $$;
revoke all on function public.client_invoice_status(uuid, text, date) from public, anon;
grant execute on function public.client_invoice_status(uuid, text, date) to authenticated;

-- Deletes the record and returns its file path so the caller can remove the PDF.
create or replace function public.client_invoice_delete(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.client_invoice__guard(); v_path text;
begin
  delete from public.client_invoices where id = p_id and org_id = v_org returning file_path into v_path;
  if not found then raise exception 'Invoice not found.' using errcode = '22023'; end if;
  return v_path;
end $$;
revoke all on function public.client_invoice_delete(uuid) from public, anon;
grant execute on function public.client_invoice_delete(uuid) to authenticated;

-- Billing overview: per property billed / paid / outstanding, billed-through point and hours worked since then
-- (not billed yet), plus every invoice with the hours on record inside its service period.
create or replace function public.client_billing()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_org uuid := public.client_invoice__guard(); v_tz text := public.org__tz(v_org);
  v_today date := (now() at time zone v_tz)::date;
begin
  return jsonb_build_object(
    'tz', v_tz, 'today', v_today,
    'properties', coalesce((
      select jsonb_agg(z.j order by z.billed desc, z.name) from (
        select p.name, coalesce(b.billed, 0) as billed, jsonb_build_object(
          'property_id', p.id, 'name', p.name,
          'invoices', coalesce(b.n, 0),
          'billed', coalesce(b.billed, 0), 'billed_hours', coalesce(b.billed_hours, 0),
          'paid', coalesce(b.paid, 0), 'outstanding', coalesce(b.outstanding, 0), 'overdue', coalesce(b.overdue, 0),
          'billed_through', b.through,
          'rate', coalesce(b.last_rate,
                   (select r.hourly_rate from public.property_bill_rates r where r.property_id = p.id
                    order by (r.effective_date <= v_today) desc, case when r.effective_date <= v_today then r.effective_date end desc nulls last,
                             r.effective_date asc, r.created_at desc limit 1)),
          'unbilled_from', u.from_ts,
          'unbilled', case when u.from_ts is null then null else public.client_invoice__worked(p.id, u.from_ts, u.to_ts) end,
          'watch_open', w.open_id is not null) as j
        from public.properties p
        left join lateral (
          select count(*) as n,
                 sum(amount) as billed, sum(coalesce(hours, 0)) as billed_hours,
                 sum(amount) filter (where status = 'paid') as paid,
                 sum(amount) filter (where status = 'open') as outstanding,
                 sum(amount) filter (where status = 'open' and due_on < v_today) as overdue,
                 max(period_end) as through,
                 (array_agg(rate order by issued_on desc, created_at desc) filter (where rate is not null))[1] as last_rate
          from public.client_invoices i where i.property_id = p.id and i.status <> 'void') b on true
        left join lateral (
          select (select x.id from public.property_watches x where x.property_id = p.id and x.ended_on is null limit 1) as open_id,
                 (select max(x.ended_on) from public.property_watches x where x.property_id = p.id) as last_end,
                 (select max(x.started_on) from public.property_watches x where x.property_id = p.id) as last_start) w on true
        left join lateral (
          select f as from_ts,
                 case when w.open_id is null and w.last_end is not null then least(now(), ((w.last_end + 1)::timestamp at time zone v_tz)) else now() end as to_ts
          from (select coalesce(b.through, (w.last_start::timestamp at time zone v_tz)) as f) s
          where f is not null and f < now()) u on true
        where p.org_id = v_org
      ) z), '[]'::jsonb),
    'invoices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'property_id', i.property_id, 'property_name', p.name, 'invoice_number', i.invoice_number,
        'customer_name', i.customer_name, 'issued_on', i.issued_on, 'due_on', i.due_on,
        'period_start', to_char(i.period_start at time zone v_tz, 'YYYY-MM-DD"T"HH24:MI'),
        'period_end', to_char(i.period_end at time zone v_tz, 'YYYY-MM-DD"T"HH24:MI'),
        'hours', i.hours, 'rate', i.rate, 'amount', i.amount, 'description', i.description, 'message', i.message,
        'lines', i.lines, 'status', i.status, 'paid_on', i.paid_on, 'file_path', i.file_path, 'file_name', i.file_name,
        'source', i.source, 'created_at', i.created_at,
        'worked', case when i.property_id is not null and i.period_start is not null and i.period_end is not null
                       then public.client_invoice__worked(i.property_id, i.period_start, i.period_end) end)
        order by i.issued_on desc, i.created_at desc)
      from public.client_invoices i left join public.properties p on p.id = i.property_id
      where i.org_id = v_org), '[]'::jsonb));
end $$;
revoke all on function public.client_billing() from public, anon;
grant execute on function public.client_billing() to authenticated;
