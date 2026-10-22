import { addDays, format } from "date-fns";
import { Check, Copy, Loader2, Mail, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AreaField, ConfirmDialog, FormDialog, SelectField, TextField, isDate, toNum } from "@/components/workforce/kit";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { COVERAGE_OPTIONS, type Coverage, type CrmContact, type CrmQuote, type CrmSettings, money, weeklyHours } from "@/lib/crm/types";
import { cn } from "@/lib/utils";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* -------------------------------- Quote -------------------------------- */

export interface QuoteDraft {
  id?: string;
  coverage: Coverage;
  hours: string;
  rate: string;
  minimum: string;
  start: string;
  end: string;
  schedule: string;
  terms: string;
  notes: string;
  validUntil: string;
}

export const quoteDraftFrom = (q: CrmQuote): QuoteDraft => ({
  id: q.id,
  coverage: q.coverage,
  hours: String(q.hours_per_week),
  rate: String(q.hourly_rate),
  minimum: q.minimum_hours != null ? String(q.minimum_hours) : "",
  start: q.start_date ?? "",
  end: q.end_date ?? "",
  schedule: q.schedule,
  terms: q.payment_terms,
  notes: q.notes,
  validUntil: q.valid_until ?? "",
});

export const newQuoteDraft = (opts: {
  coverage: Coverage;
  hoursPerWeek: number | null;
  rate: number | null;
  start: string | null;
  end: string | null;
  settings: CrmSettings;
}): QuoteDraft => ({
  coverage: opts.coverage,
  hours: String(weeklyHours(opts.coverage, opts.hoursPerWeek) || ""),
  rate: opts.rate != null ? String(opts.rate) : opts.settings.default_rate != null ? String(opts.settings.default_rate) : "",
  minimum: "4",
  start: opts.start ?? "",
  end: opts.end ?? "",
  schedule:
    opts.coverage === "24_7" ? "Continuous coverage, 24 hours a day" : opts.coverage === "12_day" ? "Daily, 7:00 AM – 7:00 PM" : opts.coverage === "12_night" ? "Nightly, 7:00 PM – 7:00 AM" : "",
  terms: opts.settings.payment_terms || "Net 15",
  notes: "",
  validUntil: format(addDays(new Date(), opts.settings.quote_valid_days || 14), "yyyy-MM-dd"),
});

export const QuoteDialog = ({
  open,
  onOpenChange,
  initial,
  onSave,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial: QuoteDraft | null;
  onSave: (d: QuoteDraft) => Promise<void>;
}) => {
  const [d, setD] = useState<QuoteDraft | null>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) {
      setD(initial);
      setErrors({});
    }
  }, [open, initial]);
  if (!d) return null;
  const set = <K extends keyof QuoteDraft>(k: K, v: QuoteDraft[K]) =>
    setD((p) => {
      if (!p) return p;
      const next = { ...p, [k]: v };
      if (k === "coverage" && v !== "custom") next.hours = String(weeklyHours(v as string, null));
      return next;
    });
  const hours = toNum(d.hours) ?? 0;
  const rate = toNum(d.rate);
  const submit = async () => {
    const e: Record<string, string> = {};
    if (!(hours > 0 && hours <= 168)) e.hours = "Between 1 and 168 hours.";
    if (rate == null || rate < 0) e.rate = "Enter the hourly rate.";
    if (d.minimum && (toNum(d.minimum) == null || (toNum(d.minimum) ?? 0) < 0)) e.minimum = "Enter a number of hours.";
    if (d.start && !isDate(d.start)) e.start = "Use a valid date.";
    if (d.end && !isDate(d.end)) e.end = "Use a valid date.";
    if (d.start && d.end && d.end < d.start) e.end = "End is before start.";
    if (d.validUntil && !isDate(d.validUntil)) e.validUntil = "Use a valid date.";
    setErrors(e);
    if (Object.keys(e).length) return;
    setSaving(true);
    try {
      await onSave(d);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={d.id ? "Edit quote" : "New quote"}
      description="One coverage per quote. The client sees the rate, weekly hours and weekly estimate."
      dirty={JSON.stringify(d) !== JSON.stringify(initial)}
      saving={saving}
      onSubmit={() => void submit()}
      submitLabel={d.id ? "Save quote" : "Create quote"}
      wide
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <SelectField label="Coverage" value={d.coverage} onChange={(v) => set("coverage", v as Coverage)} options={COVERAGE_OPTIONS} />
        <TextField label="Hours per week" value={d.hours} onChange={(v) => set("hours", v)} inputMode="decimal" required error={errors.hours} disabled={d.coverage !== "custom"} />
        <TextField label="Hourly rate ($)" value={d.rate} onChange={(v) => set("rate", v)} inputMode="decimal" required error={errors.rate} />
      </div>
      <div className="flex items-center justify-between rounded-lg border border-line bg-raised px-4 py-3">
        <span className="text-sm text-ink-2">Weekly estimate</span>
        <span className="font-mono text-lg font-semibold tabular-nums text-ink">{rate != null && hours > 0 ? money(rate * hours) : "—"}</span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Schedule" value={d.schedule} onChange={(v) => set("schedule", v)} placeholder="e.g. Nightly, 7:00 PM – 7:00 AM" />
        <TextField label="Minimum hours" value={d.minimum} onChange={(v) => set("minimum", v)} inputMode="decimal" error={errors.minimum} />
        <TextField label="Start date" type="date" value={d.start} onChange={(v) => set("start", v)} error={errors.start} />
        <TextField label="End date" type="date" value={d.end} onChange={(v) => set("end", v)} error={errors.end} hint="Blank = until systems are restored." />
        <TextField label="Payment terms" value={d.terms} onChange={(v) => set("terms", v)} />
        <TextField label="Valid until" type="date" value={d.validUntil} onChange={(v) => set("validUntil", v)} error={errors.validUntil} />
      </div>
      <AreaField label="Notes for the client" value={d.notes} onChange={(v) => set("notes", v)} rows={3} />
    </FormDialog>
  );
};

