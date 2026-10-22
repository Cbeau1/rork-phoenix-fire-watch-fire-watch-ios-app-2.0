-- Fix: intake activity was logged before the intake row existed (FK failure),
-- and contract numbers were logged as C-0 because the guard ran before numbering.
create or replace function private.crm_deal_tg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.stage is distinct from old.stage then
    new.stage_changed_at := now();
    perform private.crm_log(new.org_id, new.id, new.client_id, 'stage',
      'Moved from ' || private.crm_stage_label(old.stage) || ' to ' || private.crm_stage_label(new.stage)
      || case when new.stage = 'lost' and new.lost_reason <> '' then ' — ' || new.lost_reason else '' end);
  end if;
  return new;
end $$;

create or replace function private.crm_deal_created_tg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform private.crm_log(new.org_id, new.id, new.client_id, 'created', 'Intake created');
  return null;
end $$;

drop trigger if exists crm_deals_log on public.crm_deals;
create trigger crm_deals_log before update on public.crm_deals for each row execute function private.crm_deal_tg();
drop trigger if exists crm_deals_created_log on public.crm_deals;
create trigger crm_deals_created_log after insert on public.crm_deals for each row execute function private.crm_deal_created_tg();

-- Contracts: number before the guard logs (triggers fire alphabetically; guard < number).
create or replace function private.crm_contract_tg() returns trigger
language plpgsql security definer set search_path = public as $$
declare d crm_deals;
begin
  select * into d from crm_deals where id = new.deal_id;
  if d.org_id is distinct from new.org_id then raise exception 'Contract must belong to the same organization as its intake.'; end if;
  if tg_op = 'INSERT' and (new.number is null or new.number = 0) then
    perform pg_advisory_xact_lock(hashtext('crm_contracts' || new.org_id::text));
    select coalesce(max(number), 1000) + 1 into new.number from crm_contracts where org_id = new.org_id;
  end if;
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
  if auth.uid() is not null and new.status is distinct from (case when tg_op = 'UPDATE' then old.status else 'draft' end) and new.status not in ('draft', 'void') then
    raise exception 'Contracts are sent and signed through the secure signing link.' using errcode = '42501';
  end if;
  if new.status = 'signed' and (new.signed_at is null or new.signer_name is null) then
    raise exception 'A contract can only be marked signed by the signer.' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.status in ('sent', 'void') and new.body is distinct from old.body then
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
