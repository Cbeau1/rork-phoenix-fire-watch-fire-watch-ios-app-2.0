import { useMutation } from "@tanstack/react-query";
import { AlertTriangle, Archive, ArchiveRestore, CheckCircle2, CircleHelp, Download, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";

import { PageHeader } from "@/components/fw/primitives";
import { Button } from "@/components/ui/button";
import { DocumentsPanel } from "@/components/workforce/DocumentsPanel";
import {
  AreaField,
  ConfirmDialog,
  DataTile,
  Empty,
  fmtDate,
  FormDialog,
  isDate,
  MetaPill,
  Pill,
  Restricted,
  SectionCard,
  SelectField,
  TextField,
  toNum,
} from "@/components/workforce/kit";
import { placementPropertyName } from "@/components/workforce/placements";
import * as api from "@/lib/workforce/api";
import { duplicateInvoices, reconcileInvoice } from "@/lib/workforce/calc";
import { fullName, INVOICE_LINE_TYPE, INVOICE_STATUS, money, type Invoice, type InvoiceLine } from "@/lib/workforce/constants";
import { buildPdf, downloadBlob, stamp } from "@/lib/workforce/exports";
import { todayKey } from "@/lib/workforce/derive";
import { cn } from "@/lib/utils";
import NotFound from "@/pages/NotFound";
import { useWorkforce } from "@/state/WorkforceProvider";

const InvoiceDialog = ({ open, onOpenChange, invoice }: { open: boolean; onOpenChange: (v: boolean) => void; invoice: Invoice | null }) => {
  const wf = useWorkforce();
  const navigate = useNavigate();
  const init = useMemo(
    () => ({
      agency_id: invoice?.agency_id ?? "",
      invoice_number: invoice?.invoice_number ?? "",
      period_start: invoice?.period_start ?? "",
      period_end: invoice?.period_end ?? "",
      invoice_date: invoice?.invoice_date ?? todayKey(),
      due_date: invoice?.due_date ?? "",
      total: invoice ? String(invoice.total) : "",
      status: invoice?.status ?? "received",
      review_notes: invoice?.review_notes ?? "",
      paid_on: invoice?.paid_on ?? "",
      payment_ref: invoice?.payment_ref ?? "",
    }),
    [invoice],
  );
  const [d, setD] = useState(init);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (open) {
      setD(init);
      setErrors({});
    }
  }, [open, init]);
  const set = (k: keyof typeof init) => (v: string) => setD((p) => ({ ...p, [k]: v }));
  const dupes = d.agency_id && d.invoice_number.trim()
    ? duplicateInvoices(
        { id: invoice?.id ?? "", agency_id: d.agency_id, invoice_number: d.invoice_number, total: toNum(d.total) ?? 0, period_start: d.period_start || null, period_end: d.period_end || null },
        wf.invoices,
      )
    : [];
  const save = useMutation({
    mutationFn: () =>
      api.saveInvoice(invoice?.id ?? null, {
        org_id: wf.orgId,
        agency_id: d.agency_id,
        invoice_number: d.invoice_number.trim(),
        period_start: d.period_start || null,
        period_end: d.period_end || null,
        invoice_date: d.invoice_date || null,
        due_date: d.due_date || null,
        total: toNum(d.total) ?? 0,
        status: d.status,
        review_notes: d.review_notes.trim(),
        paid_on: d.status === "paid" ? d.paid_on || todayKey() : d.paid_on || null,
        payment_ref: d.payment_ref.trim(),
      }),
    onSuccess: (i) => {
      wf.invalidate("invoices");
      toast.success(invoice ? "Invoice saved" : "Invoice recorded");
      onOpenChange(false);
      if (!invoice) navigate(`/workforce/invoices/${i.id}`);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save."),
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={invoice ? `Invoice #${invoice.invoice_number}` : "Record agency invoice"}
      description="Enter details from the agency's invoice. Recording “Paid” is administrative tracking only — no payment is made."
      dirty={JSON.stringify(d) !== JSON.stringify(init)}
      saving={save.isPending}
      onSubmit={() => {
        const e: Record<string, string> = {};
        if (!d.agency_id) e.agency_id = "Choose the agency.";
        if (!d.invoice_number.trim()) e.invoice_number = "Invoice number is required.";
        const t = toNum(d.total);
        if (t === null || t < 0) e.total = "Enter the invoice total.";
        if (d.period_start && d.period_end && d.period_end < d.period_start) e.period_end = "Must be after the period start.";
        if (d.status === "paid" && d.paid_on && !isDate(d.paid_on)) e.paid_on = "Use a valid date.";
        setErrors(e);
        if (Object.keys(e).length === 0) save.mutate();
      }}
      wide
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SelectField label="Agency" required value={d.agency_id} onChange={set("agency_id")} error={errors.agency_id} disabled={!!invoice} options={wf.agencies.map((a) => ({ value: a.id, label: a.name }))} />
        <TextField label="Invoice number" required value={d.invoice_number} onChange={set("invoice_number")} error={errors.invoice_number} maxLength={80} />
        <TextField label="Service period start" type="date" value={d.period_start} onChange={set("period_start")} />
        <TextField label="Service period end" type="date" value={d.period_end} onChange={set("period_end")} error={errors.period_end} />
        <TextField label="Invoice date" type="date" value={d.invoice_date} onChange={set("invoice_date")} />
        <TextField label="Due date" type="date" value={d.due_date} onChange={set("due_date")} />
        <TextField label="Invoice total ($)" required inputMode="decimal" value={d.total} onChange={set("total")} error={errors.total} />
        <SelectField label="Status" required value={d.status} onChange={set("status")} options={Object.entries(INVOICE_STATUS).map(([value, m]) => ({ value, label: m.label }))} />
      </div>
      {d.status === "paid" && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField label="Payment date (recorded)" type="date" value={d.paid_on} onChange={set("paid_on")} error={errors.paid_on} />
          <TextField label="Payment reference" value={d.payment_ref} onChange={set("payment_ref")} placeholder="e.g. Check #1042" />
        </div>
      )}
      <AreaField label="Review notes" value={d.review_notes} onChange={set("review_notes")} rows={3} />
      {dupes.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-status-follow/50 bg-status-follow/10 px-3.5 py-2.5 text-sm text-ink" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-follow" />
          Possible duplicate of {dupes.map((x) => `#${x.invoice_number}`).join(", ")} from this agency.
        </div>
      )}
    </FormDialog>
  );
};