/* -------------------------------- Send --------------------------------- */

export const SendDialog = ({
  open,
  onOpenChange,
  title,
  description,
  contacts,
  defaultTo,
  defaultName,
  submitLabel,
  onSend,
  messagePlaceholder,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description: string;
  contacts: CrmContact[];
  defaultTo: string;
  defaultName: string;
  submitLabel: string;
  messagePlaceholder: string;
  onSend: (v: { to: string; name: string; message: string }) => Promise<void>;
}) => {
  const [to, setTo] = useState(defaultTo);
  const [name, setName] = useState(defaultName);
  const [message, setMessage] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (open) {
      setTo(defaultTo);
      setName(defaultName);
      setMessage("");
      setErr("");
    }
  }, [open, defaultTo, defaultName]);
  const withEmail = contacts.filter((c) => c.email);
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      dirty={message.trim() !== "" || to !== defaultTo}
      saving={saving}
      submitLabel={submitLabel}
      onSubmit={() => {
        if (!EMAIL.test(to.trim())) {
          setErr("Enter the recipient's email.");
          return;
        }
        setErr("");
        setSaving(true);
        onSend({ to: to.trim().toLowerCase(), name: name.trim(), message: message.trim() })
          .then(() => onOpenChange(false))
          .catch(() => undefined)
          .finally(() => setSaving(false));
      }}
    >
      {withEmail.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {withEmail.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                setTo(c.email);
                setName(c.name);
              }}
              className={cn(
                "focus-ring rounded-full border px-3 py-1 text-xs transition-colors",
                to === c.email ? "border-primary bg-primary/15 text-ink" : "border-line text-ink-2 hover:border-line-strong hover:text-ink",
              )}
            >
              {c.name} · {c.email}
            </button>
          ))}
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Send to (email)" value={to} onChange={setTo} type="email" inputMode="email" required error={err} />
        <TextField label="Recipient name" value={name} onChange={setName} />
      </div>
      <AreaField label="Message (optional)" value={message} onChange={setMessage} rows={4} placeholder={messagePlaceholder} />
    </FormDialog>
  );
};

/* ------------------------------- Accept -------------------------------- */

