import { useMutation } from "@tanstack/react-query";
import { format, parseISO, subMonths } from "date-fns";
import { CalendarClock, History } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { AreaField, FormDialog, SelectField, TextField } from "@/components/workforce/kit";
import * as api from "@/lib/expenses/api";
import { CURRENCIES, METHOD, METHODS_FOR, PAID_BY, type PaidBy, type Recurring } from "@/lib/expenses/constants";
import { centsToInput, fmtMoney, parseMoney, toCents } from "@/lib/expenses/money";
import { nextOccurrence, occurrencesThrough, ordinal, todayKey } from "@/lib/expenses/recurring";
import { useExpenses } from "@/state/ExpensesProvider";

import { MoneyField } from "./kit";

interface Draft {
  vendor: string;
  description: string;
  category_id: string;
  amount: string;
  currency: string;
  paid_by: string;
  payer_name: string;
  payment_method: string;
  account_label: string;
  property_id: string;
  notes: string;
  day: string;
  start_on: string;
  end_on: string;
}

const defaultStart = (day: number): string => {
  const t = todayKey();
  const next = nextOccurrence({ day, start: t, end: null }, t);
  return next ?? t;
};

const blank = (r: Recurring | null): Draft => {
  const day = r?.day_of_month ?? 1;
  return {
    vendor: r?.vendor ?? "",
    description: r?.description ?? "",
    category_id: r?.category_id ?? "",
    amount: r ? centsToInput(toCents(r.amount)) : "",
    currency: r?.currency ?? "USD",
    paid_by: r?.paid_by ?? "business",
    payer_name: r?.payer_name ?? "",
    payment_method: r?.payment_method ?? "business_bank",
    account_label: r?.account_label ?? "",
    property_id: r?.property_id ?? "",
    notes: r?.notes ?? "",
    day: String(day),
    start_on: r?.start_on ?? defaultStart(day),
    end_on: r?.end_on ?? "",
  };
};

const fmt = (k: string, p = "MMM d, yyyy") => format(parseISO(k), p);

