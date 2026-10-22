import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Eye,
  FileText,
  Loader2,
  MoreHorizontal,
  PenLine,
  Receipt,
  RotateCcw,
  ScanText,
  Trash2,
  Upload,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { Card, FieldLabel } from "@/components/fw/primitives";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { CheckField, ConfirmDialog, ErrorBlock, FormDialog, isDate, Pill, SelectField, TextField, toNum } from "@/components/workforce/kit";
import { useOrg } from "@/lib/crm/api";
import { money } from "@/lib/crm/types";
import {
  type Billing,
  type BillingProperty,
  type ClientInvoice,
  deleteInvoice,
  downloadInvoicePdf,
  fetchBilling,
  type InvoiceDraft,
  matchProperty,
  overlapping,
  readInvoicePdf,
  saveInvoice,
  setInvoiceStatus,
} from "@/lib/profit/clientInvoices";
import { friendlyError } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { PdfPreviewDialog } from "@/pages/clients/AgreementPdfEditor";

const hrs = (n: number): string => `${n.toLocaleString("en-US", { maximumFractionDigits: 1 })} h`;
const day = (d: string | null, withYear = false): string => (d ? format(parseISO(d), withYear ? "MMM d, yyyy" : "MMM d") : "—");
/** "2026-10-12T16:00" (org wall clock) → "Oct 12, 4:00 PM". */
const wall = (s: string | null, withYear = false): string => (s ? format(parseISO(s), withYear ? "MMM d, yyyy, h:mm a" : "MMM d, h:mm a") : "—");
/** ISO instant → org wall clock string. */
const zoned = (iso: string, tz: string): string => {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
};
const statusOf = (i: ClientInvoice, today: string): "paid" | "void" | "overdue" | "open" =>
  i.status === "open" && i.due_on && i.due_on < today ? "overdue" : i.status;

const KEY = ["profit", "billing"] as const;

