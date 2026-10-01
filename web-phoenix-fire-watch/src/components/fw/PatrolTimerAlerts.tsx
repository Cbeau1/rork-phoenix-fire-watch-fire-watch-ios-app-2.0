import { AlarmClock, ClipboardPlus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useNow } from "@/hooks/use-now";
import { useWakeLock } from "@/hooks/use-wake-lock";
import { playAlertSound, showSystemNotification, vibrate } from "@/lib/alerts";
import { formatCountdown, formatInterval, WARNING_MINUTES } from "@/lib/patrol-timer";
import { cn } from "@/lib/utils";
import { usePatrolTimers } from "@/state/PatrolTimerProvider";

interface PatrolAlert {
  key: string;
  kind: "warning" | "due";
  propertyId: string;
  propertyName: string;
  dueAt: number;
}

/** Only alert for due times that just passed — not ones missed while the app was closed. */
const DUE_GRACE_MS = 90_000;

/**
 * Watches every running patrol timer and alerts the officer 5 minutes before a patrol is due
 * (and again when it's due): in-app banner, chime, vibration, and a system notification when
 * the app is in the background.
 */
export const PatrolTimerAlerts = () => {
  const navigate = useNavigate();
  const { activeTimers, scheduleFor, keepAwake } = usePatrolTimers();
  const running = activeTimers.length > 0;
  const now = useNow(1000, running);
  const fired = useRef<Set<string>>(new Set());
  const [alerts, setAlerts] = useState<PatrolAlert[]>([]);

  useWakeLock(running && keepAwake);

  const openLog = useCallback((propertyId: string) => navigate(`/properties/${propertyId}/log`), [navigate]);

  const fire = useCallback(
    (alert: PatrolAlert) => {
      fired.current.add(alert.key);
      setAlerts((list) => [...list.filter((a) => a.propertyId !== alert.propertyId), alert]);
      playAlertSound(alert.kind);
      vibrate(alert.kind === "due" ? [400, 150, 400, 150, 400] : [250, 120, 250]);
      if (document.visibilityState !== "visible") {
        void showSystemNotification({
          title: alert.kind === "due" ? `Patrol due now — ${alert.propertyName}` : `Patrol due in ${WARNING_MINUTES} minutes`,
          body:
            alert.kind === "due"
              ? "Your next fire watch patrol is due. Tap to log it."
              : `${alert.propertyName} — next patrol at ${new Date(alert.dueAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.`,
          url: `/properties/${alert.propertyId}/log`,
          tag: `patrol-${alert.propertyId}`,
          onClick: () => openLog(alert.propertyId),
        });
      }
    },
    [openLog],
  );

  useEffect(() => {
    if (!running) {
      setAlerts((list) => (list.length ? [] : list));
      return;
    }
    for (const { property } of activeTimers) {
      const s = scheduleFor(property.id, now);
      if (!s) continue;
      const warnKey = `${property.id}:${s.dueAt}:warning`;
      if (s.isWarning && now < s.dueAt && !fired.current.has(warnKey)) {
        fire({ key: warnKey, kind: "warning", propertyId: property.id, propertyName: property.name, dueAt: s.dueAt });
      }
      if (s.lastDueAt !== null && now - s.lastDueAt < DUE_GRACE_MS) {
        const dueKey = `${property.id}:${s.lastDueAt}:due`;
        if (!fired.current.has(dueKey)) {
          fire({ key: dueKey, kind: "due", propertyId: property.id, propertyName: property.name, dueAt: s.lastDueAt });
        }
      }
    }
    // Drop alerts that no longer apply (patrol logged, timer turned off, or the next cycle began).
    setAlerts((list) => {
      const next = list.filter((a) => {
        const s = scheduleFor(a.propertyId, now);
        if (!s) return false;
        return a.kind === "warning" ? s.dueAt === a.dueAt && now < a.dueAt : s.lastDueAt === a.dueAt;
      });
      return next.length === list.length ? list : next;
    });
  }, [now, running, activeTimers, scheduleFor, fire]);

  if (alerts.length === 0) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 px-3 pt-[max(0.75rem,var(--safe-top))] lg:pl-[280px]"
    >
      {alerts.map((a) => {
        const s = scheduleFor(a.propertyId, now);
        const due = a.kind === "due";
        const property = activeTimers.find((t) => t.property.id === a.propertyId)?.property;
        return (
          <div
            key={a.key}
            className={cn(
              "pointer-events-auto flex w-full max-w-xl animate-fade-up items-center gap-3 overflow-hidden rounded-xl border bg-surface/95 p-3 pr-2 shadow-[0_18px_50px_-12px_rgba(0,0,0,0.8)] backdrop-blur sm:gap-4 sm:p-4 sm:pr-3",
              due ? "border-status-incident/60" : "border-status-follow/50",
            )}
          >
            <div
              className={cn(
                "flex h-12 w-12 shrink-0 items-center justify-center rounded-full",
                due ? "animate-ember-pulse bg-status-incident text-white" : "bg-status-follow/15 text-status-follow",
              )}
            >
              <AlarmClock className="h-6 w-6" />
            </div>
            <div className="min-w-0 flex-1">
              <div className={cn("text-xs font-semibold uppercase tracking-[0.14em]", due ? "text-status-incident" : "text-status-follow")}>
                {due ? "Patrol due now" : `Patrol due in ${formatCountdown(Math.max(0, a.dueAt - now))}`}
              </div>
              <div className="truncate text-[15px] font-semibold text-ink">{a.propertyName}</div>
              {property && (
                <div className="truncate text-xs text-ink-3">
                  Every {formatInterval(property.patrolIntervalMinutes)}
                  {due && s ? ` · overdue ${formatCountdown(now - a.dueAt)}` : ""}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                setAlerts((list) => list.filter((x) => x.key !== a.key));
                openLog(a.propertyId);
              }}
              className={cn(
                "focus-ring inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg px-3.5 text-sm font-semibold text-white transition-colors",
                due ? "bg-status-incident hover:bg-status-incident/90" : "bg-ember hover:bg-ember-hover",
              )}
            >
              <ClipboardPlus className="h-4 w-4" />
              <span className="hidden sm:inline">Log Patrol</span>
              <span className="sm:hidden">Log</span>
            </button>
            <button
              type="button"
              aria-label="Dismiss alert"
              onClick={() => setAlerts((list) => list.filter((x) => x.key !== a.key))}
              className="focus-ring flex h-11 w-9 shrink-0 items-center justify-center rounded-lg text-ink-3 hover:text-ink"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
