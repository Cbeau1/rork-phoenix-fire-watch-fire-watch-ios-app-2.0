import { AlarmClock, BellOff, BellRing, Loader2, Lock, MonitorSmartphone, Pencil } from "lucide-react";
import { memo, useState } from "react";
import { toast } from "sonner";
import { THEME, tint } from "@/lib/theme";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useNow } from "@/hooks/use-now";
import { formatCountdown, formatInterval, INTERVAL_OPTIONS, WARNING_MINUTES } from "@/lib/patrol-timer";
import { friendlyError } from "@/lib/supabase";
import type { Property } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useAuth } from "@/state/AuthProvider";
import { useFireWatch } from "@/state/FireWatchProvider";
import { usePatrolTimers } from "@/state/PatrolTimerProvider";

const RING_SIZE = 132;
const RING_STROKE = 8;
const RADIUS = (RING_SIZE - RING_STROKE) / 2;
const CIRC = 2 * Math.PI * RADIUS;

const timeLabel = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** Repeating patrol timer for one property: officer on/off toggle, admin-only interval. */
export const PatrolTimerCard = memo(({ property }: { property: Property }) => {
  const { isAdmin } = useAuth();
  const { setPatrolInterval } = useFireWatch();
  const { isOn, setTimerOn, scheduleFor, notifications, enableNotifications, keepAwake, setKeepAwake } =
    usePatrolTimers();
  const on = isOn(property.id);
  const now = useNow(1000, on);
  const schedule = on ? scheduleFor(property.id, now) : null;
  const [editing, setEditing] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);

  const interval = property.patrolIntervalMinutes;
  const options = INTERVAL_OPTIONS.includes(interval)
    ? INTERVAL_OPTIONS
    : [...INTERVAL_OPTIONS, interval].sort((a, b) => a - b);

  const overdue = !!schedule && schedule.overdueSince !== null;
  const warning = !!schedule && !overdue && schedule.isWarning;
  const tone = overdue ? THEME.danger : warning ? THEME.warning : THEME.primary;
  const toneText = overdue ? THEME.dangerInk : warning ? THEME.warning : THEME.link;

  const changeInterval = async (value: string) => {
    const minutes = Number(value);
    if (!Number.isFinite(minutes) || minutes === interval) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await setPatrolInterval(property.id, minutes);
      toast.success("Patrol interval updated", { description: `${property.name} · every ${formatInterval(minutes)}` });
      setEditing(false);
    } catch (err) {
      toast.error(friendlyError(err, "Couldn't update the interval"));
    } finally {
      setSaving(false);
    }
  };

  const toggle = (next: boolean) => {
    setTimerOn(property.id, next);
    if (next) {
      toast.success("Patrol timer on", {
        description: `You'll be alerted ${WARNING_MINUTES} minutes before each patrol is due.`,
      });
    }
  };

  return (
    <section
      className={cn(
        "relative mt-5 overflow-hidden rounded-xl border bg-surface transition-colors",
        on ? (overdue ? "border-status-incident/50" : warning ? "border-status-follow/50" : "border-primary/35") : "border-line",
      )}
    >
      {on && (
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full blur-3xl"
          style={{ backgroundColor: tint(tone, 8) }}
        />
      )}

      <div className="relative flex flex-col gap-6 p-6 sm:p-7 md:flex-row md:items-center">
        {/* Countdown ring */}
        <div className="flex items-center gap-5 md:w-auto">
          <div className="relative shrink-0" style={{ width: RING_SIZE, height: RING_SIZE }}>
            <svg width={RING_SIZE} height={RING_SIZE} className="-rotate-90">
              <circle cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RADIUS} fill="none" style={{ stroke: THEME.line }} strokeWidth={RING_STROKE} />
              {schedule && (
                <circle
                  cx={RING_SIZE / 2}
                  cy={RING_SIZE / 2}
                  r={RADIUS}
                  fill="none"
                  style={{ stroke: tone }}
                  strokeWidth={RING_STROKE}
                  strokeLinecap="round"
                  strokeDasharray={CIRC}
                  strokeDashoffset={CIRC * (1 - schedule.progress)}
                  className="transition-[stroke-dashoffset] duration-1000 ease-linear"
                />
              )}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
              {schedule ? (
                <>
                  <span className="font-mono text-[22px] font-semibold tabular-nums leading-none text-ink">
                    {overdue ? formatCountdown(now - (schedule.overdueSince ?? now)) : formatCountdown(schedule.remaining)}
                  </span>
                  <span
                    className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.16em]"
                    style={{ color: toneText }}
                  >
                    {overdue ? "Overdue" : warning ? "Due soon" : "Next patrol"}
                  </span>
                </>
              ) : (
                <>
                  <AlarmClock className="h-8 w-8 text-ink-3" strokeWidth={1.6} />
                  <span className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-3">Off</span>
                </>
              )}
            </div>
          </div>

          <div className="min-w-0 md:hidden">
            <TimerHeading on={on} />
          </div>
        </div>

        {/* Details */}
        <div className="min-w-0 flex-1">
          <div className="hidden md:block">
            <TimerHeading on={on} />
          </div>

          <div className="mt-0 space-y-1 text-sm text-ink-2 md:mt-3">
            {schedule ? (
              overdue ? (
                <p>
                  <span className="font-medium text-status-incident-ink">Patrol was due at {timeLabel(schedule.overdueSince ?? now)}.</span>{" "}
                  Log it to restart the countdown.
                </p>
              ) : (
                <p>
                  Next patrol due at <span className="font-mono font-medium text-ink">{timeLabel(schedule.dueAt)}</span> ·
                  alert at <span className="font-mono text-ink">{timeLabel(schedule.warnAt)}</span>
                </p>
              )
            ) : (
              <p>Turn on to get an alert {WARNING_MINUTES} minutes before each patrol is due.</p>
            )}
            <p className="text-xs text-ink-3">Logging a patrol here restarts the countdown automatically.</p>
          </div>

          {/* Interval */}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium uppercase tracking-[0.14em] text-ink-3">Interval</span>
            {isAdmin && editing ? (
              <Select defaultOpen value={String(interval)} onValueChange={(v) => void changeInterval(v)} onOpenChange={(o) => !o && !saving && setEditing(false)}>
                <SelectTrigger aria-label="Patrol interval" className="h-9 w-40 border-line-strong bg-field text-ink focus:ring-link/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="border-line bg-surface text-ink">
                  {options.map((m) => (
                    <SelectItem key={m} value={String(m)} className="focus:bg-primary focus:text-white">
                      Every {formatInterval(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <span className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-raised px-3 text-sm font-medium text-ink">
                Every {formatInterval(interval)}
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-link" />}
              </span>
            )}
            {isAdmin ? (
              !editing && (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-link hover:bg-primary/10"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Change
                </button>
              )
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs text-ink-3">
                <Lock className="h-3.5 w-3.5" />
                Set by your org admin
              </span>
            )}
          </div>
        </div>

        {/* Toggle */}
        <div className="flex flex-col gap-3 border-t border-line pt-5 md:w-64 md:self-stretch md:justify-center md:border-l md:border-t-0 md:pl-6 md:pt-0">
          <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-line bg-raised/70 px-4 py-3.5">
            <span className="flex items-center gap-3">
              {on ? <BellRing className="h-5 w-5 text-link" /> : <BellOff className="h-5 w-5 text-ink-3" />}
              <span>
                <span className="block text-[15px] font-semibold text-ink">{on ? "Timer on" : "Timer off"}</span>
                <span className="block text-xs text-ink-3">Just for you, on this device</span>
              </span>
            </span>
            <Switch
              checked={on}
              onCheckedChange={toggle}
              aria-label={`Patrol timer for ${property.name}`}
              className="h-7 w-12 data-[state=checked]:bg-primary data-[state=unchecked]:bg-line-strong [&>span]:h-6 [&>span]:w-6 [&>span]:bg-white data-[state=checked]:[&>span]:translate-x-5"
            />
          </label>

          {on && (
            <div className="space-y-2 text-xs">
              {notifications === "default" && (
                <button
                  type="button"
                  onClick={() => void enableNotifications()}
                  className="focus-ring w-full rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-left font-medium text-link hover:bg-primary/15"
                >
                  Allow notifications to get alerts while the app is in the background
                </button>
              )}
              {notifications === "denied" && (
                <p className="rounded-lg border border-line px-3 py-2 text-ink-3">
                  Notifications are blocked in your browser settings. Alerts will still sound while the app is open.
                </p>
              )}
              <label className="flex cursor-pointer items-center justify-between gap-3 px-1 text-ink-2">
                <span className="inline-flex items-center gap-2">
                  <MonitorSmartphone className="h-4 w-4 text-ink-3" />
                  Keep screen on
                </span>
                <Switch
                  checked={keepAwake}
                  onCheckedChange={setKeepAwake}
                  aria-label="Keep screen on while timers run"
                  className="h-5 w-9 data-[state=checked]:bg-primary data-[state=unchecked]:bg-line-strong [&>span]:h-4 [&>span]:w-4 [&>span]:bg-white data-[state=checked]:[&>span]:translate-x-4"
                />
              </label>
            </div>
          )}
        </div>
      </div>
    </section>
  );
});
PatrolTimerCard.displayName = "PatrolTimerCard";

const TimerHeading = ({ on }: { on: boolean }) => (
  <div>
    <div className="flex items-center gap-2.5">
      <h2 className="font-display text-xl font-bold text-ink sm:text-[22px]">Patrol Timer</h2>
      {on && (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-link ring-1 ring-inset ring-link/30">
          <span className="h-1.5 w-1.5 animate-primary-pulse rounded-full bg-link" />
          Running
        </span>
      )}
    </div>
    <p className="mt-1 text-sm text-ink-3">Repeating reminder {WARNING_MINUTES} minutes before each patrol</p>
  </div>
);
