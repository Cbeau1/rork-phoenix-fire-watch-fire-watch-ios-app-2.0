-- Client intake, sales pipeline, quotes and contracts with e-signatures.
-- Additive only: new crm_* tables, a few nullable columns on properties, admin-only access.

-- ---------- Clients & contacts
create table if not exists public.crm_clients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 200),
  billing_name text not null default '',
  billing_email text not null default '',
  billing_phone text not null default '',
  billing_address text not null default '',
  notes text not null default '',
  archived_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists crm_clients_name_uq
  on public.crm_clients (org_id, lower(regexp_replace(trim(name), '\s+', ' ', 'g'))) where archived_at is null;
create index if not exists crm_clients_org_idx on public.crm_clients (org_id);

create table if not exists public.crm_contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.crm_clients(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 200),
  email text not null default '',
  phone text not null default '',
  role text not null default 'other' check (role in ('billing', 'site', 'manager', 'other')),
  receives_updates boolean not null default false,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_contacts_client_idx on public.crm_contacts (client_id);

-- ---------- Property details captured at intake (all optional)
alter table public.properties
  add column if not exists client_id uuid references public.crm_clients(id) on delete set null,
  add column if not exists access_instructions text not null default '',
  add column if not exists fire_marshal_name text not null default '',
  add column if not exists fire_marshal_phone text not null default '',
  add column if not exists fire_marshal_email text not null default '';
create index if not exists properties_client_idx on public.properties (client_id);

-- ---------- Pipeline (one record per fire-watch request)
create table if not exists public.crm_deals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.crm_clients(id) on delete cascade,
  property_id uuid references public.properties(id) on delete set null,
  stage text not null default 'lead'
    check (stage in ('lead', 'quoted', 'contract_sent', 'signed', 'active', 'completed', 'lost')),
  stage_changed_at timestamptz not null default now(),
  reason text not null default '',
  coverage text not null default '24_7' check (coverage in ('24_7', '12_day', '12_night', 'custom')),
  hours_per_week numeric(6,2) check (hours_per_week is null or (hours_per_week > 0 and hours_per_week <= 168)),
  patrol_interval_minutes int check (patrol_interval_minutes is null or patrol_interval_minutes between 10 and 720),
  requested_start_date date,
  requested_start_time time,
  end_date date,
  est_rate numeric(10,2) check (est_rate is null or est_rate >= 0),
  source text not null default '',
  notes text not null default '',
  lost_reason text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_deals_org_idx on public.crm_deals (org_id, stage);
create index if not exists crm_deals_client_idx on public.crm_deals (client_id);

-- ---------- Quotes
create table if not exists public.crm_quotes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  deal_id uuid not null references public.crm_deals(id) on delete cascade,
  number int not null default 0,
  coverage text not null default '24_7' check (coverage in ('24_7', '12_day', '12_night', 'custom')),
  hours_per_week numeric(6,2) not null check (hours_per_week > 0 and hours_per_week <= 168),
  hourly_rate numeric(10,2) not null check (hourly_rate >= 0),
  minimum_hours numeric(6,2) check (minimum_hours is null or minimum_hours >= 0),
  start_date date,
  end_date date,
  schedule text not null default '',
  payment_terms text not null default '',
  notes text not null default '',
  valid_until date,
  status text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'declined')),
  sent_at timestamptz,
  sent_to text not null default '',
  accepted_at timestamptz,
  accepted_by text not null default '',
  accept_note text not null default '',
  accept_source text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_quotes_deal_idx on public.crm_quotes (deal_id);
create unique index if not exists crm_quotes_number_uq on public.crm_quotes (org_id, number);