export const AcceptDialog = ({
  open,
  onOpenChange,
  quoteNumber,
  defaultBy,
  onAccept,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  quoteNumber: number;
  defaultBy: string;
  onAccept: (by: string, note: string) => Promise<void>;
}) => {
  const [by, setBy] = useState(defaultBy);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setBy(defaultBy);
      setNote("");
    }
  }, [open, defaultBy]);
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Mark Q-${quoteNumber} accepted?`}
      description="Record who accepted and how (phone, email reply…). You can then draft the contract from this quote."
      confirmLabel="Mark accepted"
      busy={busy}
      onConfirm={() => {
        setBusy(true);
        onAccept(by.trim(), note.trim())
          .then(() => onOpenChange(false))
          .catch(() => undefined)
          .finally(() => setBusy(false));
      }}
    >
      <div className="grid gap-3">
        <TextField label="Accepted by" value={by} onChange={setBy} placeholder="Client contact name" />
        <TextField label="Note" value={note} onChange={setNote} placeholder="e.g. Approved by phone" />
      </div>
    </ConfirmDialog>
  );
};

/* ------------------------------ Contract ------------------------------- */

export const ContractEditor = ({
  open,
  onOpenChange,
  initialTitle,
  initialBody,
  regenerate,
  onSave,
  warnSent,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialTitle: string;
  initialBody: string;
  regenerate: () => string;
  onSave: (title: string, body: string) => Promise<void>;
  warnSent?: boolean;
}) => {
  const [title, setTitle] = useState(initialTitle);
  const [body, setBody] = useState(initialBody);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (open) {
      setTitle(initialTitle);
      setBody(initialBody);
      setErr("");
    }
  }, [open, initialTitle, initialBody]);
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Edit agreement"
      description={
        warnSent
          ? "This agreement was already sent. Saving changes cancels the old signing link — you'll need to send it again."
          : "Blank lines separate paragraphs. Start a line with # or ## for a heading."
      }
      dirty={title !== initialTitle || body !== initialBody}
      saving={saving}
      wide
      submitLabel="Save agreement"
      footerExtra={
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setBody(regenerate());
            toast.message("Rebuilt from your template with the latest quote details");
          }}
        >
          <RotateCcw />
          Rebuild from template
        </Button>
      }
      onSubmit={() => {
        if (!title.trim()) return setErr("Add a title.");
        if (!body.trim()) return setErr("The agreement can't be empty.");
        setSaving(true);
        onSave(title.trim(), body)
          .then(() => onOpenChange(false))
          .catch(() => undefined)
          .finally(() => setSaving(false));
      }}
    >
      <TextField label="Title" value={title} onChange={setTitle} required error={err && !title.trim() ? err : undefined} />
      <div>
        <label htmlFor="contract-body" className="mb-1.5 block text-sm font-medium text-ink">
          Agreement text
        </label>
        <textarea
          id="contract-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={60000}
          className="focus-ring min-h-[46vh] w-full rounded-lg border border-line-strong bg-field px-3.5 py-3 font-mono text-[13px] leading-relaxed text-ink"
        />
        {err && title.trim() && <p className="mt-1.5 text-sm text-status-incident-ink">{err}</p>}
      </div>
    </FormDialog>
  );
};

export const ReasonDialog = ({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  label,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  label: string;
  onConfirm: (reason: string) => Promise<void>;
}) => {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setReason("");
  }, [open]);
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      destructive
      busy={busy}
      onConfirm={() => {
        setBusy(true);
        onConfirm(reason.trim())
          .then(() => onOpenChange(false))
          .catch(() => undefined)
          .finally(() => setBusy(false));
      }}
    >
      <TextField label={label} value={reason} onChange={setReason} />
    </ConfirmDialog>
  );
};

export const LinkResultDialog = ({
  result,
  onClose,
  tz,
}: {
  result: { link: string; emailed: boolean; email_error: string | null; expires_at: string; to: string } | null;
  onClose: () => void;
  tz: string;
}) => {
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [result]);
  const copy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.link);
      setCopied(true);
    } catch {
      toast.error("Couldn't copy — select the link and copy it manually.");
    }
  };
  return (
    <Dialog open={!!result} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="border-line bg-surface text-ink sm:max-w-lg sm:rounded-xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">{result?.emailed ? "Sent for signature" : "Signing link ready"}</DialogTitle>
          <DialogDescription className="text-ink-2">
            {result?.emailed ? (
              <>
                <Mail className="mr-1 inline h-4 w-4 text-status-clear" />
                Emailed to {result.to}. You can also share the link below.
              </>
            ) : (
              <>The email couldn't be delivered{result?.email_error ? ` (${result.email_error})` : ""}. Copy the link and send it to the client yourself — it works the same way.</>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input readOnly value={result?.link ?? ""} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" aria-label="Signing link" />
          <Button type="button" variant="outline" onClick={() => void copy()}>
            {copied ? <Check /> : <Copy />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <p className="text-xs text-ink-3">
          For security this link is shown only now. It expires{" "}
          {result ? new Date(result.expires_at).toLocaleString("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }) : ""}.
          Sending again issues a new link and cancels this one.
        </p>
        <div className="flex justify-end">
          <Button onClick={onClose}>Done</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export const Spinner = () => <Loader2 className="h-4 w-4 animate-spin" />;
