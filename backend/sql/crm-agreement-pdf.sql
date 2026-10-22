-- Contracts can use the organization's own fillable PDF agreement instead of the text template.
-- Additive only. Reverse: drop the added columns and the "Admins upload crm templates" policy,
-- then re-run crm-pipeline-fix1.sql to restore the previous guard.

alter table public.crm_settings
  add column if not exists agreement_pdf_path text,
  add column if not exists agreement_pdf_name text not null default '',
  add column if not exists agreement_layout jsonb,
  add column if not exists agreement_uploaded_at timestamptz,
  add column if not exists countersign_name text not null default '';

alter table public.crm_contracts
  add column if not exists doc_kind text not null default 'text',
  add column if not exists template_path text,
  add column if not exists template_layout jsonb;

do $$ begin
  alter table public.crm_contracts add constraint crm_contracts_doc_kind_check check (doc_kind in ('text', 'pdf'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.crm_settings add constraint crm_settings_agreement_path_check
    check (agreement_pdf_path is null or agreement_pdf_path like org_id::text || '/templates/%.pdf');
exception when duplicate_object then null; end $$;

grant update (doc_kind, template_path, template_layout) on public.crm_contracts to authenticated;

create or replace function private.crm_contract_tg() returns trigger
language plpgsql security definer set search_path = public as $$
declare d crm_deals;
begin
  select * into d from crm_deals where id = new.deal_id;
  if d.org_id is distinct from new.org_id then raise exception 'Contract must belong to the same organization as its intake.'; end if;
  if new.doc_kind = 'pdf' and (new.template_path is null or new.template_path not like new.org_id::text || '/templates/%.pdf') then
    raise exception 'Choose your organization''s agreement PDF for this contract.';
  end if;
  if tg_op = 'INSERT' and (new.number is null or new.number = 0) then
    perform pg_advisory_xact_lock(hashtext('crm_contracts' || new.org_id::text));
    select coalesce(max(number), 1000) + 1 into new.number from crm_contracts where org_id = new.org_id;
  end if;
  if tg_op = 'UPDATE' and old.status = 'signed' then
    if new.status <> 'signed' or new.body is distinct from old.body or new.signer_name is distinct from old.signer_name
       or new.signer_email is distinct from old.signer_email or new.signed_at is distinct from old.signed_at
       or new.signature_image is distinct from old.signature_image or new.body_sha256 is distinct from old.body_sha256
       or new.signer_ip is distinct from old.signer_ip or new.hourly_rate is distinct from old.hourly_rate
       or new.doc_kind is distinct from old.doc_kind or new.template_path is distinct from old.template_path
       or new.template_layout is distinct from old.template_layout
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
  if tg_op = 'UPDATE' and old.status in ('sent', 'void') and (new.body is distinct from old.body
     or new.doc_kind is distinct from old.doc_kind or new.template_path is distinct from old.template_path
     or new.template_layout is distinct from old.template_layout) then
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

-- Admins upload agreement PDFs into their organization's templates folder (new file per version; never overwritten).
drop policy if exists "Admins upload crm templates" on storage.objects;
create policy "Admins upload crm templates" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'crm-documents'
    and (storage.foldername(name))[1] = public.my_org_id()::text
    and (storage.foldername(name))[2] = 'templates'
    and lower(storage.extension(name)) = 'pdf'
    and public.is_org_admin()
  );