-- ---------- Contracts
create table if not exists public.crm_contracts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  deal_id uuid not null references public.crm_deals(id) on delete cascade,
  quote_id uuid references public.crm_quotes(id) on delete set null,
  number int not null default 0,
  title text not null default 'Fire Watch Service Agreement',
  body text not null check (length(body) between 1 and 60000),
  coverage text not null default '24_7',
  hours_per_week numeric(6,2),
  hourly_rate numeric(10,2),
  start_date date,
  end_date date,
  payment_terms text not null default '',
  status text not null default 'draft' check (status in ('draft', 'sent', 'signed', 'void')),
  app_origin text not null default '',
  sign_token_hash text unique,
  sign_expires_at timestamptz,
  sent_at timestamptz,
  sent_to text not null default '',
  sent_to_name text not null default '',
  viewed_at timestamptz,
  signer_name text,
  signer_email text,
  signed_at timestamptz,
  signer_ip text,
  signer_user_agent text,
  signature_method text check (signature_method is null or signature_method in ('draw', 'type')),
  signature_image text check (signature_image is null or length(signature_image) < 400000),
  body_sha256 text,
  signed_pdf_path text,
  void_reason text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists crm_contracts_deal_idx on public.crm_contracts (deal_id);
create unique index if not exists crm_contracts_number_uq on public.crm_contracts (org_id, number);

-- ---------- Settings (one row per org)
create table if not exists public.crm_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  company_phone text not null default '',
  company_email text not null default '',
  company_address text not null default '',
  default_rate numeric(10,2),
  payment_terms text not null default 'Net 15',
  quote_valid_days int not null default 14 check (quote_valid_days between 1 and 120),
  sign_link_days int not null default 14 check (sign_link_days between 1 and 60),
  quote_notes text not null default '',
  contract_template text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

-- ---------- Activity timeline (written by triggers / server only)
create table if not exists public.crm_activity (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  deal_id uuid references public.crm_deals(id) on delete cascade,
  client_id uuid references public.crm_clients(id) on delete cascade,
  kind text not null,
  summary text not null,
  actor_id uuid,
  actor_name text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists crm_activity_deal_idx on public.crm_activity (deal_id, created_at desc);

-- ---------- Helpers & triggers
create or replace function private.crm_actor_name() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(full_name, '') from profiles where id = auth.uid()),
                  case when auth.uid() is null then 'Client / system' else 'Admin' end)
$$;

create or replace function private.crm_log(p_org uuid, p_deal uuid, p_client uuid, p_kind text, p_summary text)
returns void language sql security definer set search_path = public as $$
  insert into crm_activity (org_id, deal_id, client_id, kind, summary, actor_id, actor_name)
  values (p_org, p_deal, p_client, p_kind, p_summary, auth.uid(), private.crm_actor_name())
$$;

create or replace function private.crm_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create or replace function private.crm_stage_label(s text) returns text language sql immutable as $$
  select case s when 'lead' then 'Lead' when 'quoted' then 'Quoted' when 'contract_sent' then 'Contract sent'
    when 'signed' then 'Signed' when 'active' then 'Active' when 'completed' then 'Completed' when 'lost' then 'Closed – lost' else s end
$$;

create or replace function private.crm_deal_tg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform private.crm_log(new.org_id, new.id, new.client_id, 'created', 'Intake created');
  elsif new.stage is distinct from old.stage then
    new.stage_changed_at := now();
    perform private.crm_log(new.org_id, new.id, new.client_id, 'stage',
      'Moved from ' || private.crm_stage_label(old.stage) || ' to ' || private.crm_stage_label(new.stage)
      || case when new.stage = 'lost' and new.lost_reason <> '' then ' — ' || new.lost_reason else '' end);
  end if;
  return new;
end $$;

create or replace function private.crm_number_tg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.number is null or new.number = 0 then
    perform pg_advisory_xact_lock(hashtext(tg_table_name || new.org_id::text));
    execute format('select coalesce(max(number), 1000) + 1 from public.%I where org_id = $1', tg_table_name)
      into new.number using new.org_id;
  end if;
  return new;
end $$;

