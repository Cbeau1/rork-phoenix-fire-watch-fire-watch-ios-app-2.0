import { format, parseISO } from "date-fns";
import { AlertTriangle, Loader2, Lock, RefreshCw, ShieldAlert } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";

import { Card, FieldError, FieldLabel } from "@/components/fw/primitives";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TONE_CLASS, type Tone } from "@/lib/workforce/constants";
import { cn } from "@/lib/utils";

export const selectTrigger = "h-11 w-full border-line bg-raised text-ink";
export const selectContent = "border-line bg-surface text-ink";
export const selectItem = "focus:bg-ember focus:text-white";
const NONE = "__none__";

export const Pill = ({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) => (
  <span
    className={cn(
      "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset",
      TONE_CLASS[tone],
      className,
    )}
  >
    {children}
  </span>
);

export const MetaPill = ({ meta, value }: { meta: Record<string, { label: string; tone: Tone }>; value: string }) => {
  const m = meta[value] ?? { label: value, tone: "slate" as Tone };
  return <Pill tone={m.tone}>{m.label}</Pill>;
};

export const fmtDate = (d: string | null | undefined, pattern = "MMM d, yyyy"): string => {
  if (!d) return "—";
  try {
    return format(d.length <= 10 ? parseISO(d) : new Date(d), pattern);
  } catch {
    return d;
  }
};

export const fmtDateTime = (d: string | null | undefined): string => fmtDate(d, "MMM d, yyyy · h:mm a");

/** Inset data tile (design contract: data sits on darker raised panels inside cards). */
export const DataTile = ({ label, children, className }: { label: string; children: ReactNode; className?: string }) => (
  <div className={cn("min-w-0 rounded-lg border border-line bg-raised px-4 py-3", className)}>
    <div className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-3">{label}</div>
    <div className="mt-1 break-words text-[15px] text-ink">{children || <span className="text-ink-3">—</span>}</div>
  </div>
);

export const SectionCard = ({
  title,
  subtitle,
  action,
  children,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) => (
  <Card className={cn("overflow-hidden", className)}>
    <div className="flex flex-col gap-3 px-5 pt-5 sm:flex-row sm:items-start sm:justify-between sm:px-6">
      <div className="min-w-0">
        <h2 className="font-display text-lg font-bold text-ink sm:text-xl">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-ink-2">{subtitle}</p>}
      </div>
      {action && <div className="flex shrink-0 flex-wrap gap-2">{action}</div>}
    </div>
    <div className="p-3 sm:p-4">{children}</div>
  </Card>
);

export const Loading = ({ label = "Loading…" }: { label?: string }) => (
  <div className="flex items-center justify-center gap-3 py-16 text-sm text-ink-2" role="status">
    <Loader2 className="h-5 w-5 animate-spin text-ember" />
    {label}
  </div>
);

export const ErrorBlock = ({ message, onRetry }: { message: string; onRetry?: () => void }) => (
  <div className="flex flex-col items-center gap-3 rounded-lg border border-status-incident/40 bg-status-incident/10 px-5 py-8 text-center" role="alert">
    <AlertTriangle className="h-6 w-6 text-status-incident" />
    <p className="text-sm text-ink">{message}</p>
    {onRetry && (
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RefreshCw />
        Try again
      </Button>
    )}
  </div>
);

export const Empty = ({ title, description, action }: { title: string; description?: string; action?: ReactNode }) => (
  <div className="rounded-lg border border-dashed border-line px-5 py-10 text-center">
    <p className="font-medium text-ink">{title}</p>
    {description && <p className="mx-auto mt-1 max-w-md text-sm text-ink-2">{description}</p>}
    {action && <div className="mt-4 flex justify-center">{action}</div>}
  </div>
);

/** Shown in place of a section the admin lacks permission for (data is never fetched). */
export const Restricted = ({ what }: { what: string }) => (
  <div className="flex items-start gap-3 rounded-lg border border-line bg-raised px-4 py-4 text-sm text-ink-2">
    <Lock className="mt-0.5 h-4 w-4 shrink-0 text-ink-3" />
    <span>
      {what} requires an additional workforce permission. An administrator with permission-management access can grant it in
      Workforce settings.
    </span>
  </div>
);

export const AccessDenied = () => (
  <div className="mx-auto max-w-lg py-20 text-center">
    <ShieldAlert className="mx-auto h-12 w-12 text-ember" strokeWidth={1.5} />
    <h1 className="mt-5 font-display text-3xl font-extrabold text-ink">Administrators only</h1>
    <p className="mt-2 text-ink-2">
      Workforce Management is limited to authorized administrators. If you need access, ask your organization admin.
    </p>
    <Button asChild className="mt-7">
      <Link to="/">Return to Dashboard</Link>
    </Button>
  </div>
);

/** Browser "leave page?" prompt while a form has unsaved changes. */
export const useUnloadGuard = (dirty: boolean) => {
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);
};

export const ConfirmDialog = ({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  destructive,
  busy,
  onConfirm,
  children,
  disabled,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  children?: ReactNode;
  disabled?: boolean;
}) => (
  <AlertDialog open={open} onOpenChange={onOpenChange}>
    <AlertDialogContent className="border-line bg-surface text-ink sm:rounded-xl">
      <AlertDialogHeader>
        <AlertDialogTitle className="font-display text-xl">{title}</AlertDialogTitle>
        {description && <AlertDialogDescription className="text-ink-2">{description}</AlertDialogDescription>}
      </AlertDialogHeader>
      {children}
      <AlertDialogFooter>
        <AlertDialogCancel className="border-line bg-transparent text-ink hover:bg-raised">Cancel</AlertDialogCancel>
        <AlertDialogAction
          disabled={busy || disabled}
          onClick={(e) => {
            e.preventDefault();
            onConfirm();
          }}
          className={cn(destructive ? "bg-status-incident hover:bg-status-incident/90" : "bg-ember hover:bg-ember-hover", "text-white")}
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          {confirmLabel}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);

/** Form dialog with save/cancel, validation-friendly submit, and an unsaved-changes guard. */
export const FormDialog = ({
  open,
  onOpenChange,
  title,
  description,
  dirty,
  saving,
  onSubmit,
  submitLabel = "Save",
  children,
  wide,
  footerExtra,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  dirty: boolean;
  saving?: boolean;
  onSubmit: () => void;
  submitLabel?: string;
  children: ReactNode;
  wide?: boolean;
  footerExtra?: ReactNode;
}) => {
  const [confirmClose, setConfirmClose] = useState<boolean>(false);
  useUnloadGuard(open && dirty);
  const requestClose = (next: boolean) => {
    if (!next && dirty && !saving) {
      setConfirmClose(true);
      return;
    }
    onOpenChange(next);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!saving) onSubmit();
  };
  return (
    <>
      <Dialog open={open} onOpenChange={requestClose}>
        <DialogContent
          className={cn(
            "max-h-[calc(100dvh-2rem)] overflow-y-auto border-line bg-surface text-ink sm:rounded-xl",
            wide ? "sm:max-w-3xl" : "sm:max-w-xl",
          )}
        >
          <DialogHeader>
            <DialogTitle className="font-display text-xl">{title}</DialogTitle>
            {description && <DialogDescription className="text-ink-2">{description}</DialogDescription>}
          </DialogHeader>
          <form onSubmit={submit} noValidate className="grid gap-4">
            {children}
            <div className="mt-2 flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-end">
              {footerExtra && <div className="sm:mr-auto">{footerExtra}</div>}
              <Button type="button" variant="ghost" onClick={() => requestClose(false)} disabled={saving}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="animate-spin" />}
                {submitLabel}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title="Discard unsaved changes?"
        description="You've made changes that haven't been saved."
        confirmLabel="Discard"
        destructive
        onConfirm={() => {
          setConfirmClose(false);
          onOpenChange(false);
        }}
      />
    </>
  );
};