const LineDialog = ({ open, onOpenChange, invoice, line }: { open: boolean; onOpenChange: (v: boolean) => void; invoice: Invoice; line: InvoiceLine | null }) => {
  const wf = useWorkforce();
  const init = useMemo(
    () => ({
      line_type: line?.line_type ?? "regular",
      placement_id: line?.placement_id ?? "",
      worker_id: line?.worker_id ?? "",
      service_start: line?.service_start ?? invoice.period_start ?? "",
      service_end: line?.service_end ?? invoice.period_end ?? "",
      description: line?.description ?? "",
      hours: line?.hours != null ? String(line.hours) : "",
      rate: line?.rate != null ? String(line.rate) : "",
      amount: line ? String(line.amount) : "",
    }),
    [line, invoice],
  );
  const [d, setD] = useState(init);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (open) {
      setD(init);
      setErrors({});
    }
  }, [open, init]);
  const set = (k: keyof typeof init) => (v: string) => setD((p) => ({ ...p, [k]: v }));
  const placements = wf.placements.filter((p) => p.agency_id === invoice.agency_id);
  const computed = toNum(d.hours) !== null && toNum(d.rate) !== null ? Math.round((toNum(d.hours) ?? 0) * (toNum(d.rate) ?? 0) * 100) / 100 : null;
  const save = useMutation({
    mutationFn: () => {
      const pl = wf.placementById.get(d.placement_id);
      return api.saveInvoiceLine(line?.id ?? null, {
        org_id: wf.orgId,
        invoice_id: invoice.id,
        line_type: d.line_type,
        placement_id: d.placement_id || null,
        worker_id: pl?.worker_id ?? (d.worker_id || null),
        service_start: d.service_start || null,
        service_end: d.service_end || null,
        description: d.description.trim(),
        hours: d.line_type === "fee" ? null : toNum(d.hours),
        rate: d.line_type === "fee" ? null : toNum(d.rate),
        amount: toNum(d.amount) ?? computed ?? 0,
      });
    },
    onSuccess: () => {
      wf.invalidate("lines");
      toast.success("Line saved");
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save."),
  });
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={line ? "Edit invoice line" : "Add invoice line"}
      description="Enter each line exactly as invoiced. Lines are entered manually — there is no automatic invoice extraction."
      dirty={JSON.stringify(d) !== JSON.stringify(init)}
      saving={save.isPending}
      onSubmit={() => {
        const e: Record<string, string> = {};
        if (d.line_type !== "fee") {
          if (toNum(d.hours) === null || (toNum(d.hours) ?? 0) < 0) e.hours = "Enter invoiced hours.";
          if (toNum(d.rate) === null || (toNum(d.rate) ?? 0) < 0) e.rate = "Enter the invoiced rate.";
        }
        if (toNum(d.amount) === null && computed === null) e.amount = "Enter the line amount.";
        if (d.service_start && d.service_end && d.service_end < d.service_start) e.service_end = "Must be after the start.";
        setErrors(e);
        if (Object.keys(e).length === 0) save.mutate();
      }}
      wide
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SelectField label="Line type" required value={d.line_type} onChange={set("line_type")} options={Object.entries(INVOICE_LINE_TYPE).map(([value, label]) => ({ value, label }))} />
        <SelectField
          label="Placement"
          value={d.placement_id}
          onChange={set("placement_id")}
          allowNone
          noneLabel="Not linked"
          options={placements.map((p) => ({ value: p.id, label: `${fullName(wf.workerById.get(p.worker_id) ?? { first_name: "Worker", last_name: "" })} · ${placementPropertyName(p, wf.propertyById)}` }))}
          hint="Link to compare against approved hours and agency rates."
        />
        <TextField label="Service start" type="date" value={d.service_start} onChange={set("service_start")} />
        <TextField label="Service end" type="date" value={d.service_end} onChange={set("service_end")} error={errors.service_end} />
        {d.line_type !== "fee" && (
          <>
            <TextField label="Invoiced hours" required inputMode="decimal" value={d.hours} onChange={set("hours")} error={errors.hours} />
            <TextField label="Invoiced rate ($/hr)" required inputMode="decimal" value={d.rate} onChange={set("rate")} error={errors.rate} />
          </>
        )}
        <TextField
          label="Line amount ($)"
          required
          inputMode="decimal"
          value={d.amount}
          onChange={set("amount")}
          error={errors.amount}
          placeholder={computed !== null ? String(computed) : ""}
          hint={computed !== null ? `Hours × rate = ${money(computed)}. Leave blank to use it.` : undefined}
        />
        <TextField label="Description" value={d.description} onChange={set("description")} />
      </div>
    </FormDialog>
  );
};

