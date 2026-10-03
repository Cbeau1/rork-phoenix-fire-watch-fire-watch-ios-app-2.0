import { addWeeks, format, isToday } from "date-fns";
import {
  Building2,
  CalendarDays,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Loader2,
  Plus,
  RefreshCw,
  Users,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { Card, EmptyState, PageHeader } from "@/components/fw/primitives";
import { ShiftCard } from "@/components/fw/ShiftCard";
import { ShiftDialog, type ShiftDraft } from "@/components/fw/ShiftDialog";
import { StaffDialog } from "@/components/fw/StaffDialog";
import { Button } from "@/components/ui/button";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { initials } from "@/lib/format";
import {
  byShiftStart,
  formatHours,
  shiftMinutes,
  toDateKey,
  weekDays,
  weekLabel,
  weekStartOf,
  type Shift,
} from "@/lib/schedule";
import { friendlyError } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { useAuth } from "@/state/AuthProvider";
import { useFireWatch } from "@/state/FireWatchProvider";
import { useSchedule } from "@/state/useSchedule";

const ALL = "all";

/** One hue per weekday (Mon → Sun) so each day scans at a glance. */
const DAY_COLORS = ["#F87171", "#FB923C", "#FBBF24", "#4ADE80", "#38BDF8", "#A78BFA", "#F472B6"] as const;

/** Monday = 0 … Sunday = 6, matching the Monday-start week grid. */
const dayColor = (d: Date): string => DAY_COLORS[(d.getDay() + 6) % 7];

const Schedule = () => {
  useDocumentTitle("Schedule");
  const { user } = useAuth();
  const { properties, propertyById } = useFireWatch();
  const [weekStart, setWeekStart] = useState<Date>(() => weekStartOf(new Date()));
  const [propertyFilter, setPropertyFilter] = useState<string>(ALL);
  const [onlyMine, setOnlyMine] = useState<boolean>(false);
  const [shiftOpen, setShiftOpen] = useState<boolean>(false);
  const [staffOpen, setStaffOpen] = useState<boolean>(false);
  const [draft, setDraft] = useState<ShiftDraft>({});

  const schedule = useSchedule(weekStart);
  const { isAdmin, shifts, staffById, staff, setPaid } = schedule;
  const days = useMemo<Date[]>(() => weekDays(weekStart), [weekStart]);
  const isThisWeek = toDateKey(weekStart) === toDateKey(weekStartOf(new Date()));

  const myStaffIds = useMemo<Set<string>>(
    () => new Set(staff.filter((s) => s.profileId && s.profileId === user?.id).map((s) => s.id)),
    [staff, user?.id],
  );
  const hasMine = myStaffIds.size > 0;

  const visible = useMemo<Shift[]>(
    () =>
      shifts
        .filter((s) => propertyFilter === ALL || s.propertyId === propertyFilter)
        .filter((s) => !onlyMine || myStaffIds.has(s.staffId))
        .sort(byShiftStart),
    [shifts, propertyFilter, onlyMine, myStaffIds],
  );

  const byDay = useMemo<Map<string, Shift[]>>(() => {
    const m = new Map<string, Shift[]>();
    for (const s of visible) m.set(s.date, [...(m.get(s.date) ?? []), s]);
    return m;
  }, [visible]);

  /** Admin weekly pay summary per person (respects the property filter). */
  const payRows = useMemo(() => {
    if (!isAdmin) return [];
    const m = new Map<string, { staffId: string; shifts: Shift[]; minutes: number; paidMinutes: number }>();
    for (const s of visible) {
      const row = m.get(s.staffId) ?? { staffId: s.staffId, shifts: [], minutes: 0, paidMinutes: 0 };
      const mins = shiftMinutes(s);
      row.shifts.push(s);
      row.minutes += mins;
      if (s.paidAt) row.paidMinutes += mins;
      m.set(s.staffId, row);
    }
    return [...m.values()].sort((a, b) =>
      (staffById.get(a.staffId)?.name ?? "").localeCompare(staffById.get(b.staffId)?.name ?? ""),
    );
  }, [isAdmin, visible, staffById]);

  const totals = useMemo(() => {
    const minutes = visible.reduce((sum, s) => sum + shiftMinutes(s), 0);
    const paid = visible.filter((s) => s.paidAt).length;
    return { count: visible.length, minutes, paid };
  }, [visible]);

  const openAdd = useCallback(
    (date?: string) => {
      if (properties.length === 0) {
        toast.error("Add a property first, then schedule staff to it.");
        return;
      }
      setDraft({ date, propertyId: propertyFilter === ALL ? undefined : propertyFilter });
      setShiftOpen(true);
    },
    [properties.length, propertyFilter],
  );

  const openEdit = useCallback((shift: Shift) => {
    setDraft({ shift });
    setShiftOpen(true);
  }, []);

  const togglePaid = useCallback(
    (shift: Shift) => {
      const paid = !shift.paidAt;
      setPaid.mutate(
        { ids: [shift.id], paid },
        { onError: (err) => toast.error(friendlyError(err, "Couldn't update pay status")) },
      );
    },
    [setPaid],
  );

  const markAll = (ids: string[], paid: boolean, who: string) => {
    if (ids.length === 0) return;
    setPaid.mutate(
      { ids, paid },
      {
        onSuccess: () => toast.success(paid ? `${who}'s week marked paid` : `${who}'s week marked unpaid`),
        onError: (err) => toast.error(friendlyError(err, "Couldn't update pay status")),
      },
    );
  };

  const filterChips = [{ id: ALL, name: "All properties" }, ...properties.map((p) => ({ id: p.id, name: p.name }))];

  return (
    <>
      <PageHeader
        title="Schedule"
        subtitle={isAdmin ? "Plan the week, assign staff to sites and track who's been paid" : "Your team's weekly shifts"}
        actions={
          isAdmin ? (
            <>
              <Button size="lg" onClick={() => openAdd()}>
                <CalendarPlus />
                Add Shift
              </Button>
              <Button size="lg" variant="outline" onClick={() => setStaffOpen(true)}>
                <Users />
                Staff
                <span className="rounded-full bg-raised px-1.5 text-xs tabular-nums text-ink-2">{staff.length}</span>
              </Button>
            </>
          ) : undefined
        }
      />

      {/* Week navigator */}
      <div className="sticky top-[calc(4rem+var(--safe-top))] z-20 -mx-4 mb-4 border-b border-line bg-canvas/90 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 md:-mx-8 md:px-8 lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:p-0 lg:backdrop-blur-none">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            className="h-11 w-11 shrink-0"
            aria-label="Previous week"
            onClick={() => setWeekStart((w) => addWeeks(w, -1))}
          >
            <ChevronLeft className="!size-5" />
          </Button>
          <div className="min-w-0 flex-1 text-center lg:flex-none lg:px-3 lg:text-left">
            <div className="font-display text-lg font-bold leading-tight text-ink sm:text-xl">{weekLabel(weekStart)}</div>
            <div className="text-xs text-ink-3">
              {totals.count} {totals.count === 1 ? "shift" : "shifts"} · {formatHours(totals.minutes)}
              {isAdmin && totals.count > 0 && (
                <span className={cn("ml-1", totals.paid === totals.count ? "text-status-clear" : "text-ink-3")}>
                  · {totals.paid}/{totals.count} paid
                </span>
              )}
            </div>
          </div>
          <Button
            variant="outline"
            size="icon"
            className="h-11 w-11 shrink-0"
            aria-label="Next week"
            onClick={() => setWeekStart((w) => addWeeks(w, 1))}
          >
            <ChevronRight className="!size-5" />
          </Button>
          {!isThisWeek && (
            <Button variant="ghost" className="h-11 shrink-0 text-ember" onClick={() => setWeekStart(weekStartOf(new Date()))}>
              Today
            </Button>
          )}
          {schedule.isFetching && !schedule.isLoading && (
            <Loader2 className="hidden h-4 w-4 animate-spin text-ink-3 lg:block" aria-label="Refreshing" />
          )}
        </div>
      </div>

      {/* Filters */}
      {(properties.length > 1 || hasMine) && (
        <div className="-mx-4 mb-5 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:px-0">
          {hasMine && (
            <button
              type="button"
              onClick={() => setOnlyMine((v) => !v)}
              aria-pressed={onlyMine}
              className={cn(
                "focus-ring shrink-0 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors",
                onlyMine ? "border-ember bg-ember text-white" : "border-line bg-surface text-ink-2 hover:text-ink",
              )}
            >
              My shifts
            </button>
          )}
          {properties.length > 1 &&
            filterChips.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setPropertyFilter(c.id)}
                aria-pressed={propertyFilter === c.id}
                className={cn(
                  "focus-ring flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-medium transition-colors",
                  propertyFilter === c.id
                    ? "border-ember/60 bg-ember/15 text-ember"
                    : "border-line bg-surface text-ink-2 hover:text-ink",
                )}
              >
                {c.id !== ALL && <Building2 className="h-3.5 w-3.5" />}
                <span className="max-w-[180px] truncate">{c.name}</span>
              </button>
            ))}
        </div>
      )}

      {schedule.isLoading ? (
        <div className="flex justify-center py-24">
          <Loader2 className="h-6 w-6 animate-spin text-ember" />
        </div>
      ) : schedule.error ? (
        <Card>
          <EmptyState
            icon={CalendarDays}
            title="Couldn't load the schedule"
            description={friendlyError(schedule.error)}
            action={
              <Button onClick={schedule.refetch}>
                <RefreshCw />
                Retry
              </Button>
            }
          />
        </Card>
      ) : properties.length === 0 && isAdmin ? (
        <Card>
          <EmptyState
            icon={Building2}
            title="Add a property first"
            description="Shifts are scheduled per property. Add your first site, then come back to build the week."
            action={
              <Button asChild>
                <Link to="/properties/new">
                  <Plus />
                  Add Property
                </Link>
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          {!isAdmin && totals.count === 0 && (
            <Card className="mb-5">
              <EmptyState
                icon={CalendarDays}
                title="No shifts this week"
                description="Your admin hasn't scheduled anyone for this week yet. Check another week with the arrows."
              />
            </Card>
          )}

          {(isAdmin || totals.count > 0) && (
            <ol className="grid gap-3 lg:grid-cols-7 lg:gap-2.5" aria-label="Days of the week">
              {days.map((d, i) => {
                const key = toDateKey(d);
                const list = byDay.get(key) ?? [];
                const today = isToday(d);
                const color = dayColor(d);
                if (!isAdmin && list.length === 0) {
                  return (
                    <li
                      key={key}
                      className="relative flex items-center gap-3 overflow-hidden rounded-xl border border-line/60 px-4 py-3 text-sm text-ink-3 lg:flex-col lg:items-start lg:gap-1 lg:py-3"
                    >
                      <span
                        aria-hidden
                        className="absolute inset-x-0 top-0 h-[3px] opacity-50"
                        style={{ background: `linear-gradient(90deg, ${color} 0%, transparent 90%)` }}
                      />
                      <DayLabel date={d} today={today} muted color={color} />
                      <span className="lg:mt-2">Off</span>
                    </li>
                  );
                }
                return (
                  <li
                    key={key}
                    className={cn(
                      "relative flex animate-fade-up flex-col overflow-hidden rounded-xl border bg-surface lg:min-h-[360px]",
                      today ? "border-ember/45" : "border-line",
                    )}
                    style={{ animationDelay: `${i * 35}ms` }}
                  >
                    <span
                      aria-hidden
                      className="absolute inset-x-0 top-0 h-[3px]"
                      style={{ background: `linear-gradient(90deg, ${color} 0%, ${color}55 55%, transparent 100%)` }}
                    />
                    <div
                      className="flex items-center justify-between gap-2 border-b px-4 py-3 lg:px-3"
                      style={{
                        background: `linear-gradient(100deg, ${color}26 0%, ${color}0f 48%, transparent 80%)`,
                        borderBottomColor: `${color}40`,
                      }}
                    >
                      <DayLabel date={d} today={today} color={color} />
                      {isAdmin ? (
                        <button
                          type="button"
                          onClick={() => openAdd(key)}
                          aria-label={`Add shift on ${format(d, "EEEE, MMM d")}`}
                          className="focus-ring -mr-1.5 flex h-10 w-10 items-center justify-center rounded-lg text-ember transition-colors hover:bg-ember/10 active:scale-95"
                        >
                          <Plus className="h-5 w-5" />
                        </button>
                      ) : (
                        <span className="text-xs tabular-nums text-ink-3">{list.length}</span>
                      )}
                    </div>
                    {list.length === 0 ? (
                      <button
                        type="button"
                        onClick={() => openAdd(key)}
                        className="focus-ring m-2.5 flex flex-1 items-center justify-center rounded-lg border border-dashed border-line py-5 text-xs text-ink-3 transition-colors hover:border-ember/40 hover:text-ember"
                      >
                        No shifts · tap to add
                      </button>
                    ) : (
                      <ul className="flex flex-col gap-2 p-2.5">
                        {list.map((s) => (
                          <ShiftCard
                            key={s.id}
                            shift={s}
                            staffName={staffById.get(s.staffId)?.name ?? "Removed staff"}
                            propertyName={propertyById.get(s.propertyId)?.name ?? "Removed property"}
                            showProperty={propertyFilter === ALL && properties.length > 1}
                            isAdmin={isAdmin}
                            mine={myStaffIds.has(s.staffId)}
                            onEdit={isAdmin ? openEdit : undefined}
                            onTogglePaid={isAdmin ? togglePaid : undefined}
                          />
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ol>
          )}

          {isAdmin && (
            <Card className="mt-6">
              <div className="flex items-start gap-4 px-6 pt-6 sm:px-7">
                <CircleDollarSign className="mt-0.5 h-8 w-8 shrink-0 text-status-clear" strokeWidth={1.6} />
                <div className="min-w-0">
                  <h2 className="font-display text-xl font-bold text-ink sm:text-[22px]">Pay this week</h2>
                  <p className="mt-1 text-sm text-ink-2">
                    Tap <span className="font-medium text-ink">Mark Paid</span> on a shift, or settle a person's whole week
                    here. Only admins can see pay status.
                  </p>
                </div>
              </div>
              {payRows.length === 0 ? (
                <p className="px-6 pb-6 pt-4 text-sm text-ink-3 sm:px-7">No shifts scheduled for this week yet.</p>
              ) : (
                <ul className="mt-4 divide-y divide-line border-t border-line">
                  {payRows.map((r) => {
                    const name = staffById.get(r.staffId)?.name ?? "Removed staff";
                    const paidCount = r.shifts.filter((s) => s.paidAt).length;
                    const allPaid = paidCount === r.shifts.length;
                    const pct = r.minutes === 0 ? 0 : (r.paidMinutes / r.minutes) * 100;
                    return (
                      <li key={r.staffId} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-6 py-4 sm:flex-nowrap sm:px-7">
                        <div
                          className={cn(
                            "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ring-1 transition-colors",
                            allPaid ? "bg-status-clear/15 text-status-clear ring-status-clear/40" : "bg-raised text-silver ring-line",
                          )}
                        >
                          {initials(name)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="truncate font-medium text-ink">{name}</span>
                            <span className="shrink-0 font-mono text-xs text-ink-2">
                              {formatHours(r.paidMinutes)} / {formatHours(r.minutes)}
                            </span>
                          </div>
                          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-raised">
                            <div
                              className="h-full rounded-full bg-status-clear transition-[width] duration-500 ease-out"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <div className="mt-1.5 text-xs text-ink-3">
                            {paidCount} of {r.shifts.length} {r.shifts.length === 1 ? "shift" : "shifts"} paid
                          </div>
                        </div>
                        <Button
                          variant={allPaid ? "ghost" : "outline"}
                          size="sm"
                          className={cn(
                            "w-full shrink-0 sm:w-auto",
                            !allPaid && "border-status-clear/50 text-status-clear hover:bg-status-clear/10 hover:text-status-clear",
                          )}
                          disabled={setPaid.isPending}
                          onClick={() =>
                            markAll(
                              r.shifts.filter((s) => (allPaid ? !!s.paidAt : !s.paidAt)).map((s) => s.id),
                              !allPaid,
                              name,
                            )
                          }
                        >
                          {allPaid ? "Mark week unpaid" : "Mark week paid"}
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>
          )}
        </>
      )}

      {isAdmin && (
        <>
          <ShiftDialog
            open={shiftOpen}
            onOpenChange={setShiftOpen}
            draft={draft}
            days={days}
            properties={properties}
            schedule={schedule}
          />
          <StaffDialog open={staffOpen} onOpenChange={setStaffOpen} schedule={schedule} />
        </>
      )}
    </>
  );
};

const DayLabel = ({ date, today, muted, color }: { date: Date; today: boolean; muted?: boolean; color: string }) => (
  <div className="flex items-baseline gap-2 lg:flex-col lg:gap-0">
    <span
      className="text-[11px] font-semibold uppercase tracking-[0.14em]"
      style={{ color: muted ? `${color}99` : color }}
    >
      {format(date, "EEE")}
      {today && <span className="ml-1.5 text-ember lg:hidden">· Today</span>}
    </span>
    <span className={cn("font-display text-lg font-bold leading-tight", muted ? "text-ink-3" : "text-ink")}>
      {format(date, "MMM d")}
    </span>
  </div>
);

export default Schedule;