/** Client billing on the Profit page: invoices uploaded from TD business invoicing, what each client owes, and hours not billed yet. */
export const ClientBillingCard = () => {
  const q = useQuery({ queryKey: KEY, queryFn: fetchBilling, refetchInterval: 120_000 });
  const [uploading, setUploading] = useState<boolean>(false);
  const [review, setReview] = useState<ReviewState | null>(null);
  const [viewing, setViewing] = useState<ClientInvoice | null>(null);
  const [showAll, setShowAll] = useState<boolean>(false);
  const d = q.data;

  const totals = useMemo(() => {
    const p = d?.properties ?? [];
    return {
      billed: p.reduce((s, x) => s + x.billed, 0),
      paid: p.reduce((s, x) => s + x.paid, 0),
      outstanding: p.reduce((s, x) => s + x.outstanding, 0),
      overdue: p.reduce((s, x) => s + x.overdue, 0),
    };
  }, [d]);
  const rows = (d?.properties ?? []).filter((p) => p.invoices > 0 || (p.unbilled?.hours ?? 0) > 0 || p.watch_open);

  return (
    <Card className="overflow-hidden">
      <div id="billing" className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 sm:px-6">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold text-ink sm:text-xl">
            <Receipt className="h-5 w-5 text-link" />
            Client billing
          </h2>
          <p className="mt-1 text-sm text-ink-2">Upload the invoices you send from TD. We read them and track what each client owes and what hasn't been billed yet.</p>
        </div>
        <Button onClick={() => setUploading(true)} disabled={!d}>
          <Upload />
          Upload client invoice
        </Button>
      </div>

      {q.isLoading ? (
        <div className="flex items-center gap-2 px-6 py-8 text-sm text-ink-3">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading invoices…
        </div>
      ) : q.isError || !d ? (
        <div className="p-4">
          <ErrorBlock message={friendlyError(q.error)} onRetry={() => void q.refetch()} />
        </div>
      ) : (
        <>
          <div className="mx-5 mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:mx-6 sm:grid-cols-4">
            <Stat label="Billed" value={money(totals.billed, false)} />
            <Stat label="Paid" value={money(totals.paid, false)} tone={totals.paid > 0 ? "text-status-clear" : undefined} />
            <Stat label="Outstanding" value={money(totals.outstanding, false)} />
            <Stat
              label="Overdue"
              value={money(totals.overdue, false)}
              tone={totals.overdue > 0 ? "text-status-incident-ink" : undefined}
            />
          </div>

          {rows.length > 0 && (
            <>
              <SectionLabel>By client</SectionLabel>
              <ul className="divide-y divide-line border-y border-line">
                {rows.map((p) => (
                  <PropertyRow key={p.property_id} p={p} tz={d.tz} />
                ))}
              </ul>
            </>
          )}

          <SectionLabel>Invoices · {d.invoices.length}</SectionLabel>
          {d.invoices.length === 0 ? (
            <button
              type="button"
              onClick={() => setUploading(true)}
              className="focus-ring mx-5 mb-5 flex w-[calc(100%-2.5rem)] flex-col items-center gap-2 rounded-xl border-2 border-dashed border-line-strong bg-raised/40 px-6 py-8 text-center transition-colors hover:border-primary/60 sm:mx-6 sm:w-[calc(100%-3rem)]"
            >
              <FileText className="h-6 w-6 text-link" />
              <span className="text-sm font-medium text-ink">No client invoices yet</span>
              <span className="max-w-md text-xs text-ink-3">Download an invoice PDF from TD business invoicing and drop it here. The client, dates, hours, rate and total fill in automatically.</span>
            </button>
          ) : (
            <>
              <ul className="divide-y divide-line border-t border-line">
                {(showAll ? d.invoices : d.invoices.slice(0, 8)).map((i) => (
                  <InvoiceRow key={i.id} inv={i} today={d.today} onView={() => setViewing(i)} onEdit={() => setReview({ file: null, draft: draftOf(i), editing: i })} />
                ))}
              </ul>
              {d.invoices.length > 8 && (
                <button
                  type="button"
                  onClick={() => setShowAll((v) => !v)}
                  className="focus-ring w-full border-t border-line px-6 py-2.5 text-sm font-medium text-link hover:bg-raised/50"
                >
                  {showAll ? "Show fewer" : `Show all ${d.invoices.length} invoices`}
                </button>
              )}
            </>
          )}
          <div className="h-1" />
        </>
      )}

      {d && (
        <UploadDialog
          open={uploading}
          onOpenChange={setUploading}
          billing={d}
          onReady={(r) => {
            setUploading(false);
            setReview(r);
          }}
        />
      )}
      {review && d && <ReviewDialog state={review} billing={d} onClose={() => setReview(null)} />}
      <PdfPreviewDialog
        open={!!viewing?.file_path}
        onOpenChange={(v) => !v && setViewing(null)}
        title={viewing ? `Invoice #${viewing.invoice_number}` : ""}
        description={viewing?.property_name ?? viewing?.customer_name ?? undefined}
        fileName={viewing?.file_name || `invoice-${viewing?.invoice_number ?? ""}.pdf`}
        load={() => downloadInvoicePdf(viewing?.file_path ?? "")}
        loadingText="Opening invoice…"
      />
    </Card>
  );
};

const SectionLabel = ({ children }: { children: ReactNode }) => (
  <div className="px-5 pb-2 pt-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-3 sm:px-6">{children}</div>
);

const Stat = ({ label, value, tone }: { label: string; value: string; tone?: string }) => (
  <div className="min-w-0 bg-raised px-4 py-3">
    <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3">{label}</div>
    <div className={cn("truncate font-display text-xl font-bold tabular-nums text-ink", tone)}>{value}</div>
  </div>
);