create or replace function private.crm_quote_tg() returns trigger
language plpgsql security definer set search_path = public as $$
declare d crm_deals;
begin
  select * into d from crm_deals where id = new.deal_id;
  if d.org_id is distinct from new.org_id then raise exception 'Quote must belong to the same organization as its intake.'; end if;
  if tg_op = 'INSERT' then
    perform private.crm_log(new.org_id, new.deal_id, d.client_id, 'quote', 'Quote Q-' || new.number || ' created at $' || to_char(new.hourly_rate, 'FM999,990.00') || '/hr');
  elsif new.status is distinct from old.status then
    perform private.crm_log(new.org_id, new.deal_id, d.client_id, 'quote', 'Quote Q-' || new.number || ' ' ||
      case new.status when 'sent' then 'sent to ' || coalesce(nullif(new.sent_to, ''), 'client')
        when 'accepted' then 'accepted' || case when new.accepted_by <> '' then ' by ' || new.accepted_by else '' end
          || case when new.accept_source <> '' then ' (' || new.accept_source || ')' else '' end
        when 'declined' then 'declined' else 'set to ' || new.status end);
    if new.status = 'sent' and d.stage = 'lead' then update crm_deals set stage = 'quoted' where id = d.id; end if;
  end if;
  return new;
end $$;

-- Signed contracts are evidence: once signed, the agreement text and signature can't change.
create or replace function private.crm_contract_tg() returns trigger
language plpgsql security definer set search_path = public as $$
declare d crm_deals;
begin
  select * into d from crm_deals where id = new.deal_id;
  if d.org_id is distinct from new.org_id then raise exception 'Contract must belong to the same organization as its intake.'; end if;
  if tg_op = 'UPDATE' and old.status = 'signed' then
    if new.status <> 'signed' or new.body is distinct from old.body or new.signer_name is distinct from old.signer_name
       or new.signer_email is distinct from old.signer_email or new.signed_at is distinct from old.signed_at
       or new.signature_image is distinct from old.signature_image or new.body_sha256 is distinct from old.body_sha256
       or new.signer_ip is distinct from old.signer_ip or new.hourly_rate is distinct from old.hourly_rate
       or (old.signed_pdf_path is not null and new.signed_pdf_path is distinct from old.signed_pdf_path) then
      raise exception 'A signed contract can''t be changed.' using errcode = '42501';
    end if;
    return new;
  end if;
  -- From the browser an admin can only void a contract or return it to draft; sending and signing go through the server.
  if auth.uid() is not null and new.status is distinct from (case when tg_op = 'UPDATE' then old.status else 'draft' end) and new.status not in ('draft', 'void') then
    raise exception 'Contracts are sent and signed through the secure signing link.' using errcode = '42501';
  end if;
  if new.status = 'signed' and (new.signed_at is null or new.signer_name is null) then
    raise exception 'A contract can only be marked signed by the signer.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.status in ('sent', 'void') and new.body is distinct from old.body then
    -- Editing a sent agreement takes it back to draft and kills the old signing link.
    new.status := 'draft'; new.sign_token_hash := null; new.sign_expires_at := null;
  end if;
  if tg_op = 'INSERT' then
    perform private.crm_log(new.org_id, new.deal_id, d.client_id, 'contract', 'Contract C-' || new.number || ' drafted');
  elsif new.status is distinct from old.status then
    perform private.crm_log(new.org_id, new.deal_id, d.client_id, 'contract', 'Contract C-' || new.number || ' ' ||
      case new.status when 'sent' then 'sent for signature to ' || coalesce(nullif(new.sent_to, ''), 'client')
        when 'signed' then 'signed by ' || coalesce(new.signer_name, 'client') || coalesce(' (' || new.signer_email || ')', '')
        when 'void' then 'voided' || case when new.void_reason <> '' then ' — ' || new.void_reason else '' end
        else 'returned to draft' end);
    if new.status = 'sent' and d.stage in ('lead', 'quoted') then update crm_deals set stage = 'contract_sent' where id = d.id; end if;
    if new.status = 'signed' and d.stage in ('lead', 'quoted', 'contract_sent') then update crm_deals set stage = 'signed' where id = d.id; end if;
  end if;
  return new;
end $$;

