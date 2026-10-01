import { format } from "date-fns";
import { Loader2, Moon, Plus, Save, Trash2, UserPlus } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { FieldError, FieldLabel } from "@/components/fw/primitives";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  formatHours,
  fromDateKey,
  isOvernight,
  SHIFT_PRESETS,
  shiftMinutes,
  toDateKey,
  type Shift,
} from "@/lib/schedule";
import { friendlyError } from "@/lib/supabase";
import type { Property } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { ScheduleApi } from "@/state/useSchedule";

const NEW_STAFF = "__new__";

export interface ShiftDraft {
  /** Existing shift to edit; omit to create. */
  shift?: Shift;
  /** Pre-selected day (yyyy-MM-dd) when creating. */
  date?: string;
  propertyId?: string;
}

interface ShiftDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: ShiftDraft;
  days: Date[];
  properties: Property[];
  schedule: ScheduleApi;
}

const selectTrigger = "h-11 w-full border-line bg-raised text-ink";
const selectContent = "border-line bg-surface text-ink";
const selectItem = "focus:bg-ember focus:text-white";

/** Admin dialog to add a shift (to one or more days of the week) or edit / delete an existing one. */
export const ShiftDialog = ({ open, onOpenChange, draft, days, properties, schedule }: ShiftDialogProps) => {
  const editing = draft.shift;
  const [staffId, setStaffId] = useState<string>("");
  const [newStaffName, setNewStaffName] = useState<string>("");
  const [propertyId, setPropertyId] = useState<string>("");
  const [dates, setDates] = useState<string[]>([]);
  const [start, setStart] = useState<string>("19:00");
  const [end, setEnd] = useState<string>("07:00");
  const [notes, setNotes] = useState<string>("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState<boolean>(false);

  useEffect(() => {
    if (!open) return;
    const s = draft.shift;
    setStaffId(s?.staffId ?? (schedule.staff.length === 0 ? NEW_STAFF : ""));
    setNewStaffName("");
    setPropertyId(s?.propertyId ?? draft.propertyId ?? (properties.length === 1 ? (properties[0]?.id ?? "") : ""));
    setDates(s ? [s.date] : draft.date ? [draft.date] : []);
    setStart(s?.start ?? "19:00");
    setEnd(s?.end ?? "07:00");
    setNotes(s?.notes ?? "");
    setErrors({});
    setConfirmDelete(false);
    // Reset only when the dialog opens for a new draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draft]);

  const saving = schedule.addShifts.isPending || schedule.updateShift.isPending || schedule.addStaff.isPending;
  const deleting = schedule.deleteShift.isPending;
  const minutes = useMemo<number>(() => (start && end && start !== end ? shiftMinutes({ start, end }) : 0), [start, end]);

  const toggleDate = (key: string) => {
    if (editing) {
      setDates([key]);
      return;
    }
    setDates((cur) => (cur.includes(key) ? cur.filter((d) => d !== key) : [...cur, key].sort()));
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    if (!staffId) next.staff = "Choose who's working";
    if (staffId === NEW_STAFF && !newStaffName.trim()) next.staff = "Enter the staff member's name";
    if (!propertyId) next.property = "Choose a property";
    if (dates.length === 0) next.dates = "Pick at least one day";
    if (!start || !end) next.time = "Enter start and end times";
    else if (start === end) next.time = "Start and end can't be the same time";
    setErrors(next);
    if (Object.keys(next).length) return;

    try {
      let sid = staffId;
      if (staffId === NEW_STAFF) {
        const created = await schedule.addStaff.mutateAsync({ name: newStaffName, profileId: null });
        sid = created.id;
        setStaffId(sid);
      }
      const input = { staffId: sid, propertyId, start, end, notes };
      if (editing) {
        await schedule.updateShift.mutateAsync({ id: editing.id, date: dates[0] ?? editing.date, input });
        toast.success("Shift updated");
      } else {
        const count = await schedule.addShifts.mutateAsync({ input, dates });
        toast.success(count === 1 ? "Shift added" : `${count} shifts added`);
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(friendlyError(err, "Couldn't save the shift"));
    }
  };

  const remove = async () => {
    if (!editing) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    try {
      await schedule.deleteShift.mutateAsync(editing.id);
      toast.success("Shift removed");
      onOpenChange(false);
    } catch (err) {
      toast.error(friendlyError(err, "Couldn't remove the shift"));
    }
  };

  const editingDateOutsideWeek = editing && !days.some((d) => toDateKey(d) === editing.date);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto border-line bg-surface text-ink sm:max-w-xl sm:rounded-xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">{editing ? "Edit Shift" : "Add Shift"}</DialogTitle>
          <DialogDescription className="text-ink-2">
            {editing ? "Change who's working, where, or when." : "Schedule a staff member at a property. Pick several days to repeat it."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => void submit(e)} className="grid gap-5" noValidate>
          <div>
            <FieldLabel htmlFor="shift-staff" required>
              Staff member
            </FieldLabel>
            <Select value={staffId} onValueChange={setStaffId}>
              <SelectTrigger id="shift-staff" className={selectTrigger} aria-invalid={!!errors.staff}>
                <SelectValue placeholder="Choose a name" />
              </SelectTrigger>
              <SelectContent className={selectContent}>
                {schedule.staff.map((s) => (
                  <SelectItem key={s.id} value={s.id} className={selectItem}>
                    {s.name}
                  </SelectItem>
                ))}
                <SelectItem value={NEW_STAFF} className={cn(selectItem, "text-ember")}>
                  + Add a new name…
                </SelectItem>
              </SelectContent>
            </Select>
            {staffId === NEW_STAFF && (
              <div className="mt-2 flex items-center gap-2">
                <UserPlus className="h-4 w-4 shrink-0 text-ember" />
                <Input
                  autoFocus
                  value={newStaffName}
                  onChange={(e) => setNewStaffName(e.target.value)}
                  placeholder="Full name, e.g. Marcus Reed"
                  maxLength={80}
                  aria-label="New staff member name"
                />
              </div>
            )}
            <FieldError message={errors.staff} />
          </div>

          <div>
            <FieldLabel htmlFor="shift-property" required>
              Property
            </FieldLabel>
            <Select value={propertyId} onValueChange={setPropertyId}>
              <SelectTrigger id="shift-property" className={selectTrigger} aria-invalid={!!errors.property}>
                <SelectValue placeholder={properties.length ? "Choose a property" : "Add a property first"} />
              </SelectTrigger>
              <SelectContent className={selectContent}>
                {properties.map((p) => (
                  <SelectItem key={p.id} value={p.id} className={selectItem}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError message={errors.property} />
          </div>

          <div>
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-sm font-medium text-ink">
                {editing ? "Day" : "Days"}
                <span className="ml-0.5 text-ember">*</span>
              </span>
              {!editing && (
                <button
                  type="button"
                  onClick={() => setDates(dates.length === 7 ? [] : days.map(toDateKey))}
                  className="focus-ring rounded text-xs font-medium text-ember hover:text-ember-hover"
                >
                  {dates.length === 7 ? "Clear" : "Every day"}
                </button>
              )}
            </div>
            <div className="grid grid-cols-7 gap-1.5" role="group" aria-label="Days of the week">
              {days.map((d) => {
                const key = toDateKey(d);
                const on = dates.includes(key);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggleDate(key)}
                    aria-pressed={on}
                    className={cn(
                      "focus-ring flex flex-col items-center rounded-lg border py-2 transition-all duration-150 active:scale-95",
                      on ? "border-ember bg-ember text-white" : "border-line bg-raised text-ink-2 hover:border-[#3a3c41] hover:text-ink",
                    )}
                  >
                    <span className="text-[10px] font-semibold uppercase tracking-[0.1em]">{format(d, "EEE")}</span>
                    <span className="font-display text-lg font-bold leading-tight">{format(d, "d")}</span>
                  </button>
                );
              })}
            </div>
            {editingDateOutsideWeek && editing && (
              <p className="mt-1.5 text-xs text-ink-3">Currently on {format(fromDateKey(editing.date), "EEE, MMM d")}.</p>
            )}
            <FieldError message={errors.dates} />
          </div>

          <div>
            <span className="mb-2 block text-sm font-medium text-ink">
              Hours<span className="ml-0.5 text-ember">*</span>
            </span>
            <div className="mb-3 flex flex-wrap gap-1.5">
              {SHIFT_PRESETS.map((p) => {
                const active = p.start === start && p.end === end;
                return (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => {
                      setStart(p.start);
                      setEnd(p.end);
                    }}
                    className={cn(
                      "focus-ring rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                      active ? "border-ember/60 bg-ember/15 text-ember" : "border-line bg-raised text-ink-2 hover:text-ink",
                    )}
                  >
                    {p.label} <span className="font-mono text-[11px] opacity-75">{p.start}–{p.end}</span>
                  </button>
                );
              })}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="shift-start" className="mb-1.5 block text-xs text-ink-3">
                  Start
                </label>
                <Input
                  id="shift-start"
                  type="time"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  className="font-mono [color-scheme:dark]"
                />
              </div>
              <div>
                <label htmlFor="shift-end" className="mb-1.5 block text-xs text-ink-3">
                  End
                </label>
                <Input
                  id="shift-end"
                  type="time"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                  className="font-mono [color-scheme:dark]"
                />
              </div>
            </div>
            {minutes > 0 && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-2">
                {isOvernight({ start, end }) && <Moon className="h-3.5 w-3.5 text-silver" />}
                {formatHours(minutes)} shift{isOvernight({ start, end }) ? " · ends the next morning" : ""}
              </p>
            )}
            <FieldError message={errors.time} />
          </div>

          <div>
            <FieldLabel htmlFor="shift-notes">Notes</FieldLabel>
            <Input
              id="shift-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional — e.g. cover for front gate"
              maxLength={500}
            />
          </div>

          <div className="flex flex-col-reverse gap-3 pt-1 sm:flex-row sm:items-center sm:justify-between">
            {editing ? (
              <Button
                type="button"
                variant="destructive-outline"
                onClick={() => void remove()}
                disabled={deleting || saving}
              >
                {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
                {confirmDelete ? "Tap again to remove" : "Remove shift"}
              </Button>
            ) : (
              <span />
            )}
            <div className="flex gap-3 sm:justify-end">
              <Button type="button" variant="outline" className="flex-1 sm:flex-none" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" className="flex-1 sm:flex-none" disabled={saving || deleting}>
                {saving ? <Loader2 className="animate-spin" /> : editing ? <Save /> : <Plus />}
                {editing ? "Save" : dates.length > 1 ? `Add ${dates.length} Shifts` : "Add Shift"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