let idSeq = 0;
const useFieldId = (prefix: string): string => {
  const [id] = useState<string>(() => `${prefix}-${++idSeq}`);
  return id;
};

export const TextField = ({
  label,
  value,
  onChange,
  required,
  error,
  type = "text",
  placeholder,
  hint,
  className,
  inputMode,
  maxLength = 300,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  error?: string;
  type?: string;
  placeholder?: string;
  hint?: string;
  className?: string;
  inputMode?: "text" | "decimal" | "numeric" | "tel" | "email";
  maxLength?: number;
  disabled?: boolean;
}) => {
  const id = useFieldId("f");
  return (
    <div className={className}>
      <FieldLabel htmlFor={id} required={required}>
        {label}
      </FieldLabel>
      <Input
        id={id}
        type={type}
        value={value}
        placeholder={placeholder}
        inputMode={inputMode}
        maxLength={maxLength}
        disabled={disabled}
        aria-invalid={!!error}
        aria-required={required}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && !error && <p className="mt-1.5 text-xs text-ink-3">{hint}</p>}
      <FieldError message={error} />
    </div>
  );
};

export const AreaField = ({
  label,
  value,
  onChange,
  required,
  error,
  placeholder,
  hint,
  className,
  rows,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  error?: string;
  placeholder?: string;
  hint?: string;
  className?: string;
  rows?: number;
  disabled?: boolean;
}) => {
  const id = useFieldId("a");
  return (
    <div className={className}>
      <FieldLabel htmlFor={id} required={required}>
        {label}
      </FieldLabel>
      <Textarea
        id={id}
        value={value}
        placeholder={placeholder}
        rows={rows}
        maxLength={8000}
        disabled={disabled}
        className={rows ? "min-h-0" : undefined}
        aria-invalid={!!error}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && !error && <p className="mt-1.5 text-xs text-ink-3">{hint}</p>}
      <FieldError message={error} />
    </div>
  );
};