drop trigger if exists crm_clients_touch on public.crm_clients;
create trigger crm_clients_touch before update on public.crm_clients for each row execute function private.crm_touch();
drop trigger if exists crm_contacts_touch on public.crm_contacts;
create trigger crm_contacts_touch before update on public.crm_contacts for each row execute function private.crm_touch();
drop trigger if exists crm_deals_touch on public.crm_deals;
create trigger crm_deals_touch before update on public.crm_deals for each row execute function private.crm_touch();
drop trigger if exists crm_quotes_touch on public.crm_quotes;
create trigger crm_quotes_touch before update on public.crm_quotes for each row execute function private.crm_touch();
drop trigger if exists crm_contracts_touch on public.crm_contracts;
create trigger crm_contracts_touch before update on public.crm_contracts for each row execute function private.crm_touch();

drop trigger if exists crm_deals_log on public.crm_deals;
create trigger crm_deals_log before insert or update on public.crm_deals for each row execute function private.crm_deal_tg();
drop trigger if exists crm_quotes_number on public.crm_quotes;
create trigger crm_quotes_number before insert on public.crm_quotes for each row execute function private.crm_number_tg();
drop trigger if exists crm_quotes_log on public.crm_quotes;
create trigger crm_quotes_log after insert or update on public.crm_quotes for each row execute function private.crm_quote_tg();
drop trigger if exists crm_contracts_number on public.crm_contracts;
create trigger crm_contracts_number before insert on public.crm_contracts for each row execute function private.crm_number_tg();
drop trigger if exists crm_contracts_guard on public.crm_contracts;
create trigger crm_contracts_guard before insert or update on public.crm_contracts for each row execute function private.crm_contract_tg();

-- ---------- Row level security: organization admins only
alter table public.crm_clients enable row level security;
alter table public.crm_contacts enable row level security;
alter table public.crm_deals enable row level security;
alter table public.crm_quotes enable row level security;
alter table public.crm_contracts enable row level security;
alter table public.crm_settings enable row level security;
alter table public.crm_activity enable row level security;

