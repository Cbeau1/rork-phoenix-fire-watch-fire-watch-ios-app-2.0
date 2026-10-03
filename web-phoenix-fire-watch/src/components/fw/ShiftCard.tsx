import { Building2, Check, CircleDollarSign, Moon, Pencil } from "lucide-react";
import { memo } from "react";

import { formatHours, formatShiftRange, isOvernight, shiftMinutes, type Shift } from "@/lib/schedule";
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
}

/** One shift on the weekly schedule. Admins see pay status: paid shifts turn green. */
export const ShiftCard = memo(
  ({ shift, staffName, propertyName, showProperty, isAdmin, mine, onEdit, onTogglePaid }: ShiftCardProps) => {
    const paid = isAdmin && !!shift.paidAt;
    const overnight = isOvernight(shift);

    return (
      <li
        className={cn(
          "relative overflow-hidden rounded-lg border transition-colors duration-300",
          paid
            ? "border-status-clear/55 bg-status-clear/[0.12]"
            : mine
              ? "border-ember/45 bg-ember/[0.07]"
              : "border-line bg-raised",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "absolute inset-y-0 left-0 w-[3px] transition-colors duration-300",
            paid ? "bg-status-clear" : mine ? "bg-ember" : "bg-[#6E7686]",
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
          </div>
        )}

        {isAdmin && onTogglePaid && (
          <div className="px-2 pb-2 pl-3">
            <button
              type="button"
              onClick={() => onTogglePaid(shift)}
              aria-pressed={paid}
              title={paid ? "Tap to mark as unpaid" : "Mark this shift as paid"}
              className={cn(
                "focus-ring flex h-9 w-full items-center justify-center gap-1.5 rounded-md text-xs font-semibold transition-all duration-200 active:scale-[0.97]",
                paid
                  ? "bg-status-clear text-[#04240f] hover:bg-status-clear/90"
                  : "border border-[#6E7686] text-ink-2 hover:border-status-clear/60 hover:bg-status-clear/10 hover:text-status-clear",
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
          </div>
        )}
      </li>
    );
  },
);
ShiftCard.displayName = "ShiftCard";

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
        {mine && <span className="ml-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ember">You</span>}
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