const diffCell = (n: number | null, fmt: (x: number) => string) =>
  n === null ? <span className="text-ink-3">—</span> : Math.abs(n) < 0.01 ? <span className="text-status-clear">0</span> : <span className="font-medium text-status-incident-ink">{n > 0 ? "+" : ""}{fmt(n)}</span>;

export const InvoiceList = () => {
  const wf = useWorkforce();
  const [params, setParams] = useSearchParams();
  const [addOpen, setAddOpen] = useState<boolean>(false);
  const status = params.get("status") ?? "";
  const agency = params.get("agency") ?? "";
  if (!wf.perms.finance) return <Restricted what="Agency invoice reconciliation" />;
  const list = wf.invoices.filter(
    (i) => !i.archived_at && (!agency || i.agency_id === agency) && (status === "open" ? i.status !== "paid" : !status || i.status === status),
  );
  const set = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v);
    else n.delete(k);
    setParams(n, { replace: true });
  };
  return (
    <div>
      <PageHeader
        title="Agency invoices"
        subtitle="Reconcile agency invoices against approved hours and agency bill rates. Client invoices are never touched."
        actions={
          <Button onClick={() => setAddOpen(true)} disabled={wf.agencies.length === 0}>
            <Plus />
            Record invoice
          </Button>
        }
      />
      <div className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-line bg-surface shadow-card p-3 sm:grid-cols-2 sm:p-4">
        <SelectField
          label="Status"
          value={status}
          onChange={(v) => set("status", v)}
          allowNone
          noneLabel="All statuses"
          options={[{ value: "open", label: "Awaiting review / payment" }, ...Object.entries(INVOICE_STATUS).map(([value, m]) => ({ value, label: m.label }))]}
        />
        <SelectField label="Agency" value={agency} onChange={(v) => set("agency", v)} allowNone noneLabel="All agencies" options={wf.agencies.map((a) => ({ value: a.id, label: a.name }))} />
      </div>
      {list.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface shadow-card p-4">
          <Empty title="No invoices" description={wf.agencies.length === 0 ? "Add an agency first." : "Record an agency invoice to start reconciling."} />
        </div>
      ) : (
        <ul className="space-y-2.5">
          {list.map((i) => {
            const rec = reconcileInvoice(i, wf.lines, wf.hours, wf.rates);
            const dup = duplicateInvoices(i, wf.invoices).length > 0;
            const overdue = i.due_date && i.due_date < todayKey() && i.status !== "paid";
            return (
              <li key={i.id}>
                <Link to={`/workforce/invoices/${i.id}`} className="focus-ring block rounded-xl border border-line bg-surface shadow-card p-3 transition-colors hover:border-line-strong">
                  <div className="flex flex-col gap-2 rounded-lg border border-line bg-raised px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-ink">#{i.invoice_number}</span>
                        <MetaPill meta={INVOICE_STATUS} value={i.status} />
                        {dup && <Pill tone="amber">Possible duplicate</Pill>}
                        {rec.differences > 0 && <Pill tone="red">{rec.differences} difference(s)</Pill>}
                        {overdue && <Pill tone="red">Overdue</Pill>}
                      </div>
                      <div className="mt-0.5 text-xs text-ink-3">
                        {wf.agencyById.get(i.agency_id)?.name} · {i.period_start ? `${fmtDate(i.period_start)} – ${fmtDate(i.period_end)}` : "No service period"}
                        {i.due_date && ` · due ${fmtDate(i.due_date)}`}
                      </div>
                    </div>
                    <span className="font-display text-xl font-bold tabular-nums text-ink">{money(Number(i.total))}</span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      <InvoiceDialog open={addOpen} onOpenChange={setAddOpen} invoice={null} />
    </div>
  );
};

export const InvoiceDetail = () => {
  const { id = "" } = useParams();
  const wf = useWorkforce();
  const invoice = wf.invoices.find((i) => i.id === id);
  const [edit, setEdit] = useState<boolean>(false);
  const [lineEdit, setLineEdit] = useState<InvoiceLine | null>(null);
  const [lineAdd, setLineAdd] = useState<boolean>(false);
  const [delLine, setDelLine] = useState<InvoiceLine | null>(null);
  const del = useMutation({
    mutationFn: (l: InvoiceLine) => api.deleteInvoiceLine(l.id),
    onSuccess: () => {
      wf.invalidate("lines");
      setDelLine(null);
      toast.success("Line removed");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't remove."),
  });
  const archive = useMutation({
    mutationFn: () => api.saveInvoice(id, { agency_id: invoice?.agency_id ?? "", invoice_number: invoice?.invoice_number ?? "", archived_at: invoice?.archived_at ? null : new Date().toISOString() }),
    onSuccess: (i) => {
      wf.invalidate("invoices");
      toast.success(i.archived_at ? "Invoice archived" : "Invoice restored");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't update."),
  });
  if (!wf.perms.finance) return <Restricted what="Agency invoice reconciliation" />;
  if (!invoice) return <NotFound embedded />;
  const rec = reconcileInvoice(invoice, wf.lines, wf.hours, wf.rates);
  const dupes = duplicateInvoices(invoice, wf.invoices);
  const agency = wf.agencyById.get(invoice.agency_id);

  const exportPdf = async () => {
    try {
      await api.logEvent("export", "wf_invoices", `Exported reconciliation report for invoice #${invoice.invoice_number}`, { entityId: invoice.id, perm: "finance" });
      downloadBlob(
        await buildPdf({
          title: `Invoice Reconciliation — #${invoice.invoice_number}`,
          subtitle: `${agency?.name ?? ""} · ${invoice.period_start ? `${fmtDate(invoice.period_start)} – ${fmtDate(invoice.period_end)}` : ""}`,
          orgName: wf.user?.orgName ?? "",
          preparedBy: wf.user?.name ?? "",
          landscape: true,
          sections: [
            {
              title: "Summary",
              fields: [
                ["Status", INVOICE_STATUS[invoice.status]?.label ?? invoice.status],
                ["Invoice total", money(rec.invoiceTotal)],
                ["Sum of entered lines", money(rec.linesTotal)],
                ["Expected from app records", rec.expectedTotal === null ? "Incomplete — see unverified lines" : money(rec.expectedTotal)],
                ["Differences requiring review", String(rec.differences)],
                ["Unverified lines", String(rec.unverified)],
                ["Review notes", invoice.review_notes],
                ["Payment (recorded)", invoice.paid_on ? `${fmtDate(invoice.paid_on)} ${invoice.payment_ref}` : "—"],
              ],
            },
            {
              title: "Line comparison (estimates until reconciled)",
              table: {
                head: ["Type", "Worker / placement", "Dates", "Inv. hrs", "Exp. hrs", "Inv. rate", "Exp. rate", "Inv. amount", "Expected", "Diff", "Result / notes"],
                body: rec.checks.map((c) => {
                  const p = c.line.placement_id ? wf.placementById.get(c.line.placement_id) : undefined;
                  return [
                    INVOICE_LINE_TYPE[c.line.line_type] ?? c.line.line_type,
                    p ? `${fullName(wf.workerById.get(p.worker_id) ?? { first_name: "", last_name: "" })} · ${placementPropertyName(p, wf.propertyById)}` : c.line.description,
                    `${c.line.service_start ?? ""} – ${c.line.service_end ?? ""}`,
                    c.line.hours != null ? String(c.line.hours) : "",
                    c.expectedHours != null ? String(c.expectedHours) : "",
                    c.line.rate != null ? money(Number(c.line.rate)) : "",
                    c.expectedRate != null ? money(c.expectedRate) : "",
                    money(Number(c.line.amount)),
                    c.expectedAmount != null ? money(c.expectedAmount) : "",
                    c.amountDiff != null ? money(c.amountDiff) : "",
                    [c.result, ...c.notes].join("; "),
                  ];
                }),
              },
              emptyText: "No lines entered.",
            },
          ],
        }),
        `Invoice_Reconciliation_${invoice.invoice_number.replace(/[^\w-]/g, "_")}_${stamp()}.pdf`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed.");
    }
  };

  return (
    <div>
      <PageHeader
        backTo="/workforce/invoices"
        backLabel="Agency invoices"
        title={`Invoice #${invoice.invoice_number}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <MetaPill meta={INVOICE_STATUS} value={invoice.status} />
            {agency && <Link to={`/workforce/agencies/${agency.id}`} className="text-link hover:underline">{agency.name}</Link>}
            {invoice.archived_at && <Pill tone="slate">Archived</Pill>}
          </span>
        }
        actions={
          <>
            <Button variant="outline" onClick={() => void exportPdf()}>
              <Download />
              Reconciliation PDF
            </Button>
            <Button variant="outline" onClick={() => setEdit(true)}>
              <Pencil />
              Edit / status
            </Button>
            <Button variant="ghost" onClick={() => archive.mutate()}>
              {invoice.archived_at ? <ArchiveRestore /> : <Archive />}
              {invoice.archived_at ? "Restore" : "Archive"}
            </Button>
          </>
        }
      />
      {dupes.length > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-status-follow/50 bg-status-follow/10 px-4 py-3 text-sm text-ink" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-follow" />
          <span>
            Possible duplicate within {agency?.name}:{" "}
            {dupes.map((x, i) => (
              <span key={x.id}>
                {i > 0 && ", "}
                <Link to={`/workforce/invoices/${x.id}`} className="text-link hover:underline">#{x.invoice_number}</Link>
              </span>
            ))}
          </span>
        </div>
      )}
      <div className="space-y-5">
        <SectionCard title="Invoice">
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            <DataTile label="Service period">{invoice.period_start ? `${fmtDate(invoice.period_start)} – ${fmtDate(invoice.period_end)}` : ""}</DataTile>
            <DataTile label="Invoice date">{invoice.invoice_date ? fmtDate(invoice.invoice_date) : ""}</DataTile>
            <DataTile label="Due date">{invoice.due_date ? fmtDate(invoice.due_date) : ""}</DataTile>
            <DataTile label="Invoice total">{money(Number(invoice.total))}</DataTile>
            <DataTile label="Payment (recorded only)">{invoice.paid_on ? `${fmtDate(invoice.paid_on)}${invoice.payment_ref ? ` · ${invoice.payment_ref}` : ""}` : ""}</DataTile>
            <DataTile label="Review notes" className="col-span-2 lg:col-span-3">{invoice.review_notes && <span className="whitespace-pre-line">{invoice.review_notes}</span>}</DataTile>
          </div>
        </SectionCard>

        <SectionCard title="Reconciliation" subtitle="Expected values come from approved hours and effective-dated agency bill rates. All figures are estimates until you approve the invoice.">
          <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            <DataTile label="Invoice total">{money(rec.invoiceTotal)}</DataTile>
            <DataTile label="Sum of lines">
              {money(rec.linesTotal)} {Math.abs(rec.totalDiff) >= 0.01 && <Pill tone="red">{money(rec.totalDiff)} vs total</Pill>}
            </DataTile>
            <DataTile label="Expected (app records)">{rec.expectedTotal === null ? <span className="text-status-follow">Incomplete</span> : money(rec.expectedTotal)}</DataTile>
            <DataTile label="Estimated vs invoiced">
              {rec.expectedTotal === null ? <span className="text-ink-3">Needs all lines verified</span> : diffCell(Math.round((rec.invoicedComparable - rec.expectedTotal) * 100) / 100, (x) => money(x))}
            </DataTile>
          </div>
        </SectionCard>

        <SectionCard
          title={`Line items (${rec.checks.length})`}
          action={
            <Button size="sm" onClick={() => setLineAdd(true)}>
              <Plus />
              Add line
            </Button>
          }
        >
          {rec.checks.length === 0 ? (
            <Empty title="No lines entered" description="Add each invoiced line (hours, rates, fees) manually to compare against app records." />
          ) : (
            <ul className="space-y-2">
              {rec.checks.map((c) => {
                const p = c.line.placement_id ? wf.placementById.get(c.line.placement_id) : undefined;
                return (
                  <li key={c.line.id} className={cn("rounded-lg border bg-raised px-4 py-3", c.result === "difference" ? "border-status-incident/50" : "border-line")}>
                    <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          {c.result === "match" ? (
                            <CheckCircle2 className="h-4 w-4 text-status-clear" />
                          ) : c.result === "difference" ? (
                            <AlertTriangle className="h-4 w-4 text-status-incident-ink" />
                          ) : (
                            <CircleHelp className="h-4 w-4 text-ink-3" />
                          )}
                          <span className="text-sm font-medium text-ink">{INVOICE_LINE_TYPE[c.line.line_type]}</span>
                          <span className="text-sm text-ink-2">
                            {p ? `${fullName(wf.workerById.get(p.worker_id) ?? { first_name: "", last_name: "" })} · ${placementPropertyName(p, wf.propertyById)}` : c.line.description || "Unlinked"}
                          </span>
                        </div>
                        <div className="mt-0.5 text-xs text-ink-3">
                          {c.line.service_start ? `${fmtDate(c.line.service_start)} – ${fmtDate(c.line.service_end)}` : "No service dates"}
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button variant="ghost" size="icon" aria-label="Edit line" onClick={() => setLineEdit(c.line)}>
                          <Pencil />
                        </Button>
                        <Button variant="ghost" size="icon" aria-label="Remove line" onClick={() => setDelLine(c.line)}>
                          <Trash2 />
                        </Button>
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                      {[
                        ["Hours", c.line.hours != null ? String(c.line.hours) : "—", c.expectedHours != null ? String(c.expectedHours) : "—", diffCell(c.hoursDiff, (x) => `${x}h`)],
                        ["Rate", c.line.rate != null ? money(Number(c.line.rate)) : "—", c.expectedRate != null ? money(c.expectedRate) : "—", diffCell(c.rateDiff, (x) => money(x))],
                        ["Amount", money(Number(c.line.amount)), c.expectedAmount != null ? money(c.expectedAmount) : "—", diffCell(c.amountDiff, (x) => money(x))],
                      ].map(([label, inv, exp, diff]) => (
                        <div key={String(label)} className="rounded-md border border-line bg-surface px-2.5 py-2">
                          <div className="text-[11px] uppercase tracking-wider text-ink-3">{label}</div>
                          <div className="text-ink">Invoiced {inv}</div>
                          <div className="text-ink-2">Expected {exp}</div>
                          <div>Diff {diff}</div>
                        </div>
                      ))}
                    </div>
                    {c.notes.length > 0 && (
                      <ul className="mt-2 list-disc pl-5 text-xs text-status-follow">
                        {c.notes.map((n) => (
                          <li key={n}>{n}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>

        <DocumentsPanel ownerType="invoice" ownerId={invoice.id} filter={(d) => d.invoice_id === invoice.id} title="Invoice file" />
      </div>
      <InvoiceDialog open={edit} onOpenChange={setEdit} invoice={invoice} />
      <LineDialog
        open={lineAdd || !!lineEdit}
        onOpenChange={(o) => {
          if (!o) {
            setLineAdd(false);
            setLineEdit(null);
          }
        }}
        invoice={invoice}
        line={lineEdit}
      />
      <ConfirmDialog
        open={!!delLine}
        onOpenChange={(o) => !o && setDelLine(null)}
        title="Remove this line?"
        description="The removal is recorded in the audit log."
        confirmLabel="Remove"
        destructive
        busy={del.isPending}
        onConfirm={() => delLine && del.mutate(delLine)}
      />
    </div>
  );
};