export const SelectField = ({
  label,
  value,
  onChange,
  options,
  required,
  error,
  placeholder = "Select…",
  allowNone,
  noneLabel = "None",
  className,
  disabled,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  required?: boolean;
  error?: string;
  placeholder?: string;
  allowNone?: boolean;
  noneLabel?: string;
  className?: string;
  disabled?: boolean;
  hint?: string;
}) => {
  const id = useFieldId("s");
  return (
    <div className={className}>
      <FieldLabel htmlFor={id} required={required}>
        {label}
      </FieldLabel>
      <Select value={value || (allowNone ? NONE : undefined)} onValueChange={(v) => onChange(v === NONE ? "" : v)} disabled={disabled}>
        <SelectTrigger id={id} className={cn(selectTrigger, error && "border-status-incident/70")} aria-invalid={!!error}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent className={selectContent}>
          {allowNone && (
            <SelectItem value={NONE} className={selectItem}>
              {noneLabel}
            </SelectItem>
          )}
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value} className={selectItem}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hint && !error && <p className="mt-1.5 text-xs text-ink-3">{hint}</p>}
      <FieldError message={error} />
    </div>
  );
};

export const CheckField = ({
  label,
  checked,
  onChange,
  hint,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
  disabled?: boolean;
}) => {
  const id = useFieldId("c");
  return (
    <div className="flex items-start gap-3 rounded-lg border border-line bg-raised px-3.5 py-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-[#DC2626]"
      />
      <label htmlFor={id} className="text-sm text-ink">
        {label}
        {hint && <span className="mt-0.5 block text-xs text-ink-3">{hint}</span>}
      </label>
    </div>
  );
};

export const optionsFrom = (rec: Record<string, string | { label: string }>): { value: string; label: string }[] =>
  Object.entries(rec).map(([value, v]) => ({ value, label: typeof v === "string" ? v : v.label }));

/** Sub-navigation shared by every Workforce screen. */
export const WorkforceNav = ({ finance }: { finance: boolean }) => {
  const { pathname } = useLocation();
  const items = [
    { to: "/workforce", label: "Overview", match: (p: string) => p === "/workforce" },
    { to: "/workforce/directory", label: "Directory", match: (p: string) => p.startsWith("/workforce/directory") || p.startsWith("/workforce/workers") },
    { to: "/workforce/agencies", label: "Agencies", match: (p: string) => p.startsWith("/workforce/agencies") },
    ...(finance ? [{ to: "/workforce/invoices", label: "Invoices", match: (p: string) => p.startsWith("/workforce/invoices") }] : []),
    { to: "/workforce/reminders", label: "Reminders", match: (p: string) => p.startsWith("/workforce/reminders") },
    { to: "/workforce/reports", label: "Reports", match: (p: string) => p.startsWith("/workforce/reports") },
    { to: "/workforce/settings", label: "Settings", match: (p: string) => p.startsWith("/workforce/settings") },
  ];
  return (
    <nav aria-label="Workforce" className="-mx-4 mb-6 overflow-x-auto px-4 sm:mx-0 sm:px-0">
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
                  active ? "bg-ember text-white" : "text-ink-2 hover:bg-raised hover:text-ink",
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

/** Validates a yyyy-MM-dd date string (or empty). */
export const isDate = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s);
export const toNum = (s: string): number | null => {
  if (s.trim() === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
