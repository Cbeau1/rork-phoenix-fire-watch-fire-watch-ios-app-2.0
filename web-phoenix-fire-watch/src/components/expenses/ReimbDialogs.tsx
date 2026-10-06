import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Wand2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { AreaField, CheckField, ConfirmDialog, FormDialog, SelectField, TextField } from "@/components/workforce/kit";
import * as api from "@/lib/expenses/api";
import { DIRECTION, PAY_METHOD, type Direction, type Expenditure, type Reimbursement } from "@/lib/expenses/constants";
import { today, type PaymentView, type ReimbView } from "@/lib/expenses/derive";
import { autoAllocate, centsToInput, fmtMoney, parseMoney, toCents } from "@/lib/expenses/money";
import { useExpenses } from "@/state/ExpensesProvider";

import { MoneyField } from "./kit";

/* ---------------- Create / edit a reimbursement obligation ---------------- */

export const ReimbursementDialog = ({
  open,
  onOpenChange,
  expenditure,
  direction,
  existing,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  expenditure: Expenditure;
  direction: Direction;
  existing: Reimbursement | null;
}) => {
  const ex = useExpenses();
  const toPerson = direction === "to_person";
  const total = toCents(expenditure.amount);
  const othersOpen = useMemo(
    () =>
      ex.index.reimbs
        .filter((v) => v.r.expenditure_id === expenditure.id && v.r.direction === direction && !["rejected", "cancelled"].includes(v.r.status) && v.r.id !== existing?.id)
        .reduce((s, v) => s + v.requested, 0),
    [ex.index.reimbs, expenditure.id, direction, existing],
  );
  const init = useMemo(
    () => ({
      party_type:
        existing?.party_type ??
        (toPerson ? (expenditure.paid_by === "owner" ? "owner" : expenditure.paid_by === "employee" ? "employee" : "other") : expenditure.agency_id && !expenditure.property_id ? "agency" : "client"),
      party_name: existing?.party_name ?? (toPerson ? expenditure.payer_name : ""),
      party_worker_id: existing?.party_worker_id ?? (toPerson ? (expenditure.payer_worker_id ?? "") : ""),
      party_agency_id: existing?.party_agency_id ?? expenditure.agency_id ?? "",
      party_property_id: existing?.party_property_id ?? expenditure.property_id ?? "",
      agency_invoice_id: existing?.agency_invoice_id ?? "",
      requested_amount: centsToInput(existing ? toCents(existing.requested_amount) : Math.max(0, total - othersOpen)),
      requested_on: existing?.requested_on ?? today(),
      due_on: existing?.due_on ?? "",
      invoice_ref: existing?.invoice_ref ?? "",
      notes: existing?.notes ?? "",
      submit: existing ? existing.status !== "draft" : true,
    }),
    [existing, expenditure, toPerson, total, othersOpen],
  );
  const [d, setD] = useState(init);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (open) {
      setD(init);
      setErrors({});
    }
  }, [open, init]);
  const set =
    <K extends keyof typeof init>(k: K) =>
    (v: (typeof init)[K]) =>
      setD((p) => ({ ...p, [k]: v }));
  const lockedAmount = !!existing && !["draft", "pending_review"].includes(existing.status);

  const save = useMutation({
    mutationFn: () =>
      api.saveReimbursement(existing?.id ?? null, {
        expenditure_id: expenditure.id,
        direction,
        party_type: d.party_type,
        party_name:
          d.party_name.trim() ||
          (d.party_type === "client" && d.party_property_id ? ex.propertyName(d.party_property_id) : d.party_type === "agency" ? (ex.agencyById.get(d.party_agency_id)?.name ?? "") : ""),
        party_worker_id: d.party_worker_id,
        party_agency_id: d.party_agency_id,
        party_property_id: d.party_property_id,
        agency_invoice_id: d.agency_invoice_id,
        requested_amount: centsToInput(parseMoney(d.requested_amount) ?? 0),
        requested_on: d.requested_on,
        due_on: d.due_on,
        invoice_ref: d.invoice_ref,
        notes: d.notes,
        submit: d.submit,
      }),
    onSuccess: (r) => {
      ex.invalidate();
      toast.success(existing ? `${r.code} saved` : `${r.code} created`);
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save."),
  });

  const submit = () => {
    const e: Record<string, string> = {};
    const amt = parseMoney(d.requested_amount);
    if (amt === null || amt <= 0) e.requested_amount = "Enter an amount greater than 0.";
    else if (amt + othersOpen > total) e.requested_amount = `Can't exceed the expense total (${fmtMoney(total - othersOpen, expenditure.currency)} available).`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.requested_on)) e.requested_on = "Enter the request date.";
    if (d.due_on && d.due_on < d.requested_on) e.due_on = "Due date can't be before the request date.";
    const hasName = d.party_name.trim() || (d.party_type === "client" && d.party_property_id) || (d.party_type === "agency" && d.party_agency_id) || d.party_worker_id;
    if (!hasName) e.party_name = toPerson ? "Enter who is owed." : "Choose or enter who is expected to pay.";
    if (d.party_type === "agency" && !d.party_agency_id) e.party_agency_id = "Choose the agency.";
    setErrors(e);
    if (Object.keys(e).length === 0) save.mutate();
  };

  const partyTypes = toPerson
    ? [
        { value: "owner", label: "Owner" },
        { value: "employee", label: "Employee" },
        { value: "other", label: "Other person" },
      ]
    : [
        { value: "client", label: "Client / property" },
        { value: "agency", label: "Agency" },
        { value: "other", label: "Other" },
      ];

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`${existing ? `Edit ${existing.code}` : "New"} · ${DIRECTION[direction].label}`}
      description={`${DIRECTION[direction].long}. ${expenditure.code} · ${expenditure.vendor} · ${fmtMoney(total, expenditure.currency)}`}
      dirty={JSON.stringify(d) !== JSON.stringify(init)}
      saving={save.isPending}
      onSubmit={submit}
      submitLabel={existing ? "Save" : "Create request"}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SelectField label={toPerson ? "Owed to" : "Expected from"} required value={d.party_type} onChange={set("party_type")} options={partyTypes} />
        {toPerson && (d.party_type === "owner" || d.party_type === "employee") && (
          <SelectField
            label="Workforce profile"
            value={d.party_worker_id}
            onChange={(v) => setD((p) => ({ ...p, party_worker_id: v, party_name: p.party_name || (ex.workerById.get(v)?.name ?? "") }))}
            options={ex.lookups.workers.filter((w) => !w.archived && (d.party_type === "owner" || w.source === "direct")).map((w) => ({ value: w.id, label: `${w.name} · ${w.code}` }))}
            allowNone
            noneLabel="Not linked"
          />
        )}
        {!toPerson && d.party_type === "client" && (
          <SelectField label="Property / client" value={d.party_property_id} onChange={set("party_property_id")} options={ex.properties.map((p) => ({ value: p.id, label: p.name }))} allowNone noneLabel="Other client" />
        )}
        {!toPerson && d.party_type === "agency" && (
          <SelectField label="Agency" required value={d.party_agency_id} onChange={set("party_agency_id")} options={ex.lookups.agencies.map((a) => ({ value: a.id, label: a.name }))} error={errors.party_agency_id} />
        )}
        <TextField
          label="Name"
          value={d.party_name}
          onChange={set("party_name")}
          error={errors.party_name}
          maxLength={200}
          className={toPerson || d.party_type === "other" ? "" : "sm:col-span-2"}
          hint={!toPerson && d.party_type !== "other" ? "Optional — defaults to the selected property/agency." : undefined}
        />
        <MoneyField
          label="Requested amount"
          required
          value={d.requested_amount}
          onChange={set("requested_amount")}
          currency={expenditure.currency}
          error={errors.requested_amount}
          disabled={lockedAmount}
          hint={lockedAmount ? "Locked after approval — use “Correct approved amount”." : `Up to ${fmtMoney(total - othersOpen, expenditure.currency)}`}
        />
        <TextField label="Request date" type="date" required value={d.requested_on} onChange={set("requested_on")} error={errors.requested_on} />
        <TextField label="Due date" type="date" value={d.due_on} onChange={set("due_on")} error={errors.due_on} hint="Optional" />
        {!toPerson && (
          <>
            {d.party_type === "agency" && (
              <SelectField
                label="Existing agency invoice (optional)"
                value={d.agency_invoice_id}
                onChange={set("agency_invoice_id")}
                options={ex.lookups.invoices.filter((i) => i.agencyId === d.party_agency_id).map((i) => ({ value: i.id, label: `#${i.number} · ${fmtMoney(toCents(i.total))}` }))}
                allowNone
              />
            )}
            <TextField label="Client invoice reference" value={d.invoice_ref} onChange={set("invoice_ref")} maxLength={120} hint="For reference only — no invoice is created or changed." />
          </>
        )}
      </div>
      <AreaField label="Notes" rows={2} value={d.notes} onChange={set("notes")} />
      {(!existing || existing.status === "draft") && (
        <CheckField label="Send for review now" hint="Otherwise it's saved as a draft. Approval is a separate step and never counts as payment." checked={d.submit} onChange={set("submit")} />
      )}
    </FormDialog>
  );
};