const Fig = ({ label, value, sub, tone, subTone }: { label: string; value: string; sub?: string; tone?: string; subTone?: string }) => (
  <div className="min-w-0">
    <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3">{label}</div>
    <div className={cn("truncate font-semibold tabular-nums text-ink", tone)}>{value}</div>
    {sub && <div className={cn("truncate text-[11px] text-ink-3", subTone)}>{sub}</div>}
  </div>
);

const PropertyRow = ({ p, tz }: { p: BillingProperty; tz: string }) => {
  const unbilled = p.unbilled?.hours ?? 0;
  const estimate = p.rate != null ? unbilled * p.rate : null;
  return (
    <li className="grid gap-3 px-5 py-4 sm:px-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,2.2fr)] lg:items-center">
      <div className="min-w-0">
        <Link to={`/properties/${p.property_id}`} className="block truncate font-medium text-ink hover:underline">
          {p.name}
        </Link>
        <p className="mt-0.5 text-xs text-ink-3">
          {p.billed_through ? `Billed through ${wall(zoned(p.billed_through, tz))}` : "Not billed yet"}
          {p.invoices > 0 && ` · ${p.invoices} ${p.invoices === 1 ? "invoice" : "invoices"}`}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <Fig label="Billed" value={money(p.billed, false)} sub={p.billed_hours > 0 ? hrs(p.billed_hours) : undefined} />
        <Fig label="Paid" value={money(p.paid, false)} tone={p.paid > 0 ? "text-status-clear" : undefined} />
        <Fig
          label="Owed"
          value={money(p.outstanding, false)}
          sub={p.overdue > 0 ? `${money(p.overdue, false)} overdue` : undefined}
          subTone="text-status-incident-ink"
        />
        <Fig
          label="Not billed yet"
          value={unbilled > 0 ? hrs(unbilled) : "—"}
          tone={unbilled > 0 ? "text-status-follow" : undefined}
          sub={
            unbilled > 0
              ? `${estimate != null ? `≈ ${money(estimate, false)} · ` : ""}since ${p.unbilled_from ? day(zoned(p.unbilled_from, tz).slice(0, 10)) : "start"}`
              : undefined
          }
        />
      </div>
    </li>
  );
};

const STATUS: Record<ReturnType<typeof statusOf>, { label: string; tone: "green" | "amber" | "red" | "slate" }> = {
  paid: { label: "Paid", tone: "green" },
  open: { label: "Awaiting payment", tone: "amber" },
  overdue: { label: "Overdue", tone: "red" },
  void: { label: "Replaced / void", tone: "slate" },
};