/** Create or edit a monthly recurring expense. Saving immediately adds any charges already due. */
export const RecurringForm = ({ open, onOpenChange, recurring }: { open: boolean; onOpenChange: (v: boolean) => void; recurring: Recurring | null }) => {
  const ex = useExpenses();
  const [d, setD] = useState<Draft>(() => blank(recurring));
  const [initial, setInitial] = useState<string>(() => JSON.stringify(blank(recurring)));
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  const [startTouched, setStartTouched] = useState<boolean>(false);

  useEffect(() => {
    if (!open) return;
    const b = blank(recurring);
    setD(b);
    setInitial(JSON.stringify(b));
    setErrors({});
    setStartTouched(!!recurring);
  }, [open, recurring]);

  const set = <K extends keyof Draft>(k: K) => (v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));
  const personal = d.paid_by !== "business";
  const methods = METHODS_FOR[personal ? "personal" : "business"];
  const day = Number(d.day) || 1;

  const setDay = (v: string) =>
    setD((p) => ({ ...p, day: v, start_on: startTouched ? p.start_on : defaultStart(Number(v) || 1) }));
  const setPaidBy = (v: string) =>
    setD((p) => {
      const nextPersonal = v !== "business";
      const list = METHODS_FOR[nextPersonal ? "personal" : "business"];
      return { ...p, paid_by: v, payment_method: list.includes(p.payment_method) ? p.payment_method : list[0] };
    });

  const today = todayKey();
  const validStart = /^\d{4}-\d{2}-\d{2}$/.test(d.start_on);
  const sched = { day, start: d.start_on, end: d.end_on || null, skipBefore: recurring?.skip_before ?? null };
  const existing = useMemo(
    () => new Set(recurring ? ex.data.expenditures.filter((e) => e.recurring_id === recurring.id && e.recurring_period).map((e) => (e.recurring_period ?? "").slice(0, 7)) : []),
    [ex.data.expenditures, recurring],
  );
  const backfill = validStart ? occurrencesThrough(sched, today).filter((k) => !existing.has(k.slice(0, 7))) : [];
  const next = validStart ? nextOccurrence(sched, today) : null;
  const amountCents = parseMoney(d.amount);

  const categoryOptions = ex.categories.filter((c) => c.active || c.id === d.category_id).map((c) => ({ value: c.id, label: c.name }));
  const propertyOptions = ex.properties.map((p) => ({ value: p.id, label: p.name }));
  const dayOptions = Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: i >= 28 ? `${ordinal(i + 1)} (last day in shorter months)` : ordinal(i + 1) }));

  const validate = (): boolean => {
    const e: Partial<Record<keyof Draft, string>> = {};
    if (!d.vendor.trim()) e.vendor = "Vendor/payee is required.";
    if (!d.description.trim()) e.description = "Describe what this charge is for.";
    if (!d.category_id) e.category_id = "Choose a category.";
    if (amountCents === null || amountCents <= 0) e.amount = "Enter an amount greater than 0 with at most 2 decimals.";
    if (personal && !d.payer_name.trim()) e.payer_name = "Enter the name of the person who pays.";
    if (d.account_label.replace(/\D/g, "").length > 4) e.account_label = "Store the last four digits only — never full card or bank numbers.";
    if (!validStart) e.start_on = "Choose the first charge date.";
    else if (d.start_on < format(subMonths(new Date(), 24), "yyyy-MM-dd")) e.start_on = "Start date can be at most 24 months in the past.";
    if (d.end_on && validStart && d.end_on < d.start_on) e.end_on = "End date must be on or after the start date.";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = useMutation({
    mutationFn: () =>
      api.saveRecurring(recurring?.id ?? null, {
        vendor: d.vendor.trim(),
        description: d.description.trim(),
        category_id: d.category_id,
        amount: centsToInput(amountCents ?? 0),
        currency: d.currency,
        paid_by: d.paid_by,
        payer_name: personal ? d.payer_name.trim() : "",
        payment_method: d.payment_method,
        account_label: d.account_label.trim(),
        property_id: d.property_id,
        client_name: "",
        notes: d.notes,
        day_of_month: day,
        start_on: d.start_on,
        end_on: d.end_on,
      }),
    onSuccess: (res) => {
      ex.invalidate();
      const added = res.created > 0 ? ` · ${res.created} entr${res.created === 1 ? "y" : "ies"} added to records` : "";
      toast.success(`${recurring ? "Recurring expense updated" : "Monthly expense set up"}${added}`);
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save the recurring expense."),
  });

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={recurring ? "Edit monthly expense" : "Add monthly expense"}
      description="It's added to your expenditure records automatically on the chosen day every month."
      dirty={JSON.stringify(d) !== initial}
      saving={save.isPending}
      submitLabel={recurring ? "Save changes" : "Start monthly expense"}
      onSubmit={() => {
        if (validate()) save.mutate();
      }}
      wide
    >
      <fieldset className="grid gap-4">
        <legend className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-link">Expense</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField label="Vendor / payee" required value={d.vendor} onChange={set("vendor")} error={errors.vendor} maxLength={200} placeholder="e.g. State Farm, Verizon, office landlord" />
          <SelectField label="Category" required value={d.category_id} onChange={set("category_id")} options={categoryOptions} error={errors.category_id} />
        </div>
        <TextField label="Description" required value={d.description} onChange={set("description")} error={errors.description} maxLength={500} placeholder="e.g. General liability insurance premium" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <MoneyField label="Monthly amount" required value={d.amount} onChange={set("amount")} currency={d.currency} error={errors.amount} className="sm:col-span-2" />
          <SelectField label="Currency" value={d.currency} onChange={set("currency")} options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
        </div>
      </fieldset>

      <fieldset className="grid gap-4">
        <legend className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-link">Schedule</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <SelectField label="Day of the month" required value={d.day} onChange={setDay} options={dayOptions} />
          <TextField
            label="First charge on or after"
            type="date"
            required
            value={d.start_on}
            onChange={(v) => {
              setStartTouched(true);
              set("start_on")(v);
            }}
            error={errors.start_on}
          />
          <TextField label="End date" type="date" value={d.end_on} onChange={set("end_on")} error={errors.end_on} hint="Optional — leave blank to repeat until stopped." />
        </div>
        <div className="rounded-lg border border-line bg-raised px-4 py-3 text-sm">
          <div className="flex items-start gap-2.5">
            <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-link" />
            <p className="text-ink">
              {amountCents && amountCents > 0 ? <span className="font-mono font-semibold">{fmtMoney(amountCents, d.currency)}</span> : "This expense"} will be
              added on the <span className="font-semibold">{ordinal(day)}</span> of every month
              {day >= 29 ? " (the last day in shorter months)" : ""}.
              {next ? (
                <>
                  {" "}
                  Next: <span className="font-semibold">{fmt(next, "EEE, MMM d, yyyy")}</span>.
                </>
              ) : validStart && backfill.length === 0 ? (
                " No further charges — the end date has passed."
              ) : null}
            </p>
          </div>
          {backfill.length > 0 && (
            <div className="mt-2.5 flex items-start gap-2.5 border-t border-line pt-2.5">
              <History className="mt-0.5 h-4 w-4 shrink-0 text-status-follow" />
              <p className="text-ink-2">
                {backfill.length} charge{backfill.length === 1 ? " is" : "s are"} already due and will be added to records when you save:{" "}
                <span className="text-ink">{backfill.map((k) => fmt(k, "MMM d")).join(", ")}</span>.
              </p>
            </div>
          )}
        </div>
      </fieldset>

      <fieldset className="grid gap-4">
        <legend className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-link">Payment</legend>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SelectField label="Paid by" required value={d.paid_by} onChange={setPaidBy} options={(Object.keys(PAID_BY) as PaidBy[]).map((k) => ({ value: k, label: PAID_BY[k] }))} />
          <SelectField label="Payment method" required value={d.payment_method} onChange={set("payment_method")} options={methods.map((m) => ({ value: m, label: METHOD[m] }))} />
        </div>
        {personal && <TextField label="Payer name" required value={d.payer_name} onChange={set("payer_name")} error={errors.payer_name} maxLength={200} placeholder="Full name" />}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField label="Account label or last four digits" value={d.account_label} onChange={set("account_label")} error={errors.account_label} maxLength={40} placeholder="e.g. Chase checking ••1234" hint="Never enter full card or bank numbers." />
          <SelectField label="Property / client" value={d.property_id} onChange={set("property_id")} options={propertyOptions} allowNone noneLabel="None (company-wide)" />
        </div>
        <AreaField label="Notes" rows={2} value={d.notes} onChange={set("notes")} placeholder="Copied onto every entry (optional)" />
      </fieldset>

      {recurring && <p className="text-xs text-ink-3">Changes apply to future entries. Entries already in your records stay as they are — edit them individually if needed.</p>}
    </FormDialog>
  );
};