do $$
declare t text;
begin
  foreach t in array array['crm_clients', 'crm_contacts', 'crm_deals', 'crm_quotes', 'crm_contracts', 'crm_settings'] loop
    execute format('drop policy if exists "Admins manage %1$s" on public.%1$I', t);
    execute format('create policy "Admins manage %1$s" on public.%1$I for all to authenticated
      using (org_id = public.my_org_id() and public.is_org_admin())
      with check (org_id = public.my_org_id() and public.is_org_admin())', t);
  end loop;
end $$;
drop policy if exists "Admins read crm_activity" on public.crm_activity;
create policy "Admins read crm_activity" on public.crm_activity for select to authenticated
  using (org_id = public.my_org_id() and public.is_org_admin());

grant select, insert, update, delete on public.crm_clients, public.crm_contacts, public.crm_deals,
  public.crm_quotes, public.crm_contracts, public.crm_settings to authenticated;
grant select on public.crm_activity to authenticated;

revoke all on public.crm_clients, public.crm_contacts, public.crm_deals, public.crm_quotes, public.crm_contracts,
  public.crm_settings, public.crm_activity from anon;

-- Contract signing state is managed by the server; admins can't forge a signature from the browser.
revoke update on public.crm_contracts from authenticated;
grant update (title, body, coverage, hours_per_week, hourly_rate, start_date, end_date, payment_terms, status,
  void_reason, quote_id, app_origin, sent_to, sent_to_name) on public.crm_contracts to authenticated;

-- ---------- Intake: creates or reuses client, contacts and property, then opens a pipeline record
create or replace function public.crm_intake(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  org uuid := public.my_org_id();
  v_client uuid := nullif(p->>'client_id', '')::uuid;
  v_prop uuid := nullif(p->>'property_id', '')::uuid;
  v_deal uuid;
  reused_client boolean := false;
  reused_prop boolean := false;
  c jsonb;
  v_contact uuid;
  cname text := trim(coalesce(p->>'client_name', ''));
  addr text := trim(coalesce(p->>'property_address', ''));
  pname text := trim(coalesce(p->>'property_name', ''));
  norm_addr text;
  site jsonb := coalesce(p->'site_contact', '{}'::jsonb);
begin
  if org is null or not public.is_org_admin() then
    raise exception 'Only organization admins can add intakes.' using errcode = '42501';
  end if;

  -- Client: explicit pick, else same name in this org, else new
  if v_client is not null then
    if not exists (select 1 from crm_clients where id = v_client and org_id = org) then raise exception 'Client not found.'; end if;
    reused_client := true;
  else
    if cname = '' then raise exception 'Enter the client name.'; end if;
    select id into v_client from crm_clients
      where org_id = org and archived_at is null
        and lower(regexp_replace(trim(name), '\s+', ' ', 'g')) = lower(regexp_replace(cname, '\s+', ' ', 'g'));
    if v_client is not null then
      reused_client := true;
    else
      insert into crm_clients (org_id, name) values (org, regexp_replace(cname, '\s+', ' ', 'g')) returning id into v_client;
    end if;
  end if;
  -- Fill billing details that are still blank (never overwrite what's on file)
  update crm_clients set
    billing_name = case when billing_name = '' then coalesce(p->>'billing_name', '') else billing_name end,
    billing_email = case when billing_email = '' then lower(coalesce(p->>'billing_email', '')) else billing_email end,
    billing_phone = case when billing_phone = '' then coalesce(p->>'billing_phone', '') else billing_phone end,
    billing_address = case when billing_address = '' then coalesce(p->>'billing_address', '') else billing_address end
  where id = v_client;

  -- Contacts: match on email, then phone digits, then name
  for c in select * from jsonb_array_elements(coalesce(p->'contacts', '[]'::jsonb)) loop
    continue when trim(coalesce(c->>'name', '')) = '';
    select id into v_contact from crm_contacts where client_id = v_client and (
      (coalesce(c->>'email', '') <> '' and lower(email) = lower(trim(c->>'email')))
      or (length(regexp_replace(coalesce(c->>'phone', ''), '\D', '', 'g')) >= 7
          and regexp_replace(phone, '\D', '', 'g') = regexp_replace(c->>'phone', '\D', '', 'g'))
      or lower(regexp_replace(trim(name), '\s+', ' ', 'g')) = lower(regexp_replace(trim(c->>'name'), '\s+', ' ', 'g')))
      limit 1;
    if v_contact is null then
      insert into crm_contacts (org_id, client_id, name, email, phone, role, receives_updates)
      values (org, v_client, trim(c->>'name'), lower(trim(coalesce(c->>'email', ''))), trim(coalesce(c->>'phone', '')),
        coalesce(nullif(c->>'role', ''), 'other'), coalesce((c->>'receives_updates')::boolean, false));
    else
      update crm_contacts set
        email = case when email = '' then lower(trim(coalesce(c->>'email', ''))) else email end,
        phone = case when phone = '' then trim(coalesce(c->>'phone', '')) else phone end,
        receives_updates = receives_updates or coalesce((c->>'receives_updates')::boolean, false)
      where id = v_contact;
    end if;
    v_contact := null;
  end loop;

  -- Property: explicit pick, else same address (or same name) in this org, else new
  if v_prop is not null then
    if not exists (select 1 from properties where id = v_prop and org_id = org) then raise exception 'Property not found.'; end if;
    reused_prop := true;
  else
    if pname = '' and addr = '' then raise exception 'Enter the property name or address.'; end if;
    norm_addr := lower(regexp_replace(regexp_replace(addr, '[^a-zA-Z0-9 ]', ' ', 'g'), '\s+', ' ', 'g'));
    select id into v_prop from properties where org_id = org and (
      (length(trim(norm_addr)) > 5 and trim(lower(regexp_replace(regexp_replace(address, '[^a-zA-Z0-9 ]', ' ', 'g'), '\s+', ' ', 'g'))) = trim(norm_addr))
      or (pname <> '' and lower(trim(name)) = lower(pname)))
      limit 1;
    if v_prop is not null then
      reused_prop := true;
    else
      insert into properties (org_id, name, address, contact_name, contact_phone, contact_email, patrol_interval_minutes, created_by)
      values (org, coalesce(nullif(pname, ''), addr), coalesce(nullif(addr, ''), pname),
        coalesce(site->>'name', ''), coalesce(site->>'phone', ''), lower(coalesce(site->>'email', '')),
        coalesce(nullif(p->>'patrol_interval_minutes', '')::int, 60), auth.uid())
      returning id into v_prop;
    end if;
  end if;
  update properties set
    client_id = coalesce(client_id, v_client),
    access_instructions = case when access_instructions = '' then coalesce(p->>'access_instructions', '') else access_instructions end,
    fire_marshal_name = case when fire_marshal_name = '' then coalesce(p->>'fire_marshal_name', '') else fire_marshal_name end,
    fire_marshal_phone = case when fire_marshal_phone = '' then coalesce(p->>'fire_marshal_phone', '') else fire_marshal_phone end,
    fire_marshal_email = case when fire_marshal_email = '' then lower(coalesce(p->>'fire_marshal_email', '')) else fire_marshal_email end,
    contact_name = case when contact_name = '' then coalesce(site->>'name', '') else contact_name end,
    contact_phone = case when contact_phone = '' then coalesce(site->>'phone', '') else contact_phone end,
    contact_email = case when contact_email = '' then lower(coalesce(site->>'email', '')) else contact_email end
  where id = v_prop;

  insert into crm_deals (org_id, client_id, property_id, reason, coverage, hours_per_week, patrol_interval_minutes,
    requested_start_date, requested_start_time, end_date, est_rate, source, notes)
  values (org, v_client, v_prop, coalesce(p->>'reason', ''), coalesce(nullif(p->>'coverage', ''), '24_7'),
    nullif(p->>'hours_per_week', '')::numeric, nullif(p->>'patrol_interval_minutes', '')::int,
    nullif(p->>'requested_start_date', '')::date, nullif(p->>'requested_start_time', '')::time, nullif(p->>'end_date', '')::date,
    nullif(p->>'est_rate', '')::numeric, coalesce(p->>'source', ''), coalesce(p->>'notes', ''))
  returning id into v_deal;

  if reused_client then perform private.crm_log(org, v_deal, v_client, 'note', 'Used existing client record'); end if;
  if reused_prop then perform private.crm_log(org, v_deal, v_client, 'note', 'Used existing property record'); end if;

  return jsonb_build_object('deal_id', v_deal, 'client_id', v_client, 'property_id', v_prop,
    'reused_client', reused_client, 'reused_property', reused_prop);
end $$;
revoke all on function public.crm_intake(jsonb) from public, anon;
grant execute on function public.crm_intake(jsonb) to authenticated;

-- Manual acceptance of a quote (phone call, signed paper, email reply…)
create or replace function public.crm_quote_accept(p_quote uuid, p_by text, p_note text, p_source text default 'manual')
returns void language plpgsql security definer set search_path = public as $$
declare q crm_quotes;
begin
  select * into q from crm_quotes where id = p_quote and org_id = public.my_org_id();
  if q.id is null or not public.is_org_admin() then raise exception 'Quote not found.' using errcode = '42501'; end if;
  if q.status = 'accepted' then return; end if;
  update crm_quotes set status = 'accepted', accepted_at = now(), accepted_by = left(trim(coalesce(p_by, '')), 200),
    accept_note = left(coalesce(p_note, ''), 2000), accept_source = left(coalesce(nullif(p_source, ''), 'manual'), 40)
  where id = q.id;
  -- Any other open quotes on the same request are superseded.
  update crm_quotes set status = 'declined' where deal_id = q.deal_id and id <> q.id and status in ('draft', 'sent');
  update crm_deals set stage = 'quoted' where id = q.deal_id and stage = 'lead';
end $$;
revoke all on function public.crm_quote_accept(uuid, text, text, text) from public, anon;
grant execute on function public.crm_quote_accept(uuid, text, text, text) to authenticated;

-- Private bucket for signed agreements: <org_id>/contracts/<contract_id>/signed-agreement.pdf
insert into storage.buckets (id, name, public) values ('crm-documents', 'crm-documents', false)
  on conflict (id) do nothing;
drop policy if exists "Admins read crm documents" on storage.objects;
create policy "Admins read crm documents" on storage.objects for select to authenticated
  using (bucket_id = 'crm-documents' and (storage.foldername(name))[1] = public.my_org_id()::text and public.is_org_admin());