const InvoiceRow = ({ inv, today, onView, onEdit }: { inv: ClientInvoice; today: string; onView: () => void; onEdit: () => void }) => {
  const qc = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState<boolean>(false);
  const s = statusOf(inv, today);
  const status = useMutation({
    mutationFn: (next: ClientInvoice["status"]) => setInvoiceStatus(inv.id, next),
    onSuccess: (_r, next) => {
      toast.success(next === "paid" ? `Invoice #${inv.invoice_number} marked paid` : next === "void" ? `Invoice #${inv.invoice_number} marked void` : "Invoice reopened");
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e) => toast.error("Couldn't update the invoice", { description: friendlyError(e) }),
  });
  const del = useMutation({
    mutationFn: () => deleteInvoice(inv.id),
    onSuccess: () => {
      toast.success(`Invoice #${inv.invoice_number} deleted`);
      setConfirmDelete(false);
      void qc.invalidateQueries({ queryKey: KEY });
    },
    onError: (e) => toast.error("Couldn't delete the invoice", { description: friendlyError(e) }),
  });
  const diff = inv.hours != null && inv.worked ? inv.hours - inv.worked.hours : null;

  return (
    <li className={cn("grid gap-3 px-5 py-3.5 sm:px-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,2fr)_auto] lg:items-center", inv.status === "void" && "opacity-60")}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium tabular-nums text-ink">#{inv.invoice_number}</span>
          <Pill tone={STATUS[s].tone}>{STATUS[s].label}</Pill>
        </div>
        <p className="mt-0.5 truncate text-xs text-ink-2">{inv.property_name ?? <span className="text-status-follow">{inv.customer_name || "No property"} · not linked</span>}</p>
        <p className="mt-0.5 text-xs text-ink-3">
          {inv.period_start && inv.period_end ? `${wall(inv.period_start)} – ${wall(inv.period_end, true)}` : `Sent ${day(inv.issued_on, true)}`}
        </p>
      </div>
      <div className="grid grid-cols-3 gap-3 text-sm">
        <Fig label="Total" value={money(inv.amount)} sub={inv.rate != null ? `${money(inv.rate)}/h` : undefined} />
        <Fig
          label="Hours billed"
          value={inv.hours != null ? hrs(inv.hours) : "—"}
          sub={inv.worked ? `${hrs(inv.worked.hours)} on timecards` : undefined}
          subTone={diff != null && Math.abs(diff) >= 1 ? "text-status-follow" : undefined}
        />
        <Fig
          label={inv.status === "paid" ? "Paid" : "Due"}
          value={inv.status === "paid" ? day(inv.paid_on) : day(inv.due_on)}
          tone={s === "overdue" ? "text-status-incident-ink" : undefined}
          sub={`Sent ${day(inv.issued_on)}`}
        />
      </div>
      <div className="flex items-center gap-1.5 justify-self-start lg:justify-self-end">
        {inv.status === "open" && (
          <Button size="sm" variant="outline" disabled={status.isPending} onClick={() => status.mutate("paid")}>
            {status.isPending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
            Mark paid
          </Button>
        )}
        {inv.file_path && (
          <Button size="icon" variant="ghost" className="h-9 w-9" onClick={onView} aria-label={`View invoice ${inv.invoice_number}`}>
            <Eye />
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" className="h-9 w-9" aria-label="More actions">
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="border-line bg-surface text-ink">
            <DropdownMenuItem onSelect={onEdit}>
              <PenLine className="h-4 w-4" /> Edit details
            </DropdownMenuItem>
            {inv.status !== "open" && (
              <DropdownMenuItem onSelect={() => status.mutate("open")}>
                <RotateCcw className="h-4 w-4" /> Mark as awaiting payment
              </DropdownMenuItem>
            )}
            {inv.status !== "void" && (
              <DropdownMenuItem onSelect={() => status.mutate("void")}>
                <XCircle className="h-4 w-4" /> Mark replaced / void
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator className="bg-line" />
            <DropdownMenuItem onSelect={() => setConfirmDelete(true)} className="text-status-incident-ink focus:text-status-incident-ink">
              <Trash2 className="h-4 w-4" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete invoice #${inv.invoice_number}?`}
        description="This removes the invoice and its PDF from the app. It doesn't change anything in TD."
        confirmLabel="Delete"
        destructive
        busy={del.isPending}
        onConfirm={() => del.mutate()}
      />
    </li>
  );
};

// ─── Upload ─────────────────────────────────────────────────────────────────

interface ReviewState {
  file: File | null;
  draft: InvoiceDraft;
  editing?: ClientInvoice;
  recognized?: boolean;
}

const blankDraft = (): InvoiceDraft => ({
  property_id: null,
  invoice_number: "",
  customer_name: "",
  issued_on: "",
  due_on: "",
  period_start: "",
  period_end: "",
  hours: "",
  rate: "",
  amount: "",
  description: "",
  message: "",
  lines: [],
});

const draftOf = (i: ClientInvoice): InvoiceDraft => ({
  id: i.id,
  property_id: i.property_id,
  invoice_number: i.invoice_number,
  customer_name: i.customer_name,
  issued_on: i.issued_on,
  due_on: i.due_on ?? "",
  period_start: i.period_start ?? "",
  period_end: i.period_end ?? "",
  hours: i.hours?.toString() ?? "",
  rate: i.rate?.toString() ?? "",
  amount: i.amount.toString(),
  description: i.description,
  message: i.message,
  lines: i.lines,
});

const MAX_BYTES = 10 * 1024 * 1024;

const UploadDialog = ({
  open,
  onOpenChange,
  billing,
  onReady,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  billing: Billing;
  onReady: (r: ReviewState) => void;
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);

  const read = useMutation({
    mutationFn: (f: File) => readInvoicePdf(f),
    onSuccess: (r, f) => {
      const draft: InvoiceDraft = {
        ...blankDraft(),
        property_id: matchProperty(r.customer_name, billing.properties, billing.invoices),
        invoice_number: r.invoice_number,
        customer_name: r.customer_name,
        issued_on: r.issued_on,
        due_on: r.due_on,
        period_start: r.period_start,
        period_end: r.period_end,
        hours: r.hours?.toString() ?? "",
        rate: r.rate?.toString() ?? "",
        amount: r.amount?.toString() ?? "",
        description: r.description,
        message: r.message,
        lines: r.lines,
      };
      onReady({ file: f, draft, recognized: r.recognized });
    },
    onError: () => setError("We couldn't read this PDF. You can still save it and type in the details."),
  });

  useEffect(() => {
    if (!open) return;
    setError("");
    setFile(null);
    read.reset();
    if (inputRef.current) inputRef.current.value = "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pick = (f: File | undefined) => {
    if (!f) return;
    setError("");
    setFile(f);
    if (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf") return setError("Choose the invoice PDF you downloaded from TD.");
    if (f.size > MAX_BYTES) return setError("This PDF is larger than 10 MB.");
    read.mutate(f);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (!read.isPending) pick(e.dataTransfer.files?.[0]);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !read.isPending && onOpenChange(v)}>
      <DialogContent className="border-line bg-surface text-ink sm:max-w-lg sm:rounded-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanText className="h-5 w-5 text-primary" />
            Upload client invoice
          </DialogTitle>
          <DialogDescription>Drop the invoice PDF you downloaded from TD. We'll fill in the details for you to check before anything is saved.</DialogDescription>
        </DialogHeader>

        {read.isPending ? (
          <div className="flex items-center gap-3 rounded-xl border border-line bg-raised p-5" role="status" aria-live="polite">
            <div className="relative grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-primary/10">
              <FileText className="h-5 w-5 text-primary" />
              <span className="absolute inset-x-1 top-1 h-0.5 animate-[scanline_1.6s_ease-in-out_infinite] rounded-full bg-primary shadow-[0_0_8px] shadow-primary" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-ink">{file?.name}</div>
              <div className="text-xs text-ink-3">Reading the invoice…</div>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn(
              "focus-ring group flex w-full flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-9 text-center transition-colors",
              dragging ? "border-primary bg-primary/10" : "border-line-strong bg-raised hover:border-primary/60 hover:bg-raised-hover",
            )}
          >
            <span className="grid h-12 w-12 place-items-center rounded-full bg-primary/10 transition-transform group-hover:scale-105">
              <Upload className="h-5 w-5 text-primary" />
            </span>
            <span className="text-sm font-medium text-ink">{dragging ? "Drop to read it" : "Drop the invoice PDF here, or click to choose"}</span>
            <span className="text-xs text-ink-3">PDF from TD business invoicing · up to 10 MB</span>
          </button>
        )}
        <input ref={inputRef} type="file" accept="application/pdf,.pdf" className="sr-only" tabIndex={-1} onChange={(e) => pick(e.target.files?.[0])} />

        {error && !read.isPending && (
          <div className="space-y-3 rounded-lg border border-status-follow/50 bg-status-follow/10 px-3.5 py-3 text-sm text-ink" role="alert">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-follow" />
              <span>{error}</span>
            </div>
            {file && /\.pdf$/i.test(file.name) && file.size <= MAX_BYTES && (
              <Button type="button" variant="outline" size="sm" onClick={() => onReady({ file, draft: blankDraft(), recognized: false })}>
                <PenLine />
                Enter details myself and save this PDF
              </Button>
            )}
          </div>
        )}
        {!read.isPending && !error && (
          <button
            type="button"
            className="focus-ring self-start text-xs font-medium text-link hover:underline"
            onClick={() => onReady({ file: null, draft: blankDraft(), recognized: false })}
          >
            No PDF? Enter an invoice by hand
          </button>
        )}
      </DialogContent>
    </Dialog>
  );
};

// ─── Review & save ──────────────────────────────────────────────────────────

const ReviewDialog = ({ state, billing, onClose }: { state: ReviewState; billing: Billing; onClose: () => void }) => {
  const qc = useQueryClient();
  const { orgId } = useOrg();
  const [d, setD] = useState<InvoiceDraft>(state.draft);
  const [tried, setTried] = useState<boolean>(false);
  const set = <K extends keyof InvoiceDraft>(k: K, v: InvoiceDraft[K]) => setD((x) => ({ ...x, [k]: v }));

  const overlaps = overlapping(billing.invoices, d.property_id, d.period_start, d.period_end, d.id);
  const replacesHint = /replac|consolidat|supersede/i.test(`${d.message} ${d.description}`);
  const [replace, setReplace] = useState<boolean>(replacesHint);

  const num = (v: string) => toNum(v.replace(/[$,\s]/g, ""));
  const hours = num(d.hours);
  const rate = num(d.rate);
  const amount = num(d.amount);
  const calc = hours != null && rate != null ? Math.round(hours * rate * 100) / 100 : null;
  const mismatch = calc != null && amount != null && Math.abs(calc - amount) >= 0.01;
  const dupe = billing.invoices.find((i) => i.id !== d.id && i.invoice_number.trim().toLowerCase() === d.invoice_number.trim().toLowerCase());

  const errors = {
    invoice_number: !d.invoice_number.trim() ? "Enter the invoice number." : dupe ? `Invoice #${dupe.invoice_number} is already on file.` : "",
    issued_on: !isDate(d.issued_on) ? "Enter the invoice date." : "",
    amount: amount == null || amount < 0 ? "Enter the invoice total." : "",
    period: d.period_start && d.period_end && d.period_end <= d.period_start ? "The service period must end after it starts." : "",
  };
  const valid = !Object.values(errors).some(Boolean);

  const save = useMutation({
    mutationFn: () =>
      saveInvoice(
        orgId,
        { ...d, invoice_number: d.invoice_number.trim(), amount: String(amount ?? ""), hours: hours?.toString() ?? "", rate: rate?.toString() ?? "" },
        state.file,
        replace ? overlaps.filter((o) => o.status === "open").map((o) => o.id) : [],
      ),
    onSuccess: () => {
      const prop = billing.properties.find((p) => p.property_id === d.property_id)?.name;
      toast.success(state.editing ? `Invoice #${d.invoice_number} updated` : `Invoice #${d.invoice_number} saved`, {
        description: prop ? `${money(amount)} billed to ${prop}` : undefined,
      });
      void qc.invalidateQueries({ queryKey: KEY });
      onClose();
    },
    onError: (e) => toast.error("Couldn't save the invoice", { description: friendlyError(e) }),
  });

  const submit = () => {
    setTried(true);
    if (valid) save.mutate();
  };
  const err = (k: keyof typeof errors) => (tried ? errors[k] : "") || undefined;

  return (
    <FormDialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={state.editing ? `Edit invoice #${state.editing.invoice_number}` : "Check the invoice"}
      description={
        state.editing
          ? undefined
          : state.file && state.recognized
            ? "We filled these in from the PDF. Check them, pick the property, and save."
            : state.file
              ? "We couldn't read every detail from this PDF. Fill in what's missing."
              : "Enter the invoice details."
      }
      dirty={!state.editing || JSON.stringify(d) !== JSON.stringify(state.draft)}
      saving={save.isPending}
      onSubmit={submit}
      submitLabel={state.editing ? "Save changes" : "Save invoice"}
      wide
    >
      {state.file && (
        <div className="flex items-center gap-3 rounded-lg border border-line bg-raised px-3.5 py-2.5 text-sm">
          <FileText className="h-4 w-4 shrink-0 text-link" />
          <span className="min-w-0 flex-1 truncate text-ink">{state.file.name}</span>
          {state.recognized && (
            <span className="flex items-center gap-1 text-xs text-status-clear">
              <CheckCircle2 className="h-3.5 w-3.5" /> Read automatically
            </span>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Property"
          value={d.property_id ?? ""}
          onChange={(v) => set("property_id", v || null)}
          options={billing.properties.map((p) => ({ value: p.property_id, label: p.name }))}
          allowNone
          noneLabel="Not linked to a property"
          hint={d.customer_name ? `Customer on invoice: ${d.customer_name}` : undefined}
        />
        <TextField label="Invoice #" value={d.invoice_number} onChange={(v) => set("invoice_number", v)} required error={err("invoice_number")} maxLength={60} />
        <TextField label="Invoice date" type="date" value={d.issued_on} onChange={(v) => set("issued_on", v)} required error={err("issued_on")} />
        <TextField label="Due date" type="date" value={d.due_on} onChange={(v) => set("due_on", v)} />
        <div>
          <FieldLabel htmlFor="inv-from">Service from</FieldLabel>
          <Input id="inv-from" type="datetime-local" value={d.period_start} onChange={(e) => set("period_start", e.target.value)} />
        </div>
        <div>
          <FieldLabel htmlFor="inv-to">Service through</FieldLabel>
          <Input id="inv-to" type="datetime-local" value={d.period_end} min={d.period_start || undefined} onChange={(e) => set("period_end", e.target.value)} />
          {err("period") && <p className="mt-1.5 text-sm text-status-incident-ink">{err("period")}</p>}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <TextField label="Hours billed" value={d.hours} onChange={(v) => set("hours", v)} inputMode="decimal" maxLength={12} />
        <TextField label="Rate per hour" value={d.rate} onChange={(v) => set("rate", v)} inputMode="decimal" maxLength={12} placeholder="$" />
        <TextField label="Invoice total" value={d.amount} onChange={(v) => set("amount", v)} inputMode="decimal" required error={err("amount")} maxLength={14} placeholder="$" />
      </div>
      {mismatch && (
        <p className="-mt-2 flex items-start gap-2 text-xs text-status-follow">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {hrs(hours ?? 0)} × {money(rate)} = {money(calc)}, which doesn't match the total. That's fine if the invoice has other charges.
        </p>
      )}

      {overlaps.length > 0 && (
        <div className="rounded-lg border border-status-follow/40 bg-status-follow/[0.07] px-3.5 py-3 text-sm text-ink-2">
          <div className="flex items-start gap-2">
            <Clock className="mt-0.5 h-4 w-4 shrink-0 text-status-follow" />
            <span>
              This service period overlaps{" "}
              {overlaps.map((o) => `#${o.invoice_number} (${money(o.amount, false)})`).join(", ")} at this property.
            </span>
          </div>
          {overlaps.some((o) => o.status === "open") && (
            <div className="mt-3">
            <CheckField
              label="This invoice replaces those (mark them replaced / void)"
              checked={replace}
              onChange={setReplace}
              hint={replacesHint ? "The invoice message says it replaces earlier invoices." : "Leave unticked if both invoices should count."}
            />
            </div>
          )}
        </div>
      )}

      {(d.description || d.message) && (
        <details className="rounded-lg border border-line bg-raised/40 px-3.5 py-2.5 text-sm">
          <summary className="cursor-pointer text-ink-2">Description and message from the invoice</summary>
          {d.description && <p className="mt-2 text-ink-2">{d.description}</p>}
          {d.message && <p className="mt-2 text-ink-3">{d.message}</p>}
        </details>
      )}
    </FormDialog>
  );
};
