import { useMutation, useQuery } from "@tanstack/react-query";
import { addDays, endOfMonth, format, parseISO, startOfMonth } from "date-fns";
import { AlertTriangle, Info, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { AreaField, CheckField, FormDialog, SelectField, TextField } from "@/components/workforce/kit";
import * as api from "@/lib/expenses/api";
import { CURRENCIES, METHOD, METHODS_FOR, PAID_BY, type Expenditure, type PaidBy } from "@/lib/expenses/constants";
import { today } from "@/lib/expenses/derive";
import { centsToInput, fmtMoney, parseMoney, toCents } from "@/lib/expenses/money";
import { formatShiftRange } from "@/lib/schedule";
import { cn } from "@/lib/utils";
import { useExpenses } from "@/state/ExpensesProvider";

import { MoneyField } from "./kit";

type PersonChoice = "not_requested" | "not_applicable" | "submit" | "draft";
type RecoveryChoice = "not_applicable" | "not_requested" | "draft" | "submit";

interface Draft {
  spent_on: string;
  vendor: string;
  description: string;
  purpose: string;
  category_id: string;
  amount: string;
  currency: string;
  tax_amount: string;
  paid_by: string;
  payer_name: string;
  payer_worker_id: string;
  payment_method: string;
  account_label: string;
  property_id: string;
  client_name: string;
  agency_id: string;
  placement_id: string;
  agency_invoice_id: string;
  invoice_ref: string;
  notes: string;
  person: PersonChoice;
  personAmount: string;
  personType: string;
  recovery: RecoveryChoice;
  recoveryType: string;
  recoveryAmount: string;
  recoveryProperty: string;
  recoveryAgency: string;
  recoveryName: string;
  recoveryInvoiceRef: string;
  recoveryDue: string;
}

const initDraft = (e: Expenditure | null, preset?: Partial<Draft>): Draft => ({
  spent_on: e?.spent_on ?? today(),
  vendor: e?.vendor ?? "",
  description: e?.description ?? "",
  purpose: e?.purpose ?? "",
  category_id: e?.category_id ?? "",
  amount: e ? centsToInput(toCents(e.amount)) : "",
  currency: e?.currency ?? "USD",
  tax_amount: e?.tax_amount != null ? centsToInput(toCents(e.tax_amount)) : "",
  paid_by: e?.paid_by ?? "business",
  payer_name: e?.payer_name ?? "",
  payer_worker_id: e?.payer_worker_id ?? "",
  payment_method: e?.payment_method ?? "business_card",
  account_label: e?.account_label ?? "",
  property_id: e?.property_id ?? "",
  client_name: e?.property_id ? "" : (e?.property_name ?? ""),
  agency_id: e?.agency_id ?? "",
  placement_id: e?.placement_id ?? "",
  agency_invoice_id: e?.agency_invoice_id ?? "",
  invoice_ref: e?.invoice_ref ?? "",
  notes: e?.notes ?? "",
  person: (e?.person_reimb_flag as PersonChoice) ?? "not_requested",
  personAmount: "",
  personType: "",
  recovery: (e?.client_recovery_flag as RecoveryChoice) ?? "not_applicable",
  recoveryType: "client",
  recoveryAmount: "",
  recoveryProperty: "",
  recoveryAgency: "",
  recoveryName: "",
  recoveryInvoiceRef: "",
  recoveryDue: "",
  ...preset,
});

const isPersonal = (paidBy: string) => paidBy !== "business";

/** Shift picker for payroll expenditures — links existing schedule shifts instead of duplicating them. */
const ShiftPicker = ({ expenditureId, anchor, selected, onChange, agency = false }: { expenditureId: string | null; anchor: string; selected: string[]; onChange: (ids: string[]) => void; agency?: boolean }) => {
  const ex = useExpenses();
  const base = /^\d{4}-\d{2}-\d{2}$/.test(anchor) ? parseISO(anchor) : new Date();
  const [from, setFrom] = useState<string>(format(startOfMonth(addDays(base, -14)), "yyyy-MM-dd"));
  const [to, setTo] = useState<string>(format(endOfMonth(base), "yyyy-MM-dd"));
  const q = useQuery({ queryKey: ["ex", "shifts", from, to], enabled: !!from && !!to && from <= to, queryFn: () => api.loadShifts(from, to) });
  const taken = useMemo(() => {
    const m = new Map<string, string>();
    const active = new Set(ex.data.expenditures.filter((e) => !e.archived_at && e.id !== expenditureId).map((e) => e.id));
    for (const l of ex.data.shiftLinks) {
      if (active.has(l.expenditure_id)) m.set(l.shift_id, ex.index.rowById.get(l.expenditure_id)?.e.code ?? "another record");
    }
    return m;
  }, [ex.data, ex.index, expenditureId]);
  const sel = new Set(selected);
  const toggle = (id: string) => onChange(sel.has(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const rows = q.data ?? [];
  const selectable = rows.filter((r) => !taken.has(r.id));
  return (
    <div className="rounded-lg border border-line bg-raised p-3.5">
      <div className="text-sm font-medium text-ink">Link schedule shifts (optional)</div>
      <p className="mt-0.5 text-xs text-ink-3">
        {agency
          ? "Tick the agency workers' shifts this invoice covers. Profit then uses this invoice amount for those shifts instead of the hourly agency rate, so labor isn't counted twice. A shift can belong to only one labor expenditure."
          : "Links the payroll expense to existing shifts so wages aren't recorded twice. A shift can belong to only one labor expenditure. Wages are never treated as reimbursements."}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <TextField label="From" type="date" value={from} onChange={setFrom} />
        <TextField label="To" type="date" value={to} onChange={setTo} />
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-ink-2">
        <span>{selected.length} selected</span>
        {selectable.length > 0 && (
          <button type="button" className="text-link hover:underline" onClick={() => onChange(Array.from(new Set([...selected, ...selectable.map((r) => r.id)])))}>
            Select all shown
          </button>
        )}
      </div>
      <div className="mt-2 max-h-56 space-y-1.5 overflow-y-auto pr-1">
        {q.isLoading ? (
          <div className="py-4 text-center text-sm text-ink-2">
            <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
            Loading shifts…
          </div>
        ) : rows.length === 0 ? (
          <div className="py-4 text-center text-sm text-ink-3">No shifts in this range.</div>
        ) : (
          rows.map((r) => {
            const t = taken.get(r.id);
            return (
              <label key={r.id} className={cn("flex items-center gap-3 rounded-md border border-line bg-surface px-3 py-2 text-sm", t && "opacity-50")}>
                <input type="checkbox" className="h-4 w-4 accent-primary" checked={sel.has(r.id)} disabled={!!t} onChange={() => toggle(r.id)} />
                <span className="min-w-0 flex-1 truncate text-ink">
                  {r.staffName} · <span className="font-mono text-xs">{format(parseISO(r.date), "EEE MMM d")} {formatShiftRange({ start: r.start, end: r.end })}</span>
                </span>
                <span className="truncate text-xs text-ink-3">{ex.propertyName(r.propertyId)}</span>
                {t ? <span className="text-xs text-ink-3">in {t}</span> : r.paid ? <span className="text-xs text-status-clear">Paid</span> : null}
              </label>
            );
          })
        )}
      </div>
    </div>
  );
};

/** Add / edit an expenditure. New records can open reimbursement and recovery obligations in the same step. */
export const ExpenditureForm = ({
  open,
  onOpenChange,
  expenditure,
  preset,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  expenditure: Expenditure | null;
  preset?: Partial<Draft>;
}) => {
  const ex = useExpenses();
  const navigate = useNavigate();
  const isNew = !expenditure;
  const init = useMemo(() => initDraft(expenditure, preset), [expenditure, preset]);
  const initShifts = useMemo(
    () => (expenditure ? ex.data.shiftLinks.filter((l) => l.expenditure_id === expenditure.id).map((l) => l.shift_id) : []),
    [expenditure, ex.data.shiftLinks],
  );
  const [d, setD] = useState<Draft>(init);
  const [shiftIds, setShiftIds] = useState<string[]>(initShifts);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dupes, setDupes] = useState<Awaited<ReturnType<typeof api.possibleDuplicates>>>([]);
  const [dupConfirm, setDupConfirm] = useState<boolean>(false);
  const [dupNote, setDupNote] = useState<string>("");

  useEffect(() => {
    if (open) {
      setD(init);
      setShiftIds(initShifts);
      setErrors({});
      setDupes([]);
      setDupConfirm(false);
      setDupNote("");
    }
  }, [open, init, initShifts]);

  const set =
    <K extends keyof Draft>(k: K) =>
    (v: Draft[K]) =>
      setD((p) => ({ ...p, [k]: v }));

  const dirty = JSON.stringify(d) !== JSON.stringify(init) || JSON.stringify(shiftIds) !== JSON.stringify(initShifts);
  const category = ex.index.categoryById.get(d.category_id);
  const personal = isPersonal(d.paid_by);
  const methods = METHODS_FOR[personal ? "personal" : "business"];
  const hasPersonReq = !!expenditure && !!ex.index.rowById.get(expenditure.id)?.person.view;
  const hasRecoveryReq = !!expenditure && !!ex.index.rowById.get(expenditure.id)?.recovery.view;

  const setPaidBy = (v: string) =>
    setD((p) => {
      const nextPersonal = isPersonal(v);
      const method = METHODS_FOR[nextPersonal ? "personal" : "business"].includes(p.payment_method)
        ? p.payment_method
        : nextPersonal
          ? "personal_card"
          : "business_card";
      return {
        ...p,
        paid_by: v,
        payment_method: method,
        person: nextPersonal ? (p.person === "not_applicable" && !isPersonal(p.paid_by) ? "not_requested" : p.person) : "not_applicable",
        personType: v === "owner" ? "owner" : v === "employee" ? "employee" : "other",
        payer_worker_id: v === "owner" || v === "employee" ? p.payer_worker_id : "",
      };
    });

  const workerOptions = useMemo(
    () =>
      ex.lookups.workers
        .filter((w) => !w.archived && (d.paid_by === "owner" || w.source === "direct"))
        .map((w) => ({ value: w.id, label: `${w.name} · ${w.code}` })),
    [ex.lookups.workers, d.paid_by],
  );
  const linkedInvoiceIds = useMemo(
    () => new Set(ex.data.expenditures.filter((e) => !e.archived_at && e.agency_invoice_id && e.id !== expenditure?.id).map((e) => e.agency_invoice_id as string)),
    [ex.data.expenditures, expenditure],
  );
  const invoiceOptions = ex.lookups.invoices
    .filter((i) => (!d.agency_id || i.agencyId === d.agency_id) && (!linkedInvoiceIds.has(i.id) || i.id === d.agency_invoice_id) && (!i.archived || i.id === d.agency_invoice_id))
    .map((i) => ({
      value: i.id,
      label: `#${i.number} · ${ex.agencyById.get(i.agencyId)?.name ?? "Agency"} · ${fmtMoney(toCents(i.total))}${i.status === "paid" ? " · paid" : ""}`,
    }));
  const placementOptions = ex.lookups.placements
    .filter((p) => !d.agency_id || p.agencyId === d.agency_id)
    .map((p) => ({
      value: p.id,
      label: `${ex.workerById.get(p.workerId)?.name ?? "Worker"} · ${p.propertyId ? ex.propertyName(p.propertyId) : p.propertyName || "No property"} · from ${p.startDate}`,
    }));

  const pickInvoice = (id: string) => {
    const inv = ex.invoiceById.get(id);
    setD((p) => {
      if (!inv) return { ...p, agency_invoice_id: "" };
      const agency = ex.agencyById.get(inv.agencyId);
      return {
        ...p,
        agency_invoice_id: id,
        agency_id: inv.agencyId,
        vendor: p.vendor || agency?.name || "",
        description: p.description || `Agency staffing invoice #${inv.number}`,
        amount: p.amount || centsToInput(toCents(inv.total)),
        invoice_ref: p.invoice_ref || inv.number,
        spent_on: isNew && inv.paidOn ? inv.paidOn : isNew && inv.invoiceDate ? inv.invoiceDate : p.spent_on,
      };
    });
  };

  const validate = (): Record<string, string> => {
    const e: Record<string, string> = {};
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.spent_on)) e.spent_on = "Enter the purchase or service date.";
    else if (d.spent_on > format(addDays(new Date(), 1), "yyyy-MM-dd")) e.spent_on = "Date can't be in the future.";
    if (!d.vendor.trim()) e.vendor = "Vendor/payee is required.";
    if (!d.description.trim()) e.description = "Description is required.";
    if (!d.category_id) e.category_id = "Choose a category.";
    const amt = parseMoney(d.amount);
    if (amt === null || amt <= 0) e.amount = "Enter an amount greater than 0 with at most 2 decimals.";
    if (d.tax_amount.trim()) {
      const tax = parseMoney(d.tax_amount);
      if (tax === null) e.tax_amount = "Enter a valid amount.";
      else if (amt !== null && tax > amt) e.tax_amount = "Tax is included in the total, so it can't be larger.";
    }
    if (personal && !d.payer_name.trim() && !d.payer_worker_id) e.payer_name = "Enter who paid.";
    if (d.account_label.replace(/\D/g, "").length > 4) e.account_label = "Store the last four digits only — never full card or bank numbers.";
    if (isNew && personal && (d.person === "submit" || d.person === "draft")) {
      const r = d.personAmount.trim() ? parseMoney(d.personAmount) : amt;
      if (r === null || r <= 0) e.personAmount = "Enter a valid amount.";
      else if (amt !== null && r > amt) e.personAmount = "Can't exceed the expense total.";
    }
    if (isNew && (d.recovery === "submit" || d.recovery === "draft")) {
      const r = d.recoveryAmount.trim() ? parseMoney(d.recoveryAmount) : amt;
      if (r === null || r <= 0) e.recoveryAmount = "Enter a valid amount.";
      else if (amt !== null && r > amt) e.recoveryAmount = "Can't exceed the expense total.";
      if (d.recoveryType === "agency" && !d.recoveryAgency && !d.agency_id) e.recoveryAgency = "Choose the agency.";
      if (d.recoveryType === "client" && !d.recoveryProperty && !d.property_id && !d.recoveryName.trim() && !d.client_name.trim()) {
        e.recoveryName = "Choose the property or enter the client name.";
      }
      if (d.recoveryType === "other" && !d.recoveryName.trim()) e.recoveryName = "Enter who is expected to pay.";
    }
    return e;
  };

  const save = useMutation({
    mutationFn: async () => {
      const amtCents = parseMoney(d.amount) ?? 0;
      const amountStr = centsToInput(amtCents);
      const ref = d.invoice_ref.trim();
      const reviewed = expenditure?.duplicate_reviewed_at && expenditure.vendor === d.vendor.trim() && expenditure.spent_on === d.spent_on && toCents(expenditure.amount) === amtCents && expenditure.invoice_ref === ref;
      if (!dupConfirm && !reviewed) {
        const found = await api.possibleDuplicates(d.vendor.trim(), d.spent_on, amountStr, ref, expenditure?.id ?? null);
        if (found.length > 0) {
          setDupes(found);
          return null;
        }
      }
      const tax = d.tax_amount.trim() ? parseMoney(d.tax_amount) : null;
      const res = await api.saveExpenditure(expenditure?.id ?? null, {
        spent_on: d.spent_on,
        vendor: d.vendor,
        description: d.description,
        purpose: d.purpose,
        category_id: d.category_id,
        amount: amountStr,
        currency: d.currency,
        tax_amount: tax === null ? "" : centsToInput(tax),
        paid_by: d.paid_by,
        payer_name: d.payer_name,
        payer_worker_id: d.payer_worker_id,
        payment_method: d.payment_method,
        account_label: d.account_label,
        property_id: d.property_id,
        client_name: d.client_name,
        agency_id: d.agency_id,
        placement_id: d.placement_id,
        agency_invoice_id: d.agency_invoice_id,
        invoice_ref: ref,
        notes: d.notes,
        person_reimb_flag: personal ? (d.person === "not_applicable" ? "not_applicable" : "not_requested") : "not_applicable",
        client_recovery_flag: d.recovery === "not_requested" ? "not_requested" : "not_applicable",
        shift_ids: category?.kind === "payroll" || category?.kind === "agency" ? shiftIds : [],
        confirm_duplicate: dupConfirm,
        duplicate_note: dupNote,
      });
      const warnings: string[] = [];
      if (isNew && personal && (d.person === "submit" || d.person === "draft")) {
        const r = d.personAmount.trim() ? (parseMoney(d.personAmount) ?? amtCents) : amtCents;
        try {
          await api.saveReimbursement(null, {
            expenditure_id: res.id,
            direction: "to_person",
            party_type: d.paid_by === "owner" ? "owner" : d.paid_by === "employee" ? "employee" : "other",
            party_name: d.payer_name,
            party_worker_id: d.payer_worker_id,
            party_agency_id: "",
            party_property_id: "",
            agency_invoice_id: "",
            requested_amount: centsToInput(r),
            requested_on: today(),
            due_on: "",
            invoice_ref: "",
            notes: "",
            submit: d.person === "submit",
          });
        } catch (err) {
          warnings.push(`Reimbursement request wasn't created: ${err instanceof Error ? err.message : "unknown error"}`);
        }
      }
      if (isNew && (d.recovery === "submit" || d.recovery === "draft")) {
        const r = d.recoveryAmount.trim() ? (parseMoney(d.recoveryAmount) ?? amtCents) : amtCents;
        const propId = d.recoveryProperty || d.property_id;
        const agencyId = d.recoveryAgency || d.agency_id;
        try {
          await api.saveReimbursement(null, {
            expenditure_id: res.id,
            direction: "from_client",
            party_type: d.recoveryType,
            party_name:
              d.recoveryName.trim() ||
              (d.recoveryType === "client" ? (propId ? ex.propertyName(propId) : d.client_name) : d.recoveryType === "agency" ? (ex.agencyById.get(agencyId)?.name ?? "") : ""),
            party_worker_id: "",
            party_agency_id: d.recoveryType === "agency" ? agencyId : "",
            party_property_id: d.recoveryType === "client" ? propId : "",
            agency_invoice_id: "",
            requested_amount: centsToInput(r),
            requested_on: today(),
            due_on: d.recoveryDue,
            invoice_ref: d.recoveryInvoiceRef,
            notes: "",
            submit: d.recovery === "submit",
          });
        } catch (err) {
          warnings.push(`Client/agency recovery wasn't created: ${err instanceof Error ? err.message : "unknown error"}`);
        }
      }
      return { ...res, warnings };
    },
    onSuccess: (res) => {
      if (!res) return;
      ex.invalidate();
      toast.success(isNew ? `${res.code} recorded` : `${res.code} saved`);
      for (const w of res.warnings) toast.error(w);
      onOpenChange(false);
      if (isNew) navigate(`/expenditures/records/${res.id}`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save."),
  });

  const submit = () => {
    const e = validate();
    setErrors(e);
    if (Object.keys(e).length > 0) {
      toast.error("Check the highlighted fields.");
      return;
    }
    if (dupes.length > 0 && !dupConfirm) {
      toast.error("Review the possible duplicate first.");
      return;
    }
    save.mutate();
  };

  const categoryOptions = ex.categories
    .filter((c) => c.active || c.id === d.category_id)
    .map((c) => ({ value: c.id, label: c.active ? c.name : `${c.name} (inactive)` }));
  const propertyOptions = ex.properties.map((p) => ({ value: p.id, label: p.name }));
  const agencyOptions = ex.lookups.agencies.filter((a) => !a.archived || a.id === d.agency_id).map((a) => ({ value: a.id, label: a.name }));

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isNew ? "Add expenditure" : `Edit ${expenditure?.code}`}
      description="Records spending only — nothing here sends money or moves funds."
      dirty={dirty}
      saving={save.isPending}
      onSubmit={submit}
      submitLabel={dupes.length > 0 && dupConfirm ? "Save anyway" : isNew ? "Record expenditure" : "Save changes"}
      wide
    >
      <fieldset className="grid gap-4">
        <legend className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-link">Purchase</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <TextField label="Purchase / service date" type="date" required value={d.spent_on} onChange={set("spent_on")} error={errors.spent_on} />
          <TextField label="Vendor / payee" required value={d.vendor} onChange={set("vendor")} error={errors.vendor} className="sm:col-span-2" maxLength={200} />
        </div>
        <TextField label="Description" required value={d.description} onChange={set("description")} error={errors.description} maxLength={500} placeholder="What was bought or paid for" />
        <AreaField label="Business purpose" rows={2} value={d.purpose} onChange={set("purpose")} placeholder="Why the business needed it (optional)" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SelectField label="Category" required value={d.category_id} onChange={set("category_id")} options={categoryOptions} error={errors.category_id} hint="Categories organize records only — they aren't tax classifications." />
          <TextField label="Receipt / invoice number" value={d.invoice_ref} onChange={set("invoice_ref")} maxLength={120} />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <MoneyField label="Total amount" required value={d.amount} onChange={set("amount")} currency={d.currency} error={errors.amount} />
          <MoneyField label="Tax included in total" value={d.tax_amount} onChange={set("tax_amount")} currency={d.currency} error={errors.tax_amount} hint="Optional" />
          <SelectField label="Currency" value={d.currency} onChange={set("currency")} options={CURRENCIES.map((c) => ({ value: c, label: c }))} disabled={hasPersonReq || hasRecoveryReq} />
        </div>
      </fieldset>

      <fieldset className="grid gap-4 border-t border-line pt-4">
        <legend className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-link">Who paid</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SelectField label="Paid by" required value={d.paid_by} onChange={setPaidBy} options={(Object.keys(PAID_BY) as PaidBy[]).map((k) => ({ value: k, label: PAID_BY[k] }))} disabled={hasPersonReq && d.paid_by !== "business"} hint={hasPersonReq ? "Locked while a reimbursement request is open." : undefined} />
          <SelectField label="Payment method" required value={d.payment_method} onChange={set("payment_method")} options={methods.map((m) => ({ value: m, label: METHOD[m] }))} />
        </div>
        {personal && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField label="Payer name" required value={d.payer_name} onChange={set("payer_name")} error={errors.payer_name} maxLength={200} placeholder={d.paid_by === "owner" ? "Owner's name" : "Full name"} />
            {(d.paid_by === "owner" || d.paid_by === "employee") && (
              <SelectField
                label="Workforce profile"
                value={d.payer_worker_id}
                onChange={(v) => setD((p) => ({ ...p, payer_worker_id: v, payer_name: p.payer_name || (ex.workerById.get(v)?.name ?? "") }))}
                options={workerOptions}
                allowNone
                noneLabel="Not linked"
                hint={d.paid_by === "owner" ? "Optional — owners don't need an employee profile." : "Optional — links to the employee's Workforce record."}
              />
            )}
          </div>
        )}
        <TextField label="Account label or last four digits" value={d.account_label} onChange={set("account_label")} error={errors.account_label} maxLength={40} placeholder="e.g. Amex Business ••1234" hint="Never enter full card or bank account numbers." />
      </fieldset>

      <fieldset className="grid gap-4 border-t border-line pt-4">
        <legend className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-link">Related to (optional)</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SelectField label="Property / client" value={d.property_id} onChange={set("property_id")} options={propertyOptions} allowNone noneLabel="None / other client" />
          {!d.property_id && <TextField label="Other client name" value={d.client_name} onChange={set("client_name")} maxLength={200} />}
          <SelectField
            label="Agency"
            value={d.agency_id}
            onChange={(v) => setD((p) => ({ ...p, agency_id: v, placement_id: "", agency_invoice_id: v && ex.invoiceById.get(p.agency_invoice_id)?.agencyId !== v ? "" : p.agency_invoice_id }))}
            options={agencyOptions}
            allowNone
          />
          {placementOptions.length > 0 && (
            <SelectField label="Assignment / placement" value={d.placement_id} onChange={set("placement_id")} options={placementOptions} allowNone />
          )}
        </div>
        {(category?.kind === "agency" || d.agency_invoice_id) && (
          <div className="rounded-lg border border-line bg-raised p-3.5">
            <SelectField
              label="Link existing agency invoice"
              value={d.agency_invoice_id}
              onChange={pickInvoice}
              options={invoiceOptions}
              allowNone
              noneLabel="Not linked"
              hint="One agency invoice = one spending record. Already-linked invoices are hidden, so the cost is never counted twice. Marking an invoice paid in Workforce doesn't create spending automatically — link it here."
            />
          </div>
        )}
        {(category?.kind === "payroll" || category?.kind === "agency") && (
          <ShiftPicker expenditureId={expenditure?.id ?? null} anchor={d.spent_on} selected={shiftIds} onChange={setShiftIds} agency={category.kind === "agency"} />
        )}
      </fieldset>

      {isNew ? (
        <fieldset className="grid gap-4 border-t border-line pt-4">
          <legend className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-link">Reimbursements</legend>
          {personal ? (
            <div className="rounded-lg border border-line bg-raised p-3.5">
              <SelectField
                label={`Reimburse ${d.payer_name.trim() || "the payer"}?`}
                value={d.person}
                onChange={(v) => set("person")(v as PersonChoice)}
                options={[
                  { value: "not_requested", label: "Not requested yet" },
                  { value: "submit", label: "Create request — send for review" },
                  { value: "draft", label: "Create request — save as draft" },
                  { value: "not_applicable", label: "Not applicable (won't be reimbursed)" },
                ]}
                hint="A request is never approved automatically. It only counts as paid once you record a payment."
              />
              {(d.person === "submit" || d.person === "draft") && (
                <MoneyField className="mt-3" label="Requested amount" value={d.personAmount} onChange={set("personAmount")} currency={d.currency} error={errors.personAmount} hint="Defaults to the full total." />
              )}
            </div>
          ) : (
            <p className="flex items-start gap-2 text-xs text-ink-3">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Paid by the business — personal reimbursement is not applicable.
            </p>
          )}
          <div className="rounded-lg border border-line bg-raised p-3.5">
            <SelectField
              label="Recover this cost from a client or agency?"
              value={d.recovery}
              onChange={(v) => set("recovery")(v as RecoveryChoice)}
              options={[
                { value: "not_applicable", label: "Not applicable" },
                { value: "not_requested", label: "Recoverable — not requested yet" },
                { value: "draft", label: "Record expected recovery (draft)" },
                { value: "submit", label: "Record expected recovery — send for review" },
              ]}
              hint="Tracked separately from reimbursing a person. No invoice is created or changed."
            />
            {(d.recovery === "draft" || d.recovery === "submit") && (
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <SelectField label="Expected from" value={d.recoveryType} onChange={set("recoveryType")} options={[{ value: "client", label: "Client / property" }, { value: "agency", label: "Agency" }, { value: "other", label: "Other" }]} />
                <MoneyField label="Expected recovery" value={d.recoveryAmount} onChange={set("recoveryAmount")} currency={d.currency} error={errors.recoveryAmount} hint="Defaults to the full total." />
                {d.recoveryType === "client" && (
                  <SelectField label="Property / client" value={d.recoveryProperty || d.property_id} onChange={set("recoveryProperty")} options={propertyOptions} allowNone noneLabel="Other client" />
                )}
                {d.recoveryType === "agency" && (
                  <SelectField label="Agency" value={d.recoveryAgency || d.agency_id} onChange={set("recoveryAgency")} options={agencyOptions} error={errors.recoveryAgency} />
                )}
                {(d.recoveryType === "other" || (d.recoveryType === "client" && !d.recoveryProperty && !d.property_id)) && (
                  <TextField label="Name" value={d.recoveryName} onChange={set("recoveryName")} error={errors.recoveryName} />
                )}
                <TextField label="Client invoice reference" value={d.recoveryInvoiceRef} onChange={set("recoveryInvoiceRef")} maxLength={120} hint="Client invoices aren't stored in the app — enter the number for reference." />
                <TextField label="Due date" type="date" value={d.recoveryDue} onChange={set("recoveryDue")} />
              </div>
            )}
          </div>
        </fieldset>
      ) : (
        (!hasPersonReq || !hasRecoveryReq) && (
          <fieldset className="grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
            <legend className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-link">Reimbursement tracking</legend>
            {!hasPersonReq && personal && (
              <SelectField label="Reimbursement to person" value={d.person === "not_applicable" ? "not_applicable" : "not_requested"} onChange={(v) => set("person")(v as PersonChoice)} options={[{ value: "not_requested", label: "Not requested" }, { value: "not_applicable", label: "Not applicable" }]} hint="Create a request from the record page." />
            )}
            {!hasRecoveryReq && (
              <SelectField label="Client/agency recovery" value={d.recovery === "not_requested" ? "not_requested" : "not_applicable"} onChange={(v) => set("recovery")(v as RecoveryChoice)} options={[{ value: "not_applicable", label: "Not applicable" }, { value: "not_requested", label: "Recoverable — not requested" }]} />
            )}
          </fieldset>
        )
      )}

      <AreaField label="Notes" rows={2} value={d.notes} onChange={set("notes")} />
      {isNew && <p className="-mt-2 text-xs text-ink-3">Upload receipts from the record page after saving. Expenses without receipts are allowed and flagged “Missing receipt”.</p>}

      {dupes.length > 0 && (
        <div className="rounded-lg border border-status-follow/50 bg-status-follow/10 p-3.5" role="alert">
          <div className="flex items-start gap-2 text-sm text-ink">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-follow" />
            <div>
              <div className="font-medium">Possible duplicate</div>
              <p className="text-ink-2">Same vendor with a matching amount within 3 days, or the same receipt/invoice number:</p>
              <ul className="mt-1.5 space-y-1">
                {dupes.map((x) => (
                  <li key={x.id}>
                    <Link to={`/expenditures/records/${x.id}`} target="_blank" className="font-mono text-xs text-link hover:underline">
                      {x.code}
                    </Link>{" "}
                    <span className="text-xs text-ink-2">
                      {x.vendor} · {x.spent_on} · {fmtMoney(toCents(x.amount), d.currency)}
                      {x.invoice_ref && ` · #${x.invoice_ref}`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="mt-3 grid gap-2">
            <CheckField label="This is a separate, legitimate expense" checked={dupConfirm} onChange={setDupConfirm} />
            {dupConfirm && <TextField label="Note (optional)" value={dupNote} onChange={setDupNote} placeholder="e.g. Two separate fuel fill-ups" />}
            <Button type="button" variant="ghost" size="sm" className="justify-self-start" onClick={() => onOpenChange(false)}>
              It's a duplicate — don't save
            </Button>
          </div>
        </div>
      )}
    </FormDialog>
  );
};
