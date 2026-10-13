import { Building2, Check, CheckCircle2, CircleDollarSign, Clock3, Moon, Pencil, XCircle } from "lucide-react";
import { memo } from "react";

import { timeOfDay } from "@/lib/format";
import {
  formatHours,
  formatShiftRange,
  isOvernight,
  scheduledWindow,
  SHIFT_WORK_LABEL,
  shiftMinutes,
  type Shift,
  type ShiftWork,
} from "@/lib/schedule";
import { cn } from "@/lib/utils";

interface ShiftCardProps {
  shift: Shift;
  staffName: string;
  propertyName: string;
  showProperty: boolean;
  isAdmin: boolean;
  /** Highlights the signed-in officer's own shifts. */
  mine?: boolean;
  onEdit?: (shift: Shift) => void;
  onTogglePaid?: (shift: Shift) => void;
  /** Clock / payroll hours attached to this shift, if any. */
  work?: ShiftWork;
  onComplete?: (shift: Shift) => void;
}

/** One shift on the weekly schedule. Admins see pay status: paid shifts turn green. */
export const ShiftCard = memo(
  ({ shift, staffName, propertyName, showProperty, isAdmin, mine, onEdit, onTogglePaid, work, onComplete }: ShiftCardProps) => {
    const paid = isAdmin && !!shift.paidAt;
    const overnight = isOvernight(shift);
    const started = scheduledWindow(shift).start.getTime() <= Date.now();
    const canComplete = isAdmin && !!onComplete && started && (!work || work.status === "open" || work.status === "rejected");

    return (
      <li
        className={cn(
          "relative overflow-hidden rounded-lg border transition-colors duration-300",
          paid
            ? "border-status-clear/55 bg-status-clear/[0.12]"
            : mine
              ? "border-primary/45 bg-primary/[0.07]"
              : "border-line bg-raised",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "absolute inset-y-0 left-0 w-[3px] transition-colors duration-300",
            paid ? "bg-status-clear" : mine ? "bg-primary" : "bg-line-strong",
          )}
        />
        {isAdmin && onEdit ? (
          <button
            type="button"
            onClick={() => onEdit(shift)}
            className="focus-ring group block w-full rounded-t-lg py-2.5 pl-3.5 pr-2.5 text-left"
            aria-label={`Edit ${staffName}'s shift, ${formatShiftRange(shift)}`}
          >
            <ShiftBody
              shift={shift}
              staffName={staffName}
              propertyName={propertyName}
              showProperty={showProperty}
              overnight={overnight}
              paid={paid}
              editable
            />
            {work && <WorkStatus work={work} />}
          </button>
        ) : (
          <div className="py-2.5 pl-3.5 pr-2.5">
            <ShiftBody
              shift={shift}
              staffName={staffName}
              propertyName={propertyName}
              showProperty={showProperty}
              overnight={overnight}
              paid={paid}
              mine={mine}
            />
            {work && <WorkStatus work={work} />}
          </div>
        )}

        {isAdmin && (onTogglePaid || canComplete) && (
          <div className="flex gap-1.5 px-2 pb-2 pl-3 lg:flex-col">
            {canComplete && (
              <button
                type="button"
                onClick={() => onComplete?.(shift)}
                title="Mark completed and send the hours to Payroll for approval"
                className="focus-ring flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md border border-primary/50 lg:flex-none text-xs font-semibold text-link transition-all duration-200 hover:bg-primary/10 active:scale-[0.97]"
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                Complete
              </button>
            )}
            {onTogglePaid && (
            <button
              type="button"
              onClick={() => onTogglePaid(shift)}
              aria-pressed={paid}
              title={paid ? "Tap to mark as unpaid" : "Mark this shift as paid"}
              className={cn(
                "focus-ring flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md text-xs font-semibold lg:flex-none transition-all duration-200 active:scale-[0.97]",
                paid
                  ? "bg-status-clear text-on-clear hover:bg-status-clear/90"
                  : "border border-line-strong text-ink-2 hover:border-status-clear/60 hover:bg-status-clear/10 hover:text-status-clear",
              )}
            >
              {paid ? (
                <>
                  <Check className="h-3.5 w-3.5 animate-in zoom-in-50 duration-200" strokeWidth={3} />
                  Paid
                </>
              ) : (
                <>
                  <CircleDollarSign className="h-3.5 w-3.5" />
                  Mark Paid
                </>
              )}
            </button>
            )}
          </div>
        )}
      </li>
    );
  },
);
ShiftCard.displayName = "ShiftCard";

const WORK_STYLE: Record<ShiftWork["status"], string> = {
  open: "bg-primary/12 text-link ring-primary/35",
  pending: "bg-status-follow/12 text-status-follow ring-status-follow/40",
  approved: "bg-status-clear/12 text-status-clear ring-status-clear/40",
  rejected: "bg-status-incident/10 text-status-incident-ink ring-status-incident/40",
};

/** Live clock / approval state for a shift, with the real clocked times when they exist. */
const WorkStatus = ({ work }: { work: ShiftWork }) => {
  const Icon = work.status === "open" ? Clock3 : work.status === "rejected" ? XCircle : CheckCircle2;
  return (
    <div className="mt-2 flex flex-col gap-1">
      <span
        className={cn(
          "inline-flex w-fit max-w-full items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset",
          WORK_STYLE[work.status],
        )}
      >
        {work.status === "open" ? (
          <span className="relative mr-0.5 flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
          </span>
        ) : (
          <Icon className="h-3 w-3" />
        )}
        {SHIFT_WORK_LABEL[work.status]}
      </span>
      <span className="font-mono text-[11px] text-ink-3">
        {work.status === "open"
          ? `Clocked in ${timeOfDay(work.clockIn)}`
          : `${work.source === "clock" ? "Clocked" : "Logged"} ${timeOfDay(work.clockIn)} – ${work.clockOut ? timeOfDay(work.clockOut) : "now"}`}
      </span>
    </div>
  );
};

const ShiftBody = ({
  shift,
  staffName,
  propertyName,
  showProperty,
  overnight,
  paid,
  editable,
  mine,
}: {
  shift: Shift;
  staffName: string;
  propertyName: string;
  showProperty: boolean;
  overnight: boolean;
  paid: boolean;
  editable?: boolean;
  mine?: boolean;
}) => (
  <>
    <div className="flex items-start justify-between gap-2">
      <span className={cn("line-clamp-2 text-sm font-semibold leading-snug", paid ? "text-status-clear" : "text-ink")}>
        {staffName}
        {mine && <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-link">You</span>}
      </span>
      {editable && (
        <Pencil className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
      )}
    </div>
    <div className="mt-1 flex flex-wrap items-center gap-x-1.5 font-mono text-[11.5px] text-ink-2">
      {overnight && <Moon className="h-3 w-3 text-silver" aria-label="Overnight" />}
      <span>{formatShiftRange(shift)}</span>
      <span className="text-ink-3">· {formatHours(shiftMinutes(shift))}</span>
    </div>
    {showProperty && (
      <div className="mt-1 flex items-center gap-1.5 text-xs text-ink-3">
        <Building2 className="h-3 w-3 shrink-0" />
        <span className="truncate">{propertyName}</span>
      </div>
    )}
    {shift.notes && <p className="mt-1 line-clamp-2 text-xs italic text-ink-3">{shift.notes}</p>}
  </>
);
