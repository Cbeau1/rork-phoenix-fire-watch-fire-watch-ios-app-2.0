import { useMutation, useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { AlertTriangle, Archive, ArchiveRestore, BadgeCheck, CalendarClock, Download, FileStack, Flame, Info, Paperclip, Receipt, Wallet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { PageHeader } from "@/components/fw/primitives";
import { Button } from "@/components/ui/button";
import { DocumentsPanel } from "@/components/workforce/DocumentsPanel";
import { AreaField, fmtDate, FormDialog, isDate, MetaPill, Pill, SelectField, TextField } from "@/components/workforce/kit";
import { TimeCardPacketDialog } from "@/components/workforce/TimeCardPacket";
import { ShiftTicketsDialog, useEntryTickets } from "@/components/workforce/TimeTickets";
import { timeOfDay } from "@/lib/format";
import { fmtHours, loadEntriesByIds, type TimeEntry } from "@/lib/timeclock";
import { cn } from "@/lib/utils";
import * as api from "@/lib/workforce/api";
import { AUTO_INVOICE_STATUS, autoSummary, fullName, invoiceSchedule, money, type Agency, type Invoice, type InvoiceLine } from "@/lib/workforce/constants";
import { todayKey } from "@/lib/workforce/derive";
import { buildPdf, downloadBlob, type PdfCell, type PdfSection } from "@/lib/workforce/exports";
import { useWorkforce } from "@/state/WorkforceProvider";

/** "Oct 12 – Oct 18, 2026" */
export const weekRange = (i: Pick<Invoice, "period_start" | "period_end">): string => {
  if (!i.period_start) return "";
  const s = parseISO(i.period_start);
  const e = parseISO(i.period_end ?? i.period_start);
  return `${format(s, "MMM d")} – ${format(e, s.getFullYear() === e.getFullYear() ? "MMM d, yyyy" : "MMM d, yyyy")}`;
};

/**
 * Keeps the weekly agency invoices current whenever an admin opens Invoices. The server also refreshes them
 * live on every clock/approval change and hourly, so this is just a belt-and-braces catch-up.
 */
export const useAgencyInvoiceSync = () => {
  const wf = useWorkforce();
  const { invalidate } = wf;
  const q = useQuery({
    queryKey: ["wf-invoice-sync", wf.orgId],
    enabled: wf.perms.finance && !!wf.orgId,
    staleTime: 60_000,
    retry: 1,
    queryFn: () => api.syncAgencyInvoices(),
  });
  useEffect(() => {
    if (q.dataUpdatedAt > 0) invalidate("invoices", "lines");
  }, [q.dataUpdatedAt, invalidate]);
  return q;
};

interface ShiftRow {
  key: string;
  entry: TimeEntry | null;
  day: string;
  when: string;
  site: string;
  regH: number;
  otH: number;
  rate: number | null;
  otRate: number | null;
  amount: number;
  sortKey: string;
}

interface WorkerGroup {
  key: string;
  workerId: string | null;
  name: string;
  rate: number | null;
  otRate: number | null;
  rows: ShiftRow[];
  regH: number;
  otH: number;
  amount: number;
}

/** Server-written line description: "Name — Mon Oct 12, 6:00 PM – Tue 2:00 AM · Site (overtime)" */
const parseLine = (desc: string) => {
  const [name, rest = ""] = desc.split(" — ");
  const [when, ...site] = rest.replace(/ \(overtime\)$/, "").split(" · ");
  return { name: name.trim(), when: when.trim(), site: site.join(" · ") };
};

const round2 = (n: number): number => Math.round(n * 100) / 100;

const buildGroups = (
  lines: InvoiceLine[],
  entries: Map<string, TimeEntry>,
  workerName: (id: string | null, fallback: string) => string,
  siteName: (id: string | null) => string,
): WorkerGroup[] => {
  const groups = new Map<string, WorkerGroup>();
  const rowsByKey = new Map<string, ShiftRow>();
  for (const l of lines) {
    const parsed = parseLine(l.description);
    const gKey = l.worker_id ?? `name:${parsed.name}`;
    let g = groups.get(gKey);
    if (!g) {
      g = { key: gKey, workerId: l.worker_id, name: workerName(l.worker_id, parsed.name), rate: null, otRate: null, rows: [], regH: 0, otH: 0, amount: 0 };
      groups.set(gKey, g);
    }
    const rKey = l.time_entry_id ?? l.id;
    let row = rowsByKey.get(rKey);
    if (!row) {
      const entry = l.time_entry_id ? (entries.get(l.time_entry_id) ?? null) : null;
      row = {
        key: rKey,
        entry,
        day: entry ? format(new Date(entry.clockIn), "EEE MMM d") : parsed.when.split(",")[0] ?? "",
        when: entry ? `${timeOfDay(entry.clockIn)} – ${entry.clockOut ? timeOfDay(entry.clockOut) : "now"}` : parsed.when.split(", ").slice(1).join(", "),
        site: entry?.propertyId ? siteName(entry.propertyId) || parsed.site : parsed.site,
        regH: 0,
        otH: 0,
        rate: null,
        otRate: null,
        amount: 0,
        sortKey: entry?.clockIn ?? `${l.service_start ?? ""} ${l.description}`,
      };
      rowsByKey.set(rKey, row);
      g.rows.push(row);
    }
    const hours = Number(l.hours ?? 0);
    const amount = Number(l.amount);
    const rate = l.rate === null ? null : Number(l.rate);
    if (l.line_type === "overtime") {
      row.otH = round2(row.otH + hours);
      row.otRate = rate;
      g.otH = round2(g.otH + hours);
      g.otRate = rate ?? g.otRate;
    } else {
      row.regH = round2(row.regH + hours);
      row.rate = rate;
      g.regH = round2(g.regH + hours);
      g.rate = rate ?? g.rate;
    }
    row.amount = round2(row.amount + amount);
    g.amount = round2(g.amount + amount);
  }
  const list = [...groups.values()];
  for (const g of list) g.rows.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  return list.sort((a, b) => a.name.localeCompare(b.name));
};

const hrs = (h: number): string => h.toFixed(2);
const rateLabel = (r: number | null): string => (r === null ? "No rate on file" : `${money(r)}/hr`);

const exportInvoicePdf = async (invoice: Invoice, agency: Agency | undefined, groups: WorkerGroup[], orgName: string, preparedBy: string) => {
  const sum = autoSummary(invoice);
  const regAmt = round2(groups.reduce((s, g) => s + g.rows.reduce((t, r) => t + r.regH * (r.rate ?? 0), 0), 0));
  const workerSections: PdfSection[] = groups.map((g) => {
    const body: PdfCell[][] = [];
    const highlight: number[] = [];
    for (const r of g.rows) {
      const [inT, outT] = r.when.split(" – ");
      if (r.regH > 0) body.push([r.day, inT ?? "", outT ?? "", r.site, "Regular", hrs(r.regH), r.rate === null ? "—" : money(r.rate), money(round2(r.regH * (r.rate ?? 0)))]);
      if (r.otH > 0) {
        highlight.push(body.length);
        body.push([r.day, r.regH > 0 ? "" : (inT ?? ""), r.regH > 0 ? "" : (outT ?? ""), r.regH > 0 ? "" : r.site, "Overtime", hrs(r.otH), r.otRate === null ? "—" : money(r.otRate), money(round2(r.otH * (r.otRate ?? 0)))]);
      }
    }
    return {
      title: `${g.name} — ${rateLabel(g.rate)}`,
      table: {
        head: ["Date", "Clock in", "Clock out", "Site", "Type", "Hours", "Rate", "Amount"],
        body,
        highlightRows: highlight,
        numeric: [5, 6, 7],
        foot: [[{ content: `Subtotal — ${g.rows.length} ${g.rows.length === 1 ? "shift" : "shifts"}`, colSpan: 5 }, hrs(round2(g.regH + g.otH)), "", money(g.amount)]],
      },
    };
  });
  const blob = await buildPdf({
    title: `Invoice ${invoice.invoice_number}`,
    subtitle: `${agency?.name ?? "Agency"} · Service week ${weekRange(invoice)}`,
    heading: "Temp staffing invoice",
    orgName,
    preparedBy,
    confidential: false,
    footer: `Built from approved timesheets · OT = over 40 hrs per ${invoiceSchedule(invoice).weekLabelShort} week at 1.5×`,
    sections: [
      {
        title: "Amount due",
        metrics: [
          { label: "Total due", value: money(Number(invoice.total)) },
          { label: "Regular hours", value: fmtHours(sum.regularMin) },
          { label: "Overtime hours", value: fmtHours(sum.overtimeMin) },
          { label: "Due date", value: fmtDate(invoice.due_date) },
        ],
        fields: [
          ["Payable to", agency?.name ?? ""],
          ["Billing contact", [agency?.billing_contact, agency?.billing_email, agency?.billing_phone].filter(Boolean).join(" · ")],
          ["Terms", agency?.payment_terms ?? ""],
          ["Service week", `${weekRange(invoice)} (${invoiceSchedule(invoice).weekLabel})`],
          ["Invoice date", fmtDate(invoice.invoice_date)],
          ["Status", AUTO_INVOICE_STATUS[invoice.status]?.label ?? invoice.status],
          ...(invoice.paid_on ? ([["Paid", `${fmtDate(invoice.paid_on)}${invoice.payment_ref ? ` · ${invoice.payment_ref}` : ""}`]] as [string, string][]) : []),
        ],
      },
      ...workerSections,
      {
        title: "Summary",
        table: {
          head: ["Worker", "Shifts", "Regular hrs", "Overtime hrs", "Rate", "Amount"],
          body: groups.map((g) => [g.name, String(g.rows.length), hrs(g.regH), hrs(g.otH), g.rate === null ? "—" : money(g.rate), money(g.amount)]),
          numeric: [1, 2, 3, 4, 5],
          foot: [
            ["Regular", "", fmtHours(sum.regularMin), "", "", money(regAmt)],
            ["Overtime (1.5×)", "", "", fmtHours(sum.overtimeMin), "", money(round2(Number(invoice.total) - regAmt))],
            ["Total due", String(sum.shifts), fmtHours(sum.regularMin), fmtHours(sum.overtimeMin), "", money(Number(invoice.total))],
          ],
          boldRows: [],
        },
        note: sum.weekClosed ? undefined : "This week is still in progress — totals include approved shifts so far.",
      },
    ],
  });
  downloadBlob(blob, `${(agency?.name ?? "Agency").replace(/[^\w-]/g, "_")}_Invoice_${invoice.invoice_number}.pdf`);
};

const PaymentDialog = ({ open, onOpenChange, invoice, markPaid }: { open: boolean; onOpenChange: (v: boolean) => void; invoice: Invoice; markPaid: boolean }) => {
  const wf = useWorkforce();
  const init = useMemo(
    () => ({
      status: markPaid ? "paid" : invoice.status,
      paid_on: invoice.paid_on ?? (markPaid ? todayKey() : ""),
      payment_ref: invoice.payment_ref ?? "",
      due_date: invoice.due_date ?? "",
      review_notes: invoice.review_notes ?? "",
    }),
    [invoice, markPaid],
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
  const weekOpen = !autoSummary(invoice).weekClosed;
  const save = useMutation({
    mutationFn: () =>
      api.saveInvoice(invoice.id, {
        agency_id: invoice.agency_id,
        invoice_number: invoice.invoice_number,
        status: d.status,
        paid_on: d.status === "paid" ? d.paid_on || todayKey() : null,
        payment_ref: d.payment_ref.trim(),
        due_date: d.due_date || null,
        review_notes: d.review_notes.trim(),
      }),
    onSuccess: (i) => {
      wf.invalidate("invoices");
      toast.success(i.status === "paid" ? "Marked as paid" : "Invoice updated");
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't save."),
  });
  const statuses = Object.entries(AUTO_INVOICE_STATUS).filter(([v]) => v !== "draft" || invoice.status === "draft");
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={markPaid ? `Record payment — ${invoice.invoice_number}` : `Invoice ${invoice.invoice_number}`}
      description="Records the payment in your books only — no money is sent from the app."
      dirty={JSON.stringify(d) !== JSON.stringify(init)}
      saving={save.isPending}
      submitLabel={d.status === "paid" ? "Save payment" : "Save"}
      onSubmit={() => {
        const e: Record<string, string> = {};
        if (d.status === "paid" && d.paid_on && !isDate(d.paid_on)) e.paid_on = "Use a valid date.";
        setErrors(e);
        if (Object.keys(e).length === 0) save.mutate();
      }}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <SelectField label="Status" required value={d.status} onChange={set("status")} options={statuses.map(([value, m]) => ({ value, label: m.label }))} />
        <TextField label="Due date" type="date" value={d.due_date} onChange={set("due_date")} />
        {d.status === "paid" && (
          <>
            <TextField label="Paid on" type="date" value={d.paid_on} onChange={set("paid_on")} error={errors.paid_on} />
            <TextField label="Payment reference" value={d.payment_ref} onChange={set("payment_ref")} placeholder="e.g. Check #1042, ACH" />
          </>
        )}
      </div>
      {d.status === "paid" && weekOpen && (
        <div className="flex items-start gap-2 rounded-lg border border-status-follow/50 bg-status-follow/10 px-3.5 py-2.5 text-sm text-ink" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-follow" />
          This week isn't over yet. Once paid, the invoice is locked — shifts approved later this week won't be added.
        </div>
      )}
      <AreaField label="Notes" value={d.review_notes} onChange={set("review_notes")} rows={2} />
    </FormDialog>
  );
};

const Banner = ({ tone, icon, children }: { tone: "info" | "warn" | "bad" | "good"; icon: React.ReactNode; children: React.ReactNode }) => (
  <div
    className={cn(
      "flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm text-ink",
      tone === "info" && "border-info/40 bg-info/10",
      tone === "warn" && "border-status-follow/50 bg-status-follow/10",
      tone === "bad" && "border-status-incident/50 bg-status-incident/10",
      tone === "good" && "border-status-clear/40 bg-status-clear/10",
    )}
    role={tone === "warn" || tone === "bad" ? "alert" : undefined}
  >
    {icon}
    <div className="min-w-0">{children}</div>
  </div>
);

/** A weekly invoice the app builds from approved temp-agency hours — what you owe the agency for that week. */
export const WeeklyInvoiceDetail = ({ invoice }: { invoice: Invoice }) => {
  const wf = useWorkforce();
  useAgencyInvoiceSync();
  const [payOpen, setPayOpen] = useState<"pay" | "edit" | null>(null);
  const [ticketsFor, setTicketsFor] = useState<{ entry: TimeEntry; name: string } | null>(null);
  const [exporting, setExporting] = useState<boolean>(false);
  const [packetOpen, setPacketOpen] = useState<boolean>(false);
  const sum = autoSummary(invoice);
  const agency = wf.agencyById.get(invoice.agency_id);
  const lines = useMemo(() => wf.lines.filter((l) => l.invoice_id === invoice.id), [wf.lines, invoice.id]);
  const entryIds = useMemo(() => [...new Set(lines.map((l) => l.time_entry_id).filter((x): x is string => !!x))].sort(), [lines]);
  const entriesQ = useQuery({
    queryKey: ["wf", "invoice-entries", invoice.id, entryIds.join(",")],
    enabled: entryIds.length > 0,
    staleTime: 30_000,
    queryFn: () => loadEntriesByIds(entryIds),
  });
  const tickets = useEntryTickets(entryIds, true);
  const groups = useMemo(() => {
    const byId = new Map((entriesQ.data ?? []).map((e) => [e.id, e]));
    return buildGroups(
      lines,
      byId,
      (id, fb) => {
        const w = id ? wf.workerById.get(id) : undefined;
        return w ? fullName(w) : fb;
      },
      (id) => (id ? (wf.propertyById.get(id)?.name ?? "") : ""),
    );
  }, [lines, entriesQ.data, wf.workerById, wf.propertyById]);

  const archive = useMutation({
    mutationFn: () => api.saveInvoice(invoice.id, { agency_id: invoice.agency_id, invoice_number: invoice.invoice_number, archived_at: invoice.archived_at ? null : new Date().toISOString() }),
    onSuccess: (i) => {
      wf.invalidate("invoices");
      toast.success(i.archived_at ? "Invoice archived — it won't update anymore" : "Invoice restored");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't update."),
  });

  const exportPdf = async () => {
    setExporting(true);
    try {
      await api.logEvent("export", "wf_invoices", `Exported weekly invoice ${invoice.invoice_number}`, { entityId: invoice.id, perm: "finance" });
      await exportInvoicePdf(invoice, agency, groups, wf.user?.orgName ?? "", wf.user?.name ?? "");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  };

  const paid = invoice.status === "paid";
  const overtimeAmt = round2(groups.reduce((s, g) => s + g.rows.reduce((t, r) => t + r.otH * (r.otRate ?? 0), 0), 0));
  const regularAmt = round2(Number(invoice.total) - overtimeAmt);
  const overdue = !paid && sum.weekClosed && !!invoice.due_date && invoice.due_date < todayKey();
  const sched = invoiceSchedule(invoice);
  const endLabel = invoice.period_end ? format(parseISO(invoice.period_end), "MMM d") : "";
  const invLabel = invoice.invoice_date ? format(parseISO(invoice.invoice_date), "EEEE, MMM d") : sched.invoiceDay;

  return (
    <div>
      <PageHeader
        backTo="/workforce/invoices"
        backLabel="Agency invoices"
        title={`${agency?.name ?? "Agency"} · Week of ${invoice.period_start ? format(parseISO(invoice.period_start), "MMM d") : ""}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <MetaPill meta={AUTO_INVOICE_STATUS} value={invoice.status} />
            <Pill tone="primary">Auto · weekly</Pill>
            {overdue && <Pill tone="red">Overdue</Pill>}
            {invoice.archived_at && <Pill tone="slate">Archived</Pill>}
            <span className="font-mono text-xs text-ink-3">{invoice.invoice_number}</span>
          </span>
        }
        actions={
          <>
            <Button variant="outline" onClick={() => void exportPdf()} disabled={exporting || groups.length === 0}>
              <Download />
              {exporting ? "Preparing…" : "Invoice PDF"}
            </Button>
            <Button variant="outline" onClick={() => setPacketOpen(true)} disabled={!invoice.period_start}>
              <FileStack />
              Time cards
            </Button>
            {!paid ? (
              <Button onClick={() => setPayOpen("pay")}>
                <Wallet />
                Mark as paid
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setPayOpen("edit")}>
                Edit payment
              </Button>
            )}
            {!paid && (
              <Button variant="ghost" onClick={() => setPayOpen("edit")}>
                Status
              </Button>
            )}
            <Button variant="ghost" onClick={() => archive.mutate()} aria-label={invoice.archived_at ? "Restore" : "Archive"}>
              {invoice.archived_at ? <ArchiveRestore /> : <Archive />}
            </Button>
          </>
        }
      />

      <div className="space-y-5">
        {/* Invoice face */}
        <section className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
          <div className={cn("h-1", paid ? "bg-status-clear" : sum.weekClosed ? "bg-status-follow" : "bg-primary")} />
          <div className="grid gap-6 p-5 sm:p-6 md:grid-cols-[1fr_auto]">
            <div className="min-w-0">
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-3">Pay to</div>
              <div className="mt-1 font-display text-2xl font-bold text-ink">
                {agency ? (
                  <Link to={`/workforce/agencies/${agency.id}`} className="hover:underline">
                    {agency.name}
                  </Link>
                ) : (
                  "Agency"
                )}
              </div>
              <div className="mt-1 text-sm text-ink-2">
                {[agency?.billing_contact, agency?.billing_email, agency?.billing_phone].filter(Boolean).join(" · ") || "No billing contact on file"}
              </div>
              <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm">
                <span className="inline-flex items-center gap-1.5 text-ink-2">
                  <CalendarClock className="h-4 w-4 text-ink-3" />
                  Service week <span className="text-ink">{weekRange(invoice)}</span>
                  <span className="text-ink-3">· {sched.weekLabelShort}</span>
                </span>
                {agency?.payment_terms && (
                  <span className="text-ink-2">
                    Terms <span className="text-ink">{agency.payment_terms}</span>
                  </span>
                )}
              </div>
            </div>
            <div className="md:text-right">
              <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-3">{paid ? "Paid" : sum.weekClosed ? "Amount due" : "Owed so far"}</div>
              <div className="mt-1 font-display text-4xl font-extrabold tabular-nums text-ink">{money(Number(invoice.total))}</div>
              <div className={cn("mt-1 text-sm", overdue ? "font-medium text-status-incident-ink" : "text-ink-2")}>
                {paid ? `Paid ${fmtDate(invoice.paid_on)}${invoice.payment_ref ? ` · ${invoice.payment_ref}` : ""}` : `Due ${fmtDate(invoice.due_date)}`}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-px border-t border-line bg-line lg:grid-cols-4">
            {[
              { label: "Regular hours", value: fmtHours(sum.regularMin), sub: money(regularAmt) },
              { label: "Overtime hours", value: fmtHours(sum.overtimeMin), sub: sum.overtimeMin > 0 ? `${money(overtimeAmt)} at 1.5×` : "None this week", ot: sum.overtimeMin > 0 },
              { label: "Shifts", value: String(sum.shifts), sub: `${sum.workers} ${sum.workers === 1 ? "worker" : "workers"}` },
              {
                label: "Invoice date",
                value: fmtDate(invoice.invoice_date, "MMM d"),
                sub: sum.ready ? `${sched.invoiceDay} · invoiced` : sum.weekClosed ? `Week closed · invoices ${sched.invoiceDay}` : `Week closes ${sched.closesAfter} night`,
              },
            ].map((t) => (
              <div key={t.label} className="bg-surface px-5 py-4">
                <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-ink-3">
                  {t.ot && <Flame className="h-3.5 w-3.5 text-status-follow" />}
                  {t.label}
                </div>
                <div className={cn("mt-1 font-display text-2xl font-bold tabular-nums", t.ot ? "text-status-follow" : "text-ink")}>{t.value}</div>
                <div className="text-xs text-ink-3">{t.sub}</div>
              </div>
            ))}
          </div>
        </section>

        {!sum.weekClosed && !paid && (
          <Banner tone="info" icon={<Info className="mt-0.5 h-4 w-4 shrink-0 text-info-ink" />}>
            This week is still in progress. The invoice updates on its own as shifts are approved, closes after {sched.closesAfter}, {endLabel}, and becomes{" "}
            <strong>Ready to pay</strong> on {invLabel}.
          </Banner>
        )}
        {sum.weekClosed && !sum.ready && !paid && (
          <Banner tone="info" icon={<Info className="mt-0.5 h-4 w-4 shrink-0 text-info-ink" />}>
            This week closed {sched.closesAfter} night. Shifts approved before {invLabel} are still added, and it becomes <strong>Ready to pay</strong> that morning.
          </Banner>
        )}
        {sum.pendingShifts > 0 && !paid && (
          <Banner tone="warn" icon={<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-follow" />}>
            {sum.pendingShifts} {sum.pendingShifts === 1 ? "shift" : "shifts"} ({fmtHours(sum.pendingMin)} hrs) still waiting for approval {sum.pendingShifts === 1 ? "isn't" : "aren't"} on this invoice yet.{" "}
            <Link to="/payroll" className="font-medium text-link hover:underline">
              Review in Payroll
            </Link>
          </Banner>
        )}
        {sum.unpricedMin > 0 && (
          <Banner tone="bad" icon={<AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-incident-ink" />}>
            {fmtHours(sum.unpricedMin)} hrs have no pay rate on file, so they're billed at $0.{" "}
            <Link to="/team" className="font-medium text-link hover:underline">
              Set the rate on Team
            </Link>
          </Banner>
        )}
        {paid && (
          <Banner tone="good" icon={<BadgeCheck className="mt-0.5 h-4 w-4 shrink-0 text-status-clear" />}>
            Paid {fmtDate(invoice.paid_on)}
            {invoice.payment_ref ? ` · ${invoice.payment_ref}` : ""}. This invoice is locked and won't change.
          </Banner>
        )}

        {groups.map((g) => (
          <section key={g.key} className="rounded-xl border border-line bg-surface shadow-card">
            <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
              <div className="min-w-0">
                <h3 className="font-display text-lg font-bold text-ink">
                  {g.workerId ? (
                    <Link to={`/workforce/workers/${g.workerId}`} className="hover:underline">
                      {g.name}
                    </Link>
                  ) : (
                    g.name
                  )}
                </h3>
                <div className="mt-0.5 text-xs text-ink-3">
                  {rateLabel(g.rate)}
                  {g.otRate !== null && ` · OT ${money(g.otRate)}/hr`} · {g.rows.length} {g.rows.length === 1 ? "shift" : "shifts"} · {hrs(round2(g.regH + g.otH))} hrs
                </div>
              </div>
              <div className="text-right">
                <div className="font-display text-xl font-bold tabular-nums text-ink">{money(g.amount)}</div>
                {g.otH > 0 && (
                  <div className="text-xs font-medium text-status-follow">
                    incl. {hrs(g.otH)} OT hrs
                  </div>
                )}
              </div>
            </header>
            <ul className="divide-y divide-line">
              {g.rows.map((r) => {
                const t = r.entry ? (tickets.get(r.entry.id) ?? []) : [];
                return (
                  <li key={r.key} className={cn("relative flex items-center gap-4 px-5 py-3", r.otH > 0 && "bg-status-follow/[0.07]")}>
                    {r.otH > 0 && <span className="absolute inset-y-0 left-0 w-1 bg-status-follow" aria-hidden />}
                    <div className="w-24 shrink-0">
                      <div className="text-sm font-medium text-ink">{r.day}</div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="font-mono text-sm text-ink">{r.when}</div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
                        {r.site && <span className="truncate">{r.site}</span>}
                        {r.otH > 0 && (
                          <Pill tone="amber">
                            <Flame className="h-3 w-3" />
                            {hrs(r.otH)} OT hrs
                          </Pill>
                        )}
                      </div>
                    </div>
                    <div className="hidden w-20 text-right font-mono text-sm tabular-nums text-ink-2 sm:block">{hrs(round2(r.regH + r.otH))} h</div>
                    <div className="w-24 text-right font-mono text-sm font-semibold tabular-nums text-ink">{money(r.amount)}</div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className={cn("shrink-0", t.length > 0 && "text-link")}
                      disabled={!r.entry}
                      aria-label={t.length > 0 ? `${t.length} time ticket(s)` : "Attach time ticket"}
                      onClick={() => r.entry && setTicketsFor({ entry: r.entry, name: g.name })}
                    >
                      <Paperclip />
                      {t.length > 0 && <span className="sr-only">{t.length}</span>}
                    </Button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}

        <section className="rounded-xl border border-line bg-surface p-5 shadow-card">
          <dl className="ml-auto max-w-sm space-y-2 text-sm">
            <div className="flex justify-between text-ink-2">
              <dt>Regular · {fmtHours(sum.regularMin)} hrs</dt>
              <dd className="font-mono tabular-nums">{money(regularAmt)}</dd>
            </div>
            <div className={cn("flex justify-between", sum.overtimeMin > 0 ? "text-status-follow" : "text-ink-2")}>
              <dt>Overtime · {fmtHours(sum.overtimeMin)} hrs at 1.5×</dt>
              <dd className="font-mono tabular-nums">{money(overtimeAmt)}</dd>
            </div>
            <div className="flex items-baseline justify-between border-t border-line pt-2">
              <dt className="font-medium text-ink">{paid ? "Total paid" : "Total due"}</dt>
              <dd className="font-display text-2xl font-bold tabular-nums text-ink">{money(Number(invoice.total))}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-ink-3">
            Built from approved shifts using each worker's pay rate on file. Hours over 40 in a {sched.weekLabel} billing week bill at 1.5×. Compare with {agency?.name ?? "the agency"}'s own invoice and attach it below.
          </p>
        </section>

        <DocumentsPanel ownerType="invoice" ownerId={invoice.id} filter={(d) => d.invoice_id === invoice.id} title={`${agency?.name ?? "Agency"}'s invoice & receipts`} />
      </div>

      <PaymentDialog open={payOpen !== null} onOpenChange={(o) => !o && setPayOpen(null)} invoice={invoice} markPaid={payOpen === "pay"} />
      <TimeCardPacketDialog
        open={packetOpen}
        onOpenChange={setPacketOpen}
        initialFrom={invoice.period_start ?? undefined}
        initialTo={invoice.period_end ?? undefined}
        initialAgencyId={invoice.agency_id}
      />
      <ShiftTicketsDialog entry={ticketsFor?.entry ?? null} personName={ticketsFor?.name ?? ""} tickets={ticketsFor ? (tickets.get(ticketsFor.entry.id) ?? []) : []} onClose={() => setTicketsFor(null)} />
    </div>
  );
};

/** Top of the Invoices page: what's owed to each agency from the weekly auto invoices. */
export const AgencyPayables = ({ invoices }: { invoices: Invoice[] }) => {
  const wf = useWorkforce();
  const rows = useMemo(() => {
    const m = new Map<string, { agencyId: string; ready: Invoice[]; current: Invoice | null; closing: Invoice | null }>();
    for (const i of invoices) {
      if (!i.auto_generated || i.archived_at || i.status === "paid") continue;
      const r = m.get(i.agency_id) ?? { agencyId: i.agency_id, ready: [], current: null, closing: null };
      if (i.status !== "draft") r.ready.push(i);
      else if (autoSummary(i).weekClosed) r.closing = i;
      else r.current = i;
      m.set(i.agency_id, r);
    }
    return [...m.values()];
  }, [invoices]);
  if (rows.length === 0) return null;
  return (
    <div className="mb-5 grid gap-3 md:grid-cols-2">
      {rows.map((r) => {
        const agency = wf.agencyById.get(r.agencyId);
        const due = round2(r.ready.reduce((s, i) => s + Number(i.total), 0));
        const next = [...r.ready].sort((a, b) => (a.due_date ?? "").localeCompare(b.due_date ?? ""))[0];
        return (
          <div key={r.agencyId} className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
            <div className="flex items-start justify-between gap-4 p-5">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.14em] text-ink-3">
                  <Receipt className="h-3.5 w-3.5" />
                  Owed to {agency?.name ?? "agency"}
                </div>
                <div className="mt-1 font-display text-3xl font-extrabold tabular-nums text-ink">{money(due)}</div>
                <div className="text-xs text-ink-2">
                  {r.ready.length === 0
                    ? "Nothing ready to pay yet"
                    : `${r.ready.length} ${r.ready.length === 1 ? "week" : "weeks"} ready to pay${next?.due_date ? ` · next due ${fmtDate(next.due_date, "MMM d")}` : ""}`}
                </div>
              </div>
              {next && (
                <Button asChild size="sm">
                  <Link to={`/workforce/invoices/${next.id}`}>
                    <Wallet />
                    Pay
                  </Link>
                </Button>
              )}
            </div>
            {r.closing && (
              <Link
                to={`/workforce/invoices/${r.closing.id}`}
                className="focus-ring flex items-center justify-between gap-3 border-t border-line bg-raised px-5 py-3 text-sm transition-colors hover:bg-surface-hover"
              >
                <span className="text-ink-2">
                  Closed · <span className="text-ink">{weekRange(r.closing)}</span> · invoices {r.closing.invoice_date ? format(parseISO(r.closing.invoice_date), "EEE MMM d") : ""}
                </span>
                <span className="font-mono font-semibold tabular-nums text-ink">{money(Number(r.closing.total))}</span>
              </Link>
            )}
            {r.current && (
              <Link
                to={`/workforce/invoices/${r.current.id}`}
                className="focus-ring flex items-center justify-between gap-3 border-t border-line bg-raised px-5 py-3 text-sm transition-colors hover:bg-surface-hover"
              >
                <span className="text-ink-2">
                  This week so far · <span className="text-ink">{weekRange(r.current)}</span>
                  {autoSummary(r.current).pendingShifts > 0 && <span className="text-status-follow"> · {autoSummary(r.current).pendingShifts} awaiting approval</span>}
                </span>
                <span className="font-mono font-semibold tabular-nums text-ink">{money(Number(r.current.total))}</span>
              </Link>
            )}
          </div>
        );
      })}
    </div>
  );
};
