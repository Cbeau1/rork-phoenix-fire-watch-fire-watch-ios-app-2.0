import { ArrowLeft, FileText, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";

import { STATUS_META, type PatrolStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export const PageHeader = ({
  title,
  subtitle,
  actions,
  backTo,
  backLabel,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  backTo?: string;
  backLabel?: string;
}) => (
  <header className="mb-7 flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
    <div className="min-w-0">
      {backTo && (
        <Link
          to={backTo}
          className="focus-ring mb-3 inline-flex items-center gap-2 rounded text-sm text-ink-2 transition-colors hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" />
          {backLabel ?? "Back"}
        </Link>
      )}
      <h1 className="font-display text-[32px] font-extrabold leading-[1.1] tracking-[-0.01em] text-ink sm:text-[40px]">
        {title}
      </h1>
      {subtitle && <p className="mt-2 text-[15px] text-ink-2 sm:text-base">{subtitle}</p>}
    </div>
    {actions && <div className="flex shrink-0 flex-wrap items-center gap-3 md:pt-1">{actions}</div>}
  </header>
);

export const Card = ({ className, children }: { className?: string; children: ReactNode }) => (
  <section className={cn("rounded-xl border border-line bg-surface", className)}>{children}</section>
);

export const CardHeader = ({
  title,
  subtitle,
  action,
  icon: Icon,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  icon?: LucideIcon;
  className?: string;
}) => (
  <div className={cn("flex items-start justify-between gap-4 px-6 pt-6 sm:px-7", className)}>
    <div className="flex min-w-0 items-start gap-4">
      {Icon && <Icon className="mt-0.5 h-8 w-8 shrink-0 text-ember" strokeWidth={1.6} />}
      <div className="min-w-0">
        <h2 className="font-display text-xl font-bold text-ink sm:text-[22px]">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-ink-2">{subtitle}</p>}
      </div>
    </div>
    {action}
  </div>
);

export const StatCard = ({
  label,
  value,
  icon: Icon,
  dot,
  iconClass,
  delay = 0,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  dot: string;
  iconClass?: string;
  delay?: number;
}) => (
  <div
    className="group animate-fade-up rounded-xl border border-line bg-surface p-5 transition-colors hover:border-[#43474f] sm:p-6"
    style={{ animationDelay: `${delay}ms` }}
  >
    <div className="flex items-center gap-2.5">
      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: dot }} aria-hidden />
      <span className="text-[11px] font-medium uppercase tracking-[0.16em] text-ink-2 sm:text-xs">{label}</span>
    </div>
    <div className="mt-3 flex items-end justify-between">
      <span className="font-display text-5xl font-extrabold leading-none tabular-nums text-ink sm:text-[56px]">
        {value}
      </span>
      <Icon
        className={cn("h-8 w-8 text-ember transition-transform duration-300 group-hover:-translate-y-0.5", iconClass)}
        strokeWidth={1.6}
      />
    </div>
  </div>
);

export const EmptyState = ({
  title,
  description,
  action,
  icon: Icon = FileText,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: LucideIcon;
  className?: string;
}) => (
  <div className={cn("flex flex-col items-center justify-center px-6 py-14 text-center", className)}>
    <div className="flex h-20 w-20 items-center justify-center rounded-full bg-raised ring-1 ring-line">
      <Icon className="h-9 w-9 text-ink-3" strokeWidth={1.5} />
    </div>
    <h3 className="mt-5 text-lg font-semibold text-ink">{title}</h3>
    {description && <p className="mt-1.5 max-w-sm text-sm text-ink-2">{description}</p>}
    {action && <div className="mt-6">{action}</div>}
  </div>
);

export const StatusBadge = ({ status, className }: { status: PatrolStatus; className?: string }) => {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset",
        meta.bg,
        meta.text,
        meta.ring,
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: meta.color }} />
      {meta.label}
    </span>
  );
};

export const FieldLabel = ({ htmlFor, children, required }: { htmlFor: string; children: ReactNode; required?: boolean }) => (
  <label htmlFor={htmlFor} className="mb-2 block text-sm font-medium text-ink">
    {children}
    {required && <span className="ml-0.5 text-ember">*</span>}
  </label>
);

export const FieldError = ({ message }: { message?: string }) =>
  message ? <p className="mt-1.5 text-xs text-status-incident">{message}</p> : null;

export const FieldHint = ({ children }: { children: ReactNode }) => (
  <p className="mt-1.5 text-xs text-ink-3">{children}</p>
);
