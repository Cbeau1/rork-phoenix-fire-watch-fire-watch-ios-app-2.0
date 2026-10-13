import { format } from "date-fns";
import { CheckCircle2, Clock3, Link2, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

import { FieldError, FieldHint, FieldLabel } from "@/components/fw/primitives";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { timeOfDay, toLocalInputValue } from "@/lib/format";
import { formatHours, formatShiftRange, scheduledWindow, type Shift } from "@/lib/schedule";
import { friendlyError } from "@/lib/supabase";
import type { ScheduleApi } from "@/state/useSchedule";

interface CompleteShiftDialogProps {
  shift: Shift | null;
  staffName: string;
  propertyName: string;
  schedule: ScheduleApi;
  onClose: () => void;
}

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, " ");
const NO_LOGIN = "__no_login__";

/**
 * Admin: mark a scheduled shift completed. Real clock punches are used when the officer clocked in
 * for the shift; otherwise the scheduled (or adjusted) times are sent to Payroll for approval.
 */
export const CompleteShiftDialog = ({ shift, staffName, propertyName, schedule, onClose }: CompleteShiftDialogProps) => {
  const navigate = useNavigate();
  const staff = shift ? schedule.staffById.get(shift.staffId) : undefined;
  const work = shift ? schedule.workByShift.get(shift.id) : undefined;
  const clockedIn = work?.status === "open";
  const needsLogin = !staff?.profileId;
  const win = useMemo(() => (shift ? scheduledWindow(shift) : null), [shift]);

  const [profileId, setProfileId] = useState<string>("");
  const [start, setStart] = useState<string>("");
  const [end, setEnd] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!shift || !win) return;
    const match = schedule.members.find((m) => m.active && norm(m.name) === norm(staffName));
    setProfileId(staff?.profileId ?? match?.id ?? NO_LOGIN);
    const endAt = clockedIn ? new Date(Math.min(Date.now(), win.end.getTime())) : win.end;
    setStart(toLocalInputValue(win.start));
    setEnd(toLocalInputValue(endAt));
    setNote("");
    setErrors({});
    // Reset when a different shift is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shift?.id]);

  const startDate = start ? new Date(start) : null;
  const endDate = end ? new Date(end) : null;
  const minutes = startDate && endDate ? Math.round((endDate.getTime() - startDate.getTime()) / 60000) : 0;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!shift || !win) return;
    const next: Record<string, string> = {};
    if (needsLogin && !profileId) next.login = "Choose whose hours these are.";
    if (!endDate || Number.isNaN(endDate.getTime())) next.time = "Enter the end time.";
    else if (!clockedIn) {
      if (!startDate || Number.isNaN(startDate.getTime())) next.time = "Enter the start time.";
      else if (endDate <= startDate) next.time = "End must be after the start.";
      else if (minutes > 24 * 60) next.time = "A single entry can't be longer than 24 hours.";
    }
    if (endDate && endDate.getTime() > Date.now() + 5 * 60000) next.time = "The end time can't be in the future.";
    setErrors(next);
    if (Object.keys(next).length) return;

    const sameStart = startDate && toLocalInputValue(startDate) === toLocalInputValue(win.start);
    const sameEnd = endDate && toLocalInputValue(endDate) === toLocalInputValue(win.end);
    schedule.completeShift.mutate(
      {
        shiftId: shift.id,
        profileId: needsLogin && profileId !== NO_LOGIN ? profileId : undefined,
        noLogin: needsLogin && profileId === NO_LOGIN,
        clockIn: clockedIn || sameStart ? undefined : (startDate ?? undefined),
        clockOut: !clockedIn && sameEnd ? undefined : (endDate ?? undefined),
        note,
      },
      {
        onSuccess: () => {
          toast.success("Shift completed — sent to Payroll for approval", {
            action: { label: "Review", onClick: () => navigate("/payroll") },
          });
          onClose();
        },
        onError: (err) => setErrors({ form: friendlyError(err, "Couldn't complete the shift") }),
      },
    );
  };

  return (
    <Dialog open={!!shift} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto border-line bg-surface text-ink sm:max-w-lg sm:rounded-xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Mark shift completed</DialogTitle>
          <DialogDescription className="text-ink-2">
            The hours go to Payroll as <span className="font-medium text-ink">Needs approval</span>. Nothing is paid until you approve them.
          </DialogDescription>
        </DialogHeader>

        {shift && win && (
          <form onSubmit={submit} className="grid gap-5" noValidate>
            <div className="rounded-lg border border-line bg-raised px-4 py-3">
              <div className="font-semibold text-ink">{staffName}</div>
              <div className="mt-0.5 text-sm text-ink-2">
                {format(win.start, "EEE, MMM d")} · <span className="font-mono">{formatShiftRange(shift)}</span>
              </div>
              <div className="mt-0.5 truncate text-xs text-ink-3">{propertyName}</div>
            </div>

            {needsLogin && (
              <div>
                <FieldLabel htmlFor="complete-login" required>
                  App login
                </FieldLabel>
                <Select value={profileId} onValueChange={setProfileId}>
                  <SelectTrigger id="complete-login" className="h-11 w-full border-line-strong bg-field text-ink" aria-invalid={!!errors.login}>
                    <SelectValue placeholder="Who clocks in as this person?" />
                  </SelectTrigger>
                  <SelectContent className="border-line bg-surface text-ink">
                    <SelectItem value={NO_LOGIN} className="focus:bg-primary focus:text-white">
                      No app login <span className="text-xs opacity-70">· record under {staffName}</span>
                    </SelectItem>
                    {schedule.members
                      .filter((m) => m.active)
                      .map((m) => (
                        <SelectItem key={m.id} value={m.id} className="focus:bg-primary focus:text-white">
                          {m.name} <span className="text-xs opacity-70">· {m.email}</span>
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                {errors.login ? (
                  <FieldError message={errors.login} />
                ) : profileId === NO_LOGIN ? (
                  <FieldHint>
                    For agency or off-app staff. Hours go to Payroll under {staffName}'s name. If they later get a Team login, pick it here so
                    their clock-ins sync automatically.
                  </FieldHint>
                ) : (
                  <FieldHint>
                    <Link2 className="mr-1 inline h-3 w-3" />
                    Remembered for {staffName}'s future shifts, so their clock-ins sync to the schedule automatically.
                  </FieldHint>
                )}
              </div>
            )}

            {clockedIn && work ? (
              <div className="grid gap-3">
                <div className="flex gap-3 rounded-lg border border-primary/40 bg-primary/10 px-4 py-3 text-sm">
                  <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-link" />
                  <p className="text-ink-2">
                    <span className="font-medium text-ink">{staffName} is still clocked in</span> (since {timeOfDay(work.clockIn)}). Completing the
                    shift clocks them out and keeps their real start time.
                  </p>
                </div>
                <div>
                  <FieldLabel htmlFor="complete-end" required>
                    Clock-out time
                  </FieldLabel>
                  <Input id="complete-end" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} className="font-mono" />
                </div>
              </div>
            ) : (
              <div>
                <span className="mb-2 block text-sm font-medium text-ink">
                  Hours worked<span className="ml-0.5 text-link">*</span>
                </span>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="complete-start" className="mb-1.5 block text-xs text-ink-3">
                      Start
                    </label>
                    <Input id="complete-start" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} className="font-mono" />
                  </div>
                  <div>
                    <label htmlFor="complete-end" className="mb-1.5 block text-xs text-ink-3">
                      End
                    </label>
                    <Input id="complete-end" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} className="font-mono" />
                  </div>
                </div>
                {errors.time ? null : (
                  <FieldHint>
                    {minutes > 0 ? `${formatHours(minutes)} · ` : ""}Prefilled from the schedule. If {staffName} clocked in for this shift, their real
                    clock times are used instead.
                  </FieldHint>
                )}
              </div>
            )}
            <FieldError message={errors.time} />

            <div>
              <FieldLabel htmlFor="complete-note">Note for payroll</FieldLabel>
              <Input id="complete-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional — e.g. left 30 min early" maxLength={500} />
            </div>

            {errors.form && (
              <p role="alert" className="rounded-lg border border-status-incident/40 bg-status-incident/10 px-3.5 py-2.5 text-sm text-status-incident-ink">
                {errors.form}
              </p>
            )}

            <div className="flex gap-3 sm:justify-end">
              <Button type="button" variant="outline" className="flex-1 sm:flex-none" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" className="flex-1 sm:flex-none" disabled={schedule.completeShift.isPending}>
                {schedule.completeShift.isPending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
                Complete &amp; send to Payroll
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
};