/* ---------------- Review: approve / adjust / reject / cancel / reopen ---------------- */

export type ReviewMode = api.ReviewAction;
const REVIEW_TEXT: Record<ReviewMode, { title: string; confirm: string; destructive?: boolean; needsNote: boolean; amount?: boolean }> = {
  submit: { title: "Send for review", confirm: "Send for review", needsNote: false },
  approve: { title: "Approve request", confirm: "Approve", needsNote: false, amount: true },
  adjust: { title: "Correct approved amount", confirm: "Save correction", needsNote: true, amount: true },
  reject: { title: "Reject request", confirm: "Reject", destructive: true, needsNote: true },
  cancel: { title: "Cancel request", confirm: "Cancel request", destructive: true, needsNote: true },
  reopen: { title: "Reopen request", confirm: "Reopen for review", needsNote: false },
};

export const ReviewDialog = ({ target, mode, onClose }: { target: ReimbView | null; mode: ReviewMode; onClose: () => void }) => {
  const ex = useExpenses();
  const [amount, setAmount] = useState<string>("");
  const [note, setNote] = useState<string>("");
  useEffect(() => {
    if (target) {
      setAmount(centsToInput(mode === "adjust" ? (target.approved ?? target.requested) : target.requested));
      setNote("");
    }
  }, [target, mode]);
  const t = REVIEW_TEXT[mode];
  const cents = parseMoney(amount);
  let amountErr = "";
  if (t.amount && target) {
    if (cents === null || cents <= 0) amountErr = "Enter an amount greater than 0.";
    else if (cents > target.requested) amountErr = "Can't exceed the requested amount.";
    else if (mode === "adjust" && cents < target.paid) amountErr = `Already paid ${fmtMoney(target.paid, target.currency)} — reverse a payment first.`;
  }
  const run = useMutation({
    mutationFn: () => api.reviewReimbursement(target?.r.id ?? "", mode, t.amount && cents !== null ? centsToInput(cents) : "", note),
    onSuccess: () => {
      ex.invalidate();
      toast.success(`${target?.r.code} updated`);
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't update."),
  });
  return (
    <ConfirmDialog
      open={!!target}
      onOpenChange={(o) => !o && onClose()}
      title={`${t.title}${target ? ` · ${target.r.code}` : ""}`}
      description={
        target ? (
          <>
            {target.r.party_name} · requested {fmtMoney(target.requested, target.currency)}
            {mode === "approve" && " · Approval doesn't mark anything as paid; record a payment when money actually changes hands."}
          </>
        ) : undefined
      }
      confirmLabel={t.confirm}
      destructive={t.destructive}
      busy={run.isPending}
      disabled={!!amountErr || (t.needsNote && note.trim().length < 3)}
      onConfirm={() => run.mutate()}
    >
      <div className="grid gap-3">
        {t.amount && target && <MoneyField label="Approved amount" required value={amount} onChange={setAmount} currency={target.currency} error={amountErr} />}
        <AreaField label={t.needsNote ? "Reason (required)" : "Note (optional)"} rows={2} value={note} onChange={setNote} />
      </div>
    </ConfirmDialog>
  );
};

/* ---------------- Record a payment (single or batch) ---------------- */

export const PaymentDialog = ({
  open,
  onOpenChange,
  direction,
  initial,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  direction: Direction;
  /** Pre-selected obligations. */
  initial: ReimbView[];
}) => {
  const ex = useExpenses();
  const toPerson = direction === "to_person";
  const [party, setParty] = useState<string>("");
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [paidOn, setPaidOn] = useState<string>(today());
  const [method, setMethod] = useState<string>("check");
  const [reference, setReference] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [total, setTotal] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const payable = useMemo(
    () => ex.index.reimbs.filter((v) => v.r.direction === direction && v.payable && v.remaining > 0 && !v.exp?.archived_at).sort((a, b) => a.r.requested_on.localeCompare(b.r.requested_on)),
    [ex.index.reimbs, direction],
  );
  const parties = useMemo(() => Array.from(new Set(payable.map((v) => v.r.party_name))).sort(), [payable]);

  useEffect(() => {
    if (!open) return;
    const sel: Record<string, string> = {};
    for (const v of initial) if (v.payable && v.remaining > 0) sel[v.r.id] = centsToInput(v.remaining);
    setSelected(sel);
    setParty(initial[0]?.r.party_name ?? "");
    setPaidOn(today());
    setMethod("check");
    setReference("");
    setNotes("");
    setTotal("");
    setFile(null);
    setErrors({});
  }, [open, initial]);

  const shown = payable.filter((v) => !party || v.r.party_name === party || selected[v.r.id] !== undefined);
  const chosen = payable.filter((v) => selected[v.r.id] !== undefined);
  const currencies = new Set(chosen.map((v) => v.currency));
  const currency = chosen[0]?.currency ?? "USD";
  const sum = chosen.reduce((s, v) => s + (parseMoney(selected[v.r.id] ?? "") ?? 0), 0);

  const toggle = (v: ReimbView) =>
    setSelected((p) => {
      const n = { ...p };
      if (n[v.r.id] !== undefined) delete n[v.r.id];
      else n[v.r.id] = centsToInput(v.remaining);
      return n;
    });

  const distribute = () => {
    const t = parseMoney(total);
    if (t === null || t <= 0) {
      setErrors((e) => ({ ...e, total: "Enter the payment total to split." }));
      return;
    }
    const alloc = autoAllocate(t, chosen.map((v) => v.remaining));
    const n: Record<string, string> = {};
    chosen.forEach((v, i) => {
      if (alloc[i] > 0) n[v.r.id] = centsToInput(alloc[i]);
    });
    setSelected(n);
    const capacity = chosen.reduce((s, v) => s + v.remaining, 0);
    setErrors((e) => ({ ...e, total: t > capacity ? `Only ${fmtMoney(capacity, currency)} is outstanding on the selected requests.` : "" }));
  };

  const save = useMutation({
    mutationFn: async () => {
      const res = await api.recordPayment({
        direction,
        paid_on: paidOn,
        method,
        reference,
        notes,
        amount: centsToInput(sum),
        allocations: chosen.map((v) => ({ reimbursement_id: v.r.id, amount: centsToInput(parseMoney(selected[v.r.id]) ?? 0) })),
      });
      let fileError = "";
      if (file) {
        try {
          await api.uploadFile(file, { paymentId: res.id });
        } catch (e) {
          fileError = e instanceof Error ? e.message : "Upload failed.";
        }
      }
      return { ...res, fileError };
    },
    onSuccess: (res) => {
      ex.invalidate();
      toast.success(`${res.code} recorded · ${fmtMoney(toCents(res.amount), currency)}`);
      if (res.fileError) toast.error(`Payment saved, but the attachment failed: ${res.fileError}`);
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't record payment."),
  });

  const submit = () => {
    const e: Record<string, string> = {};
    if (chosen.length === 0) e.rows = "Select at least one request.";
    if (currencies.size > 1) e.rows = "A single payment can't mix currencies.";
    for (const v of chosen) {
      const c = parseMoney(selected[v.r.id] ?? "");
      if (c === null || c <= 0) e[v.r.id] = "Enter an amount.";
      else if (c > v.remaining) e[v.r.id] = `Over-payment — only ${fmtMoney(v.remaining, v.currency)} remains.`;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paidOn)) e.paidOn = "Enter the payment date.";
    else if (paidOn > today()) e.paidOn = "Payment date can't be in the future.";
    setErrors(e);
    if (Object.keys(e).filter((k) => e[k]).length === 0) save.mutate();
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={toPerson ? "Record reimbursement payment" : "Record recovered payment"}
      description={
        toPerson
          ? "Records a payment that already happened outside the app. Nothing is sent or transferred. One payment can settle several approved requests."
          : "Records money received from a client or agency. Shown separately from spending; no invoice is created or changed."
      }
      dirty={chosen.length > 0 || !!reference || !!notes}
      saving={save.isPending}
      onSubmit={submit}
      submitLabel={`Record ${fmtMoney(sum, currency)}`}
      wide
    >
      <SelectField label={toPerson ? "Paid to" : "Received from"} value={party} onChange={setParty} options={parties.map((p) => ({ value: p, label: p }))} allowNone noneLabel="Everyone" />
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-sm font-medium text-ink">Apply to approved requests</span>
          <span className="text-xs text-ink-3">{chosen.length} selected</span>
        </div>
        {shown.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm text-ink-2">
            No approved, unpaid {toPerson ? "reimbursements" : "recoveries"}. Requests must be approved before a payment can be recorded.
          </div>
        ) : (
          <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
            {shown.map((v) => {
              const on = selected[v.r.id] !== undefined;
              return (
                <li key={v.r.id} className="rounded-lg border border-line bg-raised px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-3">
                    <input type="checkbox" aria-label={`Select ${v.r.code}`} className="h-4 w-4 accent-[#DC2626]" checked={on} onChange={() => toggle(v)} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-ink">
                        <span className="font-mono text-xs text-ember">{v.r.code}</span> · {v.r.party_name} · {v.exp?.vendor}
                      </div>
                      <div className="text-xs text-ink-3">
                        {v.exp?.code} · approved {fmtMoney(v.approved, v.currency)} · paid {fmtMoney(v.paid, v.currency)} ·{" "}
                        <span className="text-ink-2">remaining {fmtMoney(v.remaining, v.currency)}</span>
                      </div>
                    </div>
                    {on && (
                      <div className="w-40">
                        <MoneyField label="Apply" value={selected[v.r.id]} onChange={(val) => setSelected((p) => ({ ...p, [v.r.id]: val }))} currency={v.currency} error={errors[v.r.id]} />
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {errors.rows && <p className="mt-1.5 text-xs text-status-incident">{errors.rows}</p>}
      </div>
      {chosen.length > 1 && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-line bg-raised p-3">
          <MoneyField className="w-48" label="Split a total" value={total} onChange={setTotal} currency={currency} error={errors.total} />
          <Button type="button" variant="outline" size="sm" className="mb-0.5" onClick={distribute}>
            <Wand2 />
            Allocate oldest first
          </Button>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <TextField label="Payment date" type="date" required value={paidOn} onChange={setPaidOn} error={errors.paidOn} />
        <SelectField label="Method" required value={method} onChange={setMethod} options={Object.entries(PAY_METHOD).map(([value, label]) => ({ value, label }))} />
        <TextField label="Reference # (optional)" value={reference} onChange={setReference} maxLength={120} placeholder="Check #, transfer ID…" />
      </div>
      <AreaField label="Notes" rows={2} value={notes} onChange={setNotes} />
      <div>
        <label className="mb-2 block text-sm font-medium text-ink" htmlFor="pay-file">
          Supporting attachment (optional)
        </label>
        <input
          id="pay-file"
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          className="block w-full text-sm text-ink-2 file:mr-3 file:rounded-md file:border file:border-line file:bg-raised file:px-3 file:py-1.5 file:text-ink"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </div>
      <div className="rounded-lg border border-line bg-raised px-4 py-3 text-sm">
        <div className="flex justify-between">
          <span className="text-ink-2">Payment total</span>
          <span className="font-mono font-semibold text-ink">{fmtMoney(sum, currency)}</span>
        </div>
        <p className="mt-1 text-xs text-ink-3">
          {toPerson
            ? "Reimbursements settle who paid — they are not added to business spending."
            : "Recoveries are reported separately from gross spending."}
        </p>
      </div>
    </FormDialog>
  );
};

/* ---------------- Reverse a payment (correction) ---------------- */

export const ReverseDialog = ({ target, onClose }: { target: PaymentView | null; onClose: () => void }) => {
  const ex = useExpenses();
  const [reason, setReason] = useState<string>("");
  useEffect(() => setReason(""), [target]);
  const run = useMutation({
    mutationFn: () => api.reversePayment(target?.payment.id ?? "", reason),
    onSuccess: () => {
      ex.invalidate();
      toast.success(`${target?.payment.code} reversed`);
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't reverse."),
  });
  return (
    <ConfirmDialog
      open={!!target}
      onOpenChange={(o) => !o && onClose()}
      title={`Reverse ${target?.payment.code ?? "payment"}?`}
      description={
        target ? (
          <span className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-follow" />
            <span>
              The original {fmtMoney(toCents(target.payment.amount), target.payment.currency)} payment stays in the history, marked reversed, and its amount
              goes back to the outstanding balance of {target.allocations.length === 1 ? "its request" : `all ${target.allocations.length} requests`}. Record a
              new payment afterwards if a corrected amount was paid.
            </span>
          </span>
        ) : undefined
      }
      confirmLabel="Reverse payment"
      destructive
      busy={run.isPending}
      disabled={reason.trim().length < 3}
      onConfirm={() => run.mutate()}
    >
      <AreaField label="Reason (required)" rows={2} value={reason} onChange={setReason} placeholder="e.g. Entered the wrong amount; check was voided" />
    </ConfirmDialog>
  );
};
