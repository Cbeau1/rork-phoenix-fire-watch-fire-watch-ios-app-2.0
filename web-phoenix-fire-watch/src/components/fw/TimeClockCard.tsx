import { Clock, Loader2, LogIn, LogOut } from "lucide-react";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { useNow } from "@/hooks/use-now";
import { timeOfDay } from "@/lib/format";
import { entryMinutes, fmtDuration, fmtElapsed } from "@/lib/timeclock";
import { cn } from "@/lib/utils";
import { useMyClock } from "@/state/useTimeClock";

/** Big clock in / clock out control with a live shift timer and this week's hours. */
export const TimeClockCard = ({ compact, showLink = true }: { compact?: boolean; showLink?: boolean }) => {
  const { open, loading, week, clockIn, clockOut } = useMyClock();
  const now = useNow(1000, !!open);
  const busy = clockIn.isPending || clockOut.isPending;

  const weekMin = useMemo(() => week.reduce((sum, e) => sum + (e.status === "rejected" ? 0 : entryMinutes(e, now)), 0), [week, now]);

  const punch = () => {
    if (open) {
      clockOut.mutate("", {
        onSuccess: (e) => toast.success("Clocked out", { description: `${fmtDuration(entryMinutes(e))} recorded · sent for approval` }),
        onError: (err) => toast.error(err instanceof Error ? err.message : "Couldn't clock out."),
      });
    } else {
      clockIn.mutate("", {
        onSuccess: (e) => toast.success("Clocked in", { description: `Started at ${timeOfDay(e.clockIn)}` }),
        onError: (err) => toast.error(err instanceof Error ? err.message : "Couldn't clock in."),
      });
    }
  };

  return (
    <section
      aria-label="Time clock"
      className={cn(
        "relative overflow-hidden rounded-xl border bg-surface",
        open ? "border-status-clear/45" : "border-line",
        compact ? "p-4" : "p-5 sm:p-6",
      )}
    >
      {open && (
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-status-clear/15 blur-3xl" />
      )}
      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-4">
          <div
            className={cn(
              "flex h-14 w-14 shrink-0 items-center justify-center rounded-full ring-1",
              open ? "bg-status-clear/15 text-status-clear ring-status-clear/40" : "bg-raised text-ink-2 ring-line",
            )}
          >
            <Clock className="h-7 w-7" strokeWidth={1.8} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em]">
              <span className={cn("h-2 w-2 rounded-full", open ? "animate-pulse bg-status-clear" : "bg-ink-3")} />
              <span className={open ? "text-status-clear" : "text-ink-3"}>{open ? "On the clock" : "Off the clock"}</span>
            </div>
            {loading ? (
              <div className="mt-1 h-8 w-32 animate-pulse rounded bg-raised" />
            ) : open ? (
              <>
                <div className="mt-0.5 font-mono text-[30px] font-bold leading-none tabular-nums text-ink" aria-live="off">
                  {fmtElapsed(now - Date.parse(open.clockIn))}
                </div>
                <p className="mt-1.5 text-sm text-ink-2">Clocked in at {timeOfDay(open.clockIn)}</p>
              </>
            ) : (
              <>
                <div className="mt-0.5 font-display text-2xl font-bold text-ink">Ready to start?</div>
                <p className="mt-1 text-sm text-ink-2">
                  This week: <span className="font-mono tabular-nums text-ink">{fmtDuration(weekMin)}</span>
                </p>
              </>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col gap-2 sm:items-end">
          <Button
            size="lg"
            onClick={punch}
            disabled={busy || loading}
            className={cn(
              "h-14 min-w-[180px] text-base font-semibold transition-transform active:scale-[0.97]",
              open ? "bg-raised text-ink ring-1 ring-line hover:bg-raised/80" : "",
            )}
          >
            {busy ? <Loader2 className="animate-spin" /> : open ? <LogOut /> : <LogIn />}
            {open ? "Clock Out" : "Clock In"}
          </Button>
          {open && (
            <p className="text-xs text-ink-3">
              This week so far: <span className="font-mono tabular-nums text-ink-2">{fmtDuration(weekMin)}</span>
            </p>
          )}
          {showLink && (
            <Link to="/hours" className="focus-ring rounded text-sm font-medium text-link hover:text-link-hover">
              View my hours
            </Link>
          )}
        </div>
      </div>
    </section>
  );
};
