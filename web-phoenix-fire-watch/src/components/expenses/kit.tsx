import { useMutation } from "@tanstack/react-query";
import { Archive, Download, Eye, FileText, ImageIcon, Loader2, Paperclip, Upload } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { toast } from "sonner";

import { FieldError, FieldLabel } from "@/components/fw/primitives";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { AreaField, ConfirmDialog, fmtDateTime, Pill } from "@/components/workforce/kit";
import * as api from "@/lib/expenses/api";
import { FLAG, statusMeta, type Attachment, type Direction } from "@/lib/expenses/constants";
import type { DirectionState } from "@/lib/expenses/derive";
import { fmtMoney } from "@/lib/expenses/money";
import { ACCEPT_FILES, checkFile } from "@/lib/workforce/api";
import { cn } from "@/lib/utils";
import { useExpenses } from "@/state/ExpensesProvider";

/** Sub-navigation for every Expenditures screen. */
export const ExNav = () => {
  const { pathname } = useLocation();
  const items = [
    { to: "/expenditures", label: "Overview", match: (p: string) => p === "/expenditures" },
    { to: "/expenditures/records", label: "Records", match: (p: string) => p.startsWith("/expenditures/records") },
    { to: "/expenditures/reimbursements", label: "Reimbursements", match: (p: string) => p.startsWith("/expenditures/reimbursements") },
    { to: "/expenditures/reports", label: "Reports", match: (p: string) => p.startsWith("/expenditures/reports") },
    { to: "/expenditures/settings", label: "Categories & history", match: (p: string) => p.startsWith("/expenditures/settings") },
  ];
  return (
    <nav aria-label="Expenditures" className="-mx-4 mb-6 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <ul className="flex w-max gap-1 rounded-xl border border-line bg-rail/60 p-1">
        {items.map((i) => {
          const active = i.match(pathname);
          return (
            <li key={i.to}>
              <Link
                to={i.to}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "focus-ring block whitespace-nowrap rounded-lg px-3.5 py-2 text-sm font-medium transition-colors",
                  active ? "bg-primary text-white" : "text-ink-2 hover:bg-raised hover:text-ink",
                )}
              >
                {i.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
};

let seq = 0;
/** Currency input that keeps the raw string (parsed to cents only when validating/saving). */
export const MoneyField = ({
  label,
  value,
  onChange,
  currency = "USD",
  required,
  error,
  hint,
  className,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  currency?: string;
  required?: boolean;
  error?: string;
  hint?: string;
  className?: string;
  disabled?: boolean;
}) => {
  const [id] = useState<string>(() => `m-${++seq}`);
  return (
    <div className={className}>
      <FieldLabel htmlFor={id} required={required}>
        {label}
      </FieldLabel>
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center font-mono text-xs text-ink-3">{currency}</span>
        <Input
          id={id}
          inputMode="decimal"
          value={value}
          disabled={disabled}
          placeholder="0.00"
          aria-invalid={!!error}
          aria-required={required}
          className="pl-12 font-mono tabular-nums"
          maxLength={18}
          onChange={(e) => onChange(e.target.value.replace(/[^\d.,$]/g, ""))}
        />
      </div>
      {hint && !error && <p className="mt-1.5 text-xs text-ink-3">{hint}</p>}
      <FieldError message={error} />
    </div>
  );
};

/** Reimbursement / recovery state for one direction of an expenditure. */
export const DirectionBadge = ({ state, dir, compact }: { state: DirectionState; dir: Direction; compact?: boolean }) => {
  const v = state.view;
  if (!v) {
    const f = FLAG[state.flag as keyof typeof FLAG] ?? FLAG.not_applicable;
    return <span className="text-xs text-ink-3">{f.label}</span>;
  }
  const meta = statusMeta(dir)[v.r.status] ?? { label: v.r.status, tone: "slate" as const };
  return (
    <span className="inline-flex flex-col items-start gap-0.5">
      <Pill tone={meta.tone}>{meta.label}</Pill>
      {v.payable && v.remaining > 0 && !compact && (
        <span className="font-mono text-[11px] text-ink-2">{fmtMoney(v.remaining, v.currency)} left</span>
      )}
    </span>
  );
};

export const ReceiptBadge = ({ count }: { count: number }) =>
  count > 0 ? (
    <span className="inline-flex items-center gap-1 text-xs text-status-clear">
      <Paperclip className="h-3.5 w-3.5" />
      {count}
    </span>
  ) : (
    <Pill tone="amber">Missing receipt</Pill>
  );

/** Opens a receipt through a logged 60-second signed link; previews in-app. */
export const useFileViewer = () => {
  const [preview, setPreview] = useState<{ url: string; mime: string; name: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const open = async (a: Attachment, mode: "preview" | "download") => {
    setBusy(a.id + mode);
    try {
      const url = await api.fileUrl(a.id, mode);
      if (mode === "download") {
        const el = document.createElement("a");
        el.href = url;
        el.rel = "noopener";
        document.body.appendChild(el);
        el.click();
        el.remove();
      } else setPreview({ url, mime: a.mime_type, name: a.file_name });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't open the file.");
    } finally {
      setBusy(null);
    }
  };
  const viewer = (
    <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
      <DialogContent className="flex h-[calc(100dvh-2rem)] max-w-5xl flex-col border-line bg-surface p-4 text-ink sm:rounded-xl">
        <DialogHeader>
          <DialogTitle className="truncate pr-8 text-base">{preview?.name}</DialogTitle>
          <DialogDescription className="text-ink-3">Private file · secure link expires in 60 seconds</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-line bg-raised">
          {preview?.mime === "application/pdf" ? (
            <iframe title={preview.name} src={preview.url} className="h-full w-full" />
          ) : preview ? (
            <img src={preview.url} alt={preview.name} className="mx-auto max-h-full max-w-full object-contain" />
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
  return { open, busy, viewer };
};

/** Upload button: validates type/size locally; the server re-checks magic bytes and size. */
export const UploadButton = ({
  target,
  label = "Upload receipt",
  disabled,
  onDone,
}: {
  target: { expenditureId?: string; paymentId?: string };
  label?: string;
  disabled?: boolean;
  onDone?: () => void;
}) => {
  const ex = useExpenses();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const pick = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    let ok = 0;
    for (const f of Array.from(files).slice(0, 10)) {
      const err = checkFile(f);
      if (err) {
        toast.error(`${f.name}: ${err}`);
        continue;
      }
      try {
        await api.uploadFile(f, target);
        ok++;
      } catch (e) {
        toast.error(`${f.name}: ${e instanceof Error ? e.message : "Upload failed."}`);
      }
    }
    setBusy(false);
    if (ref.current) ref.current.value = "";
    if (ok > 0) {
      toast.success(ok === 1 ? "File uploaded" : `${ok} files uploaded`);
      ex.invalidate();
      onDone?.();
    }
  };
  return (
    <>
      <input ref={ref} type="file" accept={ACCEPT_FILES} multiple className="hidden" onChange={(e) => void pick(e.target.files)} />
      <Button type="button" variant="outline" size="sm" disabled={busy || disabled} onClick={() => ref.current?.click()}>
        {busy ? <Loader2 className="animate-spin" /> : <Upload />}
        {busy ? "Uploading…" : label}
      </Button>
    </>
  );
};

export const AttachmentList = ({ items, emptyText, allowArchive = true }: { items: Attachment[]; emptyText: ReactNode; allowArchive?: boolean }) => {
  const ex = useExpenses();
  const { open, busy, viewer } = useFileViewer();
  const [target, setTarget] = useState<Attachment | null>(null);
  const [reason, setReason] = useState<string>("");
  const archive = useMutation({
    mutationFn: () => api.archiveAttachment(target?.id ?? "", reason),
    onSuccess: () => {
      toast.success("File archived");
      setTarget(null);
      setReason("");
      ex.invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Couldn't archive."),
  });
  if (items.length === 0) return <div className="rounded-lg border border-dashed border-line px-4 py-5 text-center text-sm text-ink-2">{emptyText}</div>;
  return (
    <>
      <ul className="space-y-2">
        {items.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-raised px-3.5 py-2.5">
            {a.mime_type === "application/pdf" ? <FileText className="h-5 w-5 shrink-0 text-link" /> : <ImageIcon className="h-5 w-5 shrink-0 text-link" />}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-ink">{a.file_name}</div>
              <div className="text-xs text-ink-3">
                {ex.memberName(a.uploaded_by)} · {fmtDateTime(a.uploaded_at)} · {(a.size_bytes / 1024).toFixed(0)} KB
              </div>
            </div>
            <div className="flex gap-1">
              <Button variant="ghost" size="icon" aria-label={`Preview ${a.file_name}`} onClick={() => void open(a, "preview")} disabled={busy === a.id + "preview"}>
                {busy === a.id + "preview" ? <Loader2 className="animate-spin" /> : <Eye />}
              </Button>
              <Button variant="ghost" size="icon" aria-label={`Download ${a.file_name}`} onClick={() => void open(a, "download")} disabled={busy === a.id + "download"}>
                {busy === a.id + "download" ? <Loader2 className="animate-spin" /> : <Download />}
              </Button>
              {allowArchive && (
                <Button variant="ghost" size="icon" aria-label={`Archive ${a.file_name}`} onClick={() => setTarget(a)}>
                  <Archive />
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {viewer}
      <ConfirmDialog
        open={!!target}
        onOpenChange={(o) => !o && setTarget(null)}
        title="Archive this file?"
        description="It will be hidden from the record but kept in storage and the history log. This can't be undone from the app."
        confirmLabel="Archive file"
        destructive
        busy={archive.isPending}
        disabled={reason.trim().length < 3}
        onConfirm={() => archive.mutate()}
      >
        <AreaField label="Reason" required rows={2} value={reason} onChange={setReason} placeholder="e.g. Wrong receipt uploaded" />
      </ConfirmDialog>
    </>
  );
};

/** Summary metric card that opens the matching records. */
export const MetricCard = ({
  label,
  value,
  sub,
  dot,
  to,
  icon: Icon,
  delay = 0,
}: {
  label: string;
  value: string;
  sub?: string;
  dot: string;
  to: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  delay?: number;
}) => (
  <Link
    to={to}
    className="focus-ring group animate-fade-up rounded-xl border border-line bg-surface shadow-card p-5 transition-colors hover:border-line-strong hover:bg-surface-hover"
    style={{ animationDelay: `${delay}ms` }}
  >
    <div className="flex items-center gap-2.5">
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: dot }} aria-hidden />
      <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-2">{label}</span>
    </div>
    <div className="mt-3 flex items-end justify-between gap-3">
      <span className="break-all font-display text-[28px] font-extrabold leading-tight tabular-nums text-ink sm:text-[32px]">{value}</span>
      <Icon className="h-7 w-7 shrink-0 text-link transition-transform duration-300 group-hover:-translate-y-0.5" strokeWidth={1.6} />
    </div>
    {sub && <div className="mt-1.5 text-xs text-ink-3">{sub}</div>}
  </Link>
);
